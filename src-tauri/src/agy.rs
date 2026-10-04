//! Antigravity CLI (`agy`) harness: discovery, authentication checks and
//! headless agent runs streamed back to the web view as events.

use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::{Mutex, Notify};

use crate::designs;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const NOT_SIGNED_IN_MARKERS: [&str; 3] = [
    "not logged into antigravity",
    "not logged in",
    "please log in",
];

/// Running agent processes keyed by design id; the Notify cancels one.
#[derive(Default)]
pub struct Runs(pub Mutex<HashMap<String, Arc<Notify>>>);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgyModel {
    pub id: String,
    pub label: String,
    /** An older generation still on offer; the picker groups these. */
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub legacy: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgyStatus {
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub authenticated: bool,
    pub models: Vec<AgyModel>,
    pub detail: Option<String>,
    pub checked_at: u64,
    /** Signed-in Google account, read from agy's own log of the check. */
    pub account: Option<String>,
    /** "consumer" for a personal Google account, otherwise the CLI's term. */
    pub auth_method: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PingResult {
    pub ok: bool,
    pub latency_ms: u64,
    pub model: Option<String>,
    pub detail: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AgentEvent {
    design_id: String,
    event: Value,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AgentExit {
    design_id: String,
    ok: bool,
    cancelled: bool,
    code: Option<i32>,
    auth_lost: bool,
    rate_limited: bool,
    conversation_id: Option<String>,
    response: Option<String>,
    detail: Option<String>,
    usage: Option<Value>,
    model: Option<String>,
}

pub(crate) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub(crate) fn mentions_rate_limit(text: &str) -> bool {
    let lower = text.to_lowercase();
    ["resource_exhausted", "rate limit", "quota exceeded", "exceeded your", "too many requests", " 429"]
        .iter()
        .any(|m| lower.contains(m))
}

pub(crate) fn mentions_signed_out(text: &str) -> bool {
    let lower = text.to_lowercase();
    NOT_SIGNED_IN_MARKERS.iter().any(|m| lower.contains(m))
}

/// Resolve the agy executable: explicit override, then PATH, then the
/// default per-user install location.
pub fn resolve_agy(override_path: Option<&str>) -> Option<PathBuf> {
    if let Some(p) = override_path.map(str::trim).filter(|p| !p.is_empty()) {
        let path = PathBuf::from(p);
        return path.is_file().then_some(path);
    }
    let names: &[&str] = if cfg!(windows) {
        &["agy.exe", "agy.cmd", "agy"]
    } else {
        &["agy"]
    };
    if let Some(path_var) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path_var) {
            for name in names {
                let candidate = dir.join(name);
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    let fallback = if cfg!(windows) {
        std::env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join("agy").join("bin").join("agy.exe"))
    } else {
        std::env::var_os("HOME").map(|d| PathBuf::from(d).join(".local").join("bin").join("agy"))
    };
    fallback.filter(|p| p.is_file())
}

fn command(exe: &Path) -> Command {
    let mut cmd = Command::new(exe);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

struct Captured {
    code: Option<i32>,
    stdout: String,
    stderr: String,
}

async fn capture(mut cmd: Command, limit: Duration) -> Result<Captured, String> {
    let child = cmd.spawn().map_err(|e| format!("Could not start agy: {e}"))?;
    match tokio::time::timeout(limit, child.wait_with_output()).await {
        Ok(Ok(out)) => Ok(Captured {
            code: out.status.code(),
            stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        }),
        Ok(Err(e)) => Err(format!("agy failed: {e}")),
        Err(_) => Err(format!("agy did not answer within {}s", limit.as_secs())),
    }
}

fn parse_models(stdout: &str) -> Vec<AgyModel> {
    stdout
        .lines()
        .filter_map(|line| {
            let (id, label) = line.split_once('\t')?;
            let id = id.trim();
            if id.is_empty() || id.contains(' ') {
                return None;
            }
            Some(AgyModel {
                id: id.to_string(),
                label: label.trim().to_string(),
                legacy: false,
            })
        })
        .collect()
}

/// Three-stage check: executable present, version answers, account signed
/// in (the model catalogue only resolves for an authenticated account).
#[tauri::command]
pub async fn agy_status(agy_path: Option<String>) -> AgyStatus {
    let mut status = AgyStatus {
        installed: false,
        path: None,
        version: None,
        authenticated: false,
        models: vec![],
        detail: None,
        checked_at: now_ms(),
        account: None,
        auth_method: None,
    };

    let Some(exe) = resolve_agy(agy_path.as_deref()) else {
        status.detail = Some(match agy_path.filter(|p| !p.trim().is_empty()) {
            Some(p) => format!("No agy executable at {p}."),
            None => "agy was not found on PATH or in the default install folder.".into(),
        });
        return status;
    };
    status.path = Some(exe.display().to_string());

    let mut version_cmd = command(&exe);
    version_cmd.arg("--version");
    match capture(version_cmd, Duration::from_secs(20)).await {
        Ok(out) if out.code == Some(0) => {
            status.installed = true;
            status.version = out.stdout.lines().next().map(|l| l.trim().to_string());
        }
        Ok(out) => {
            status.detail = Some(format!(
                "agy --version exited with {}: {}",
                out.code.map_or("a signal".into(), |c| c.to_string()),
                out.stderr.trim()
            ));
            return status;
        }
        Err(e) => {
            status.detail = Some(e);
            return status;
        }
    }

    let mut models_cmd = command(&exe);
    // agy logs "applyAuthResult: email=…, authMethod=…" while resolving the
    // account; a private log file for this one call lets us read it back.
    let log_path = std::env::temp_dir().join(format!("design-gravity-agy-{}.log", std::process::id()));
    let _ = std::fs::remove_file(&log_path);
    models_cmd.arg("--log-file").arg(&log_path).arg("models");
    match capture(models_cmd, Duration::from_secs(45)).await {
        Ok(out) => {
            let combined = format!("{}\n{}", out.stdout, out.stderr);
            status.models = parse_models(&out.stdout);
            if mentions_signed_out(&combined) {
                status.detail = Some("Antigravity reports that no account is signed in.".into());
            } else if out.code != Some(0) {
                status.detail = Some(format!("agy models failed: {}", out.stderr.trim()));
            } else if status.models.is_empty() {
                status.detail =
                    Some("Antigravity returned no models. The CLI is most likely signed out.".into());
            } else {
                status.authenticated = true;
            }
        }
        Err(e) => status.detail = Some(e),
    }
    if let Ok(log) = std::fs::read_to_string(&log_path) {
        if let Some(line) = log.lines().rev().find(|l| l.contains("applyAuthResult:")) {
            let field = |key: &str| {
                line.split(key)
                    .nth(1)
                    .map(|rest| rest.split(',').next().unwrap_or("").trim().to_string())
                    .filter(|v| !v.is_empty())
            };
            status.account = field("email=");
            status.auth_method = field("authMethod=");
        }
    }
    let _ = std::fs::remove_file(&log_path);
    status
}

/// Deep check: one real headless turn. Proves quota and model access, not
/// just a cached session.
#[tauri::command]
pub async fn agy_ping(agy_path: Option<String>, model: Option<String>) -> PingResult {
    let started = Instant::now();
    let fail = |detail: String| PingResult {
        ok: false,
        latency_ms: started.elapsed().as_millis() as u64,
        model: None,
        detail: Some(detail),
    };
    let Some(exe) = resolve_agy(agy_path.as_deref()) else {
        return fail("agy is not installed.".into());
    };
    let dir = std::env::temp_dir().join("design-gravity-ping");
    let _ = std::fs::create_dir_all(&dir);

    let mut cmd = command(&exe);
    cmd.current_dir(&dir).args([
        "-p",
        "Reply with exactly the single word READY and nothing else.",
        "--output-format",
        "json",
        "--disable-slash-commands",
        "--print-timeout",
        "90s",
    ]);
    if let Some(m) = model.as_deref().filter(|m| !m.is_empty()) {
        cmd.args(["--model", m]);
    }
    let out = match capture(cmd, Duration::from_secs(100)).await {
        Ok(out) => out,
        Err(e) => return fail(e),
    };
    if mentions_signed_out(&format!("{}\n{}", out.stdout, out.stderr)) {
        return fail("Antigravity reports that no account is signed in.".into());
    }
    let parsed: Option<Value> = out
        .stdout
        .lines()
        .rev()
        .find_map(|l| serde_json::from_str::<Value>(l.trim()).ok());
    let Some(json) = parsed else {
        let err = out.stderr.trim();
        return fail(if err.is_empty() {
            "agy returned no readable result.".into()
        } else {
            err.chars().take(400).collect()
        });
    };
    let ok = json["status"].as_str() == Some("SUCCESS")
        && json["response"]
            .as_str()
            .is_some_and(|r| r.to_uppercase().contains("READY"));
    PingResult {
        ok,
        latency_ms: started.elapsed().as_millis() as u64,
        model,
        detail: (!ok).then(|| format!("Unexpected answer: {}", json["response"].as_str().unwrap_or("none"))),
    }
}

/// Open an interactive agy session in its own terminal so the user can sign
/// in; the app keeps polling `agy_status` until the account resolves.
#[tauri::command]
pub async fn agy_open_sign_in(agy_path: Option<String>) -> Result<(), String> {
    let exe = resolve_agy(agy_path.as_deref()).ok_or("agy is not installed.")?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("cmd")
            .args(["/C", "start", "Antigravity sign-in"])
            .arg(&exe)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Could not open a terminal: {e}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        let script = format!("tell application \"Terminal\" to do script \"'{}'\"", exe.display());
        std::process::Command::new("osascript")
            .args(["-e", &script, "-e", "tell application \"Terminal\" to activate"])
            .spawn()
            .map_err(|e| format!("Could not open Terminal: {e}"))?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("x-terminal-emulator")
            .arg("-e")
            .arg(&exe)
            .spawn()
            .map_err(|e| format!("Could not open a terminal: {e}"))?;
    }
    Ok(())
}

/// Update agy in place with its own updater (`agy update`), headless.
#[tauri::command]
pub async fn agy_update(agy_path: Option<String>) -> Result<String, String> {
    let exe = resolve_agy(agy_path.as_deref()).ok_or("agy is not installed.")?;
    let mut cmd = command(&exe);
    cmd.arg("update");
    let out = capture(cmd, Duration::from_secs(600)).await?;
    let text = format!("{}
{}", out.stdout.trim(), out.stderr.trim()).trim().to_string();
    if out.code == Some(0) {
        Ok(text)
    } else if text.is_empty() {
        Err(format!("agy update exited with {}", out.code.map_or("a signal".into(), |c| c.to_string())))
    } else {
        Err(text)
    }
}

/// Run one agent turn inside the design's workspace. Every stream-json line
/// is forwarded as `agent-event`; completion arrives as `agent-exit`.
#[tauri::command]
pub async fn agent_run(
    app: AppHandle,
    runs: State<'_, Runs>,
    design_id: String,
    prompt: String,
    model: Option<String>,
    conversation_id: Option<String>,
    effort: Option<String>,
    agy_path: Option<String>,
    scope: Option<String>,
    dir: Option<String>,
) -> Result<(), String> {
    let exe = resolve_agy(agy_path.as_deref()).ok_or("agy is not installed.")?;
    // Design systems run in their own workspace, exports in a folder the user
    // picked; everything else is a design.
    let workspace = match scope.as_deref() {
        Some("system") => {
            let dir = designs::system_dir(&app, &design_id)?;
            let _ = std::fs::create_dir_all(&dir);
            dir
        }
        Some("dir") => PathBuf::from(dir.ok_or("No folder was chosen.")?),
        _ => designs::design_dir(&app, &design_id)?,
    };
    if !workspace.is_dir() {
        return Err("This design's workspace folder is missing.".into());
    }

    let cancel = Arc::new(Notify::new());
    {
        let mut map = runs.0.lock().await;
        if map.contains_key(&design_id) {
            return Err("An agent is already working on this design.".into());
        }
        map.insert(design_id.clone(), cancel.clone());
    }

    let mut cmd = command(&exe);
    cmd.current_dir(&workspace).args([
        "-p",
        &prompt,
        "--output-format",
        "stream-json",
        "--mode",
        "accept-edits",
        "--disable-slash-commands",
        "--print-timeout",
        "900s",
    ]);
    if let Some(m) = model.as_deref().filter(|m| !m.is_empty()) {
        cmd.args(["--model", m]);
    }
    if let Some(c) = conversation_id.as_deref().filter(|c| !c.is_empty()) {
        cmd.args(["--conversation", c]);
    }
    if let Some(e) = effort.as_deref().filter(|e| !e.is_empty()) {
        cmd.args(["--effort", e]);
    }

    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(e) => {
            runs.0.lock().await.remove(&design_id);
            return Err(format!("Could not start agy: {e}"));
        }
    };
    let stdout = child.stdout.take().ok_or("agy stdout unavailable")?;
    let mut stderr = child.stderr.take().ok_or("agy stderr unavailable")?;

    let app_task = app.clone();
    tauri::async_runtime::spawn(async move {
        let stderr_task = tauri::async_runtime::spawn(async move {
            let mut buf = Vec::new();
            let _ = stderr.read_to_end(&mut buf).await;
            String::from_utf8_lossy(&buf).into_owned()
        });

        let mut conversation: Option<String> = None;
        let mut response: Option<String> = None;
        let mut result_ok = false;
        let mut auth_lost = false;
        let mut rate_limited = false;
        let mut usage: Option<Value> = None;
        let mut used_model: Option<String> = None;
        let mut lines = BufReader::new(stdout).lines();

        let read_loop = async {
            while let Ok(Some(line)) = lines.next_line().await {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if mentions_signed_out(trimmed) {
                    auth_lost = true;
                }
                if mentions_rate_limit(trimmed) {
                    rate_limited = true;
                }
                let Ok(event) = serde_json::from_str::<Value>(trimmed) else {
                    continue;
                };
                if let Some(id) = event
                    .pointer("/conversation_id")
                    .or_else(|| event.pointer("/step_update/conversation_id"))
                    .or_else(|| event.pointer("/result/conversation_id"))
                    .and_then(Value::as_str)
                {
                    conversation = Some(id.to_string());
                }
                if event["event"] == "init" {
                    used_model = event["init"]["model"].as_str().map(str::to_string);
                }
                if event["event"] == "result" {
                    usage = Some(event["result"]["usage"].clone());
                    result_ok = event["result"]["status"] == "SUCCESS";
                    response = event["result"]["response"].as_str().map(str::to_string);
                }
                let _ = app_task.emit(
                    "agent-event",
                    AgentEvent {
                        design_id: design_id.clone(),
                        event,
                    },
                );
            }
        };

        let cancelled = tokio::select! {
            _ = read_loop => false,
            _ = cancel.notified() => true,
        };
        if cancelled {
            let _ = child.kill().await;
        }
        let code = child.wait().await.ok().and_then(|s| s.code());
        let stderr_text = stderr_task.await.unwrap_or_default();
        if mentions_signed_out(&stderr_text) {
            auth_lost = true;
        }
        if mentions_rate_limit(&stderr_text) {
            rate_limited = true;
        }
        let tail: String = {
            let t = stderr_text.trim();
            let skip = t.chars().count().saturating_sub(600);
            t.chars().skip(skip).collect()
        };

        app_task.state::<Runs>().0.lock().await.remove(&design_id);
        let ok = !cancelled && result_ok && code == Some(0);
        let _ = app_task.emit(
            "agent-exit",
            AgentExit {
                design_id: design_id.clone(),
                ok,
                cancelled,
                code,
                auth_lost,
                rate_limited: rate_limited && !ok,
                usage,
                model: used_model,
                conversation_id: conversation,
                response,
                detail: (!ok && !cancelled && !tail.is_empty()).then_some(tail),
            },
        );
    });
    Ok(())
}

#[tauri::command]
pub async fn agent_cancel(runs: State<'_, Runs>, design_id: String) -> Result<bool, String> {
    let map = runs.0.lock().await;
    Ok(match map.get(&design_id) {
        Some(n) => {
            n.notify_one();
            true
        }
        None => false,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AskResult {
    pub data: Value,
    pub conversation_id: Option<String>,
}

/// A structured-output turn: the answer, or why it failed and whether a
/// second attempt could help.
enum Ask {
    Done(AskResult),
    Retry(String),
    Fail(String),
}

/// One headless turn that must answer with JSON matching `schema`
/// (agy's --json-schema). Used for the design-system questionnaire.
/// The model sometimes reaches for a shell tool, which headless mode denies,
/// and then answers with nothing; one fresh attempt almost always succeeds.
#[tauri::command]
pub async fn agy_ask(
    prompt: String,
    schema: Value,
    model: Option<String>,
    agy_path: Option<String>,
    design_id: Option<String>,
    app: AppHandle,
) -> Result<AskResult, String> {
    let exe = resolve_agy(agy_path.as_deref()).ok_or("agy is not installed.")?;
    // With a design id the agent answers from inside that design's workspace
    // (read-only: this mode never accepts edits), e.g. to critique it.
    let cwd = match design_id.as_deref() {
        Some(id) => Some(designs::design_dir(&app, id)?),
        None => None,
    };
    let mut reason = String::new();
    for _ in 0..2 {
        match ask_once(&exe, &prompt, &schema, model.as_deref(), cwd.as_deref()).await {
            Ask::Done(r) => return Ok(r),
            Ask::Fail(e) => return Err(e),
            Ask::Retry(e) => reason = e,
        }
    }
    Err(reason)
}

async fn ask_once(exe: &Path, prompt: &str, schema: &Value, model: Option<&str>, cwd: Option<&Path>) -> Ask {
    let dir = std::env::temp_dir().join(format!("design-gravity-ask-{}", now_ms()));
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return Ask::Fail(e.to_string());
    }
    let schema_path = dir.join("schema.json");
    if let Err(e) = std::fs::write(&schema_path, schema.to_string()) {
        return Ask::Fail(e.to_string());
    }

    let mut cmd = command(exe);
    cmd.current_dir(cwd.unwrap_or(&dir))
        .args(["-p", prompt, "--output-format", "json", "--disable-slash-commands", "--print-timeout", "240s"])
        .arg("--json-schema")
        .arg(&schema_path);
    if let Some(m) = model.filter(|m| !m.is_empty()) {
        cmd.args(["--model", m]);
    }
    let out = capture(cmd, Duration::from_secs(260)).await;
    let _ = std::fs::remove_dir_all(&dir);
    let out = match out {
        Ok(o) => o,
        Err(e) => return Ask::Fail(e),
    };
    let text = format!("{}
{}", out.stdout, out.stderr);
    if mentions_signed_out(&text) {
        return Ask::Fail("Antigravity is signed out.".into());
    }
    if mentions_rate_limit(&text) && out.code != Some(0) {
        return Ask::Fail("You’ve reached Antigravity’s usage limit for now.".into());
    }
    let why = || {
        if out.stderr.contains("auto-denied") {
            "The agent tried to use a tool instead of answering. Try again.".to_string()
        } else {
            "The agent didn’t return the expected structure. Try again.".to_string()
        }
    };
    let Some(json) = out.stdout.lines().rev().find_map(|l| serde_json::from_str::<Value>(l.trim()).ok()) else {
        let e = out.stderr.trim();
        return Ask::Retry(if e.is_empty() { "agy returned no readable answer.".into() } else { e.chars().take(400).collect() });
    };
    // agy sometimes leaves structured_output empty and puts the JSON only in
    // the text response (occasionally inside a ```json fence); recover it there.
    match json
        .get("structured_output")
        .cloned()
        .filter(|v| v.is_object())
        .or_else(|| json["response"].as_str().and_then(object_in))
    {
        Some(data) => Ask::Done(AskResult {
            data,
            conversation_id: json["conversation_id"].as_str().map(str::to_string),
        }),
        None => Ask::Retry(why()),
    }
}

/// The JSON object in a model's text answer: the whole text, or the span
/// from its first `{` to its last `}`.
pub(crate) fn object_in(text: &str) -> Option<Value> {
    let t = text.trim();
    let parse = |s: &str| serde_json::from_str::<Value>(s).ok().filter(Value::is_object);
    parse(t).or_else(|| parse(&t[t.find('{')?..=t.rfind('}')?]))
}
