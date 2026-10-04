//! OpenAI Codex CLI (`codex`) harness: the same contract as `agy.rs`
//! (status, ping, sign-in, streamed agent runs, structured answers), driven
//! through `codex exec --json`. Runs share the `agent-event` / `agent-exit`
//! channel and the cancel registry with Antigravity.

use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Notify;

use crate::agy::{
    mentions_rate_limit, mentions_signed_out, now_ms, object_in, AgyModel, AgyStatus, AskResult, PingResult, Runs,
};
use crate::designs;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Extra phrases Codex uses when its ChatGPT or API-key login is gone. Only
/// ever matched against error events, never against the agent's own words.
const SIGNED_OUT_MARKERS: [&str; 5] = [
    "log out and sign in again",
    "token could not be refreshed",
    "401 unauthorized",
    "sign in again",
    "codex login",
];
const LIMIT_MARKERS: [&str; 2] = ["usage limit", "hit your"];

fn signed_out(text: &str) -> bool {
    let lower = text.to_lowercase();
    mentions_signed_out(text) || SIGNED_OUT_MARKERS.iter().any(|m| lower.contains(m))
}

fn rate_limited(text: &str) -> bool {
    let lower = text.to_lowercase();
    mentions_rate_limit(text) || LIMIT_MARKERS.iter().any(|m| lower.contains(m))
}

/// Resolve the codex executable: explicit override, then PATH, then the
/// usual per-user install folders (GUI apps often start without the shell's PATH).
pub fn resolve_codex(override_path: Option<&str>) -> Option<PathBuf> {
    if let Some(p) = override_path.map(str::trim).filter(|p| !p.is_empty()) {
        let path = PathBuf::from(p);
        return path.is_file().then_some(path);
    }
    let names: &[&str] = if cfg!(windows) { &["codex.exe", "codex.cmd"] } else { &["codex"] };
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
    let mut fallbacks: Vec<PathBuf> = vec![];
    if cfg!(windows) {
        if let Some(d) = std::env::var_os("APPDATA") {
            fallbacks.push(PathBuf::from(d).join("npm").join("codex.cmd"));
        }
    } else {
        if let Some(d) = std::env::var_os("HOME") {
            fallbacks.push(PathBuf::from(&d).join(".local").join("bin").join("codex"));
            fallbacks.push(PathBuf::from(d).join(".npm-global").join("bin").join("codex"));
        }
        fallbacks.push(PathBuf::from("/opt/homebrew/bin/codex"));
        fallbacks.push(PathBuf::from("/usr/local/bin/codex"));
    }
    fallbacks.into_iter().find(|p| p.is_file())
}

/// `piped_stdin` is for runs that receive their prompt on stdin; everything
/// else must get EOF immediately or `codex exec` waits for input.
fn command(exe: &Path, piped_stdin: bool) -> Command {
    let mut cmd = Command::new(exe);
    cmd.stdin(if piped_stdin { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// npm installs codex behind a `.cmd` shim, so killing the direct child
/// leaves the real process running; on Windows take the whole tree down.
async fn kill_tree(child: &mut Child) {
    #[cfg(windows)]
    if let Some(pid) = child.id() {
        let mut k = Command::new("taskkill");
        k.args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW);
        let _ = k.status().await;
    }
    let _ = child.kill().await;
}

async fn send_prompt(child: &mut Child, prompt: &str) -> Result<(), String> {
    let mut stdin = child.stdin.take().ok_or("codex stdin unavailable")?;
    stdin
        .write_all(prompt.as_bytes())
        .await
        .map_err(|e| format!("Could not send the prompt to codex: {e}"))?;
    Ok(())
}

struct Captured {
    code: Option<i32>,
    stdout: String,
    stderr: String,
}

async fn capture(mut cmd: Command, prompt: Option<&str>, limit: Duration) -> Result<Captured, String> {
    let mut child = cmd.spawn().map_err(|e| format!("Could not start codex: {e}"))?;
    if let Some(p) = prompt {
        send_prompt(&mut child, p).await?;
    }
    let mut stdout = child.stdout.take().ok_or("codex stdout unavailable")?;
    let mut stderr = child.stderr.take().ok_or("codex stderr unavailable")?;
    let read = async {
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let _ = tokio::join!(stdout.read_to_end(&mut out), stderr.read_to_end(&mut err));
        (out, err)
    };
    match tokio::time::timeout(limit, read).await {
        Ok((out, err)) => {
            let code = child.wait().await.ok().and_then(|s| s.code());
            Ok(Captured {
                code,
                stdout: String::from_utf8_lossy(&out).into_owned(),
                stderr: String::from_utf8_lossy(&err).into_owned(),
            })
        }
        Err(_) => {
            kill_tree(&mut child).await;
            Err(format!("codex did not answer within {}s", limit.as_secs()))
        }
    }
}

/// "gpt-6-astra" -> "gpt-6", "gpt-5.6-sol" -> "gpt-5.6", "gpt-5.5" -> "gpt-5.5".
fn generation(slug: &str) -> &str {
    match slug.match_indices('-').nth(1) {
        Some((i, _)) => &slug[..i],
        None => slug,
    }
}

/// Models the CLI offers to pick, from `codex debug models`, best first.
/// Anything outside the generation of the top model counts as legacy.
fn parse_models(stdout: &str) -> Vec<AgyModel> {
    let Ok(json) = serde_json::from_str::<Value>(stdout.trim()) else {
        return vec![];
    };
    let mut listed: Vec<&Value> = json["models"]
        .as_array()
        .map(|l| l.iter().filter(|m| m["visibility"].as_str() == Some("list")).collect())
        .unwrap_or_default();
    listed.sort_by_key(|m| m["priority"].as_i64().unwrap_or(i64::MAX));
    let current = listed.first().and_then(|m| m["slug"].as_str()).map(generation).map(str::to_string);
    listed
        .into_iter()
        .filter_map(|m| {
            let id = m["slug"].as_str()?.trim();
            if id.is_empty() {
                return None;
            }
            let label = m["display_name"].as_str().unwrap_or(id).trim();
            Some(AgyModel {
                id: id.to_string(),
                label: label.to_string(),
                legacy: current.as_deref().is_some_and(|g| generation(id) != g),
            })
        })
        .collect()
}

/// Flags every headless turn shares. `--ignore-user-config` keeps the user's
/// own MCP servers, hooks, notifiers and default model out of a design run
/// (auth still comes from CODEX_HOME); the rest is set here explicitly.
/// Values are unquoted on purpose: a bare word is taken literally, and quotes
/// would have to survive Windows `.cmd` argument escaping.
fn base_args(sandbox: &str, model: Option<&str>, effort: Option<&str>) -> Vec<String> {
    let mut a: Vec<String> = ["--json", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules"]
        .map(String::from)
        .into();
    let mut cfg = |kv: String| {
        a.push("-c".into());
        a.push(kv);
    };
    cfg("approval_policy=never".into());
    cfg(format!("sandbox_mode={sandbox}"));
    // The elevated Windows sandbox needs a one-time admin setup that often
    // fails; the restricted-token one works unprivileged and still confines
    // writes to the workspace.
    if cfg!(windows) {
        cfg("windows.sandbox=unelevated".into());
    }
    if let Some(e) = effort.filter(|e| !e.is_empty()) {
        cfg(format!("model_reasoning_effort={e}"));
    }
    if let Some(m) = model.filter(|m| !m.is_empty()) {
        a.push("-m".into());
        a.push(m.into());
    }
    a
}

fn final_text(stdout: &str) -> Option<String> {
    let mut last = None;
    for line in stdout.lines() {
        let Ok(ev) = serde_json::from_str::<Value>(line.trim()) else { continue };
        if ev["type"] == "item.completed" && ev["item"]["type"] == "agent_message" {
            if let Some(t) = ev["item"]["text"].as_str() {
                last = Some(t.to_string());
            }
        }
    }
    last
}

/// The message of the last failure event (`error` or `turn.failed`), if any.
fn failure_message(ev: &Value) -> Option<String> {
    match ev["type"].as_str()? {
        "error" => ev["message"].as_str().map(str::to_string),
        "turn.failed" => ev["error"]["message"].as_str().map(str::to_string),
        _ => None,
    }
}

/// Four-stage check: executable present, version answers, login valid, then
/// the model catalogue.
#[tauri::command]
pub async fn codex_status(codex_path: Option<String>) -> AgyStatus {
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

    let Some(exe) = resolve_codex(codex_path.as_deref()) else {
        status.detail = Some(match codex_path.filter(|p| !p.trim().is_empty()) {
            Some(p) => format!("No codex executable at {p}."),
            None => "codex was not found on PATH or in the usual install folders.".into(),
        });
        return status;
    };
    status.path = Some(exe.display().to_string());

    let mut version = command(&exe, false);
    version.arg("--version");
    match capture(version, None, Duration::from_secs(20)).await {
        Ok(out) if out.code == Some(0) => {
            status.installed = true;
            status.version = out
                .stdout
                .lines()
                .next()
                .map(|l| l.trim().trim_start_matches("codex-cli").trim().to_string())
                .filter(|v| !v.is_empty());
        }
        Ok(out) => {
            status.detail = Some(format!(
                "codex --version exited with {}: {}",
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

    let mut login = command(&exe, false);
    login.args(["login", "status"]);
    match capture(login, None, Duration::from_secs(20)).await {
        Ok(out) => {
            let text = format!("{}\n{}", out.stdout.trim(), out.stderr.trim());
            if out.code == Some(0) && !mentions_signed_out(&text) {
                status.authenticated = true;
                // "Logged in using ChatGPT" / "Logged in using an API key"
                let how = text.to_lowercase();
                status.auth_method = Some(if how.contains("chatgpt") { "chatgpt" } else if how.contains("api key") { "api-key" } else { "signed in" }.into());
            } else {
                status.detail = Some("Codex reports that no account is signed in.".into());
            }
        }
        Err(e) => status.detail = Some(e),
    }

    if status.authenticated {
        let mut models = command(&exe, false);
        models.args(["debug", "models"]);
        match capture(models, None, Duration::from_secs(30)).await {
            Ok(out) if out.code == Some(0) => status.models = parse_models(&out.stdout),
            Ok(_) | Err(_) => {}
        }
    }
    status
}

/// Deep check: one real headless turn. Proves the login still works and the
/// model is reachable, not just that credentials exist on disk.
#[tauri::command]
pub async fn codex_ping(codex_path: Option<String>, model: Option<String>) -> PingResult {
    let started = Instant::now();
    let fail = |detail: String| PingResult {
        ok: false,
        latency_ms: started.elapsed().as_millis() as u64,
        model: None,
        detail: Some(detail),
    };
    let Some(exe) = resolve_codex(codex_path.as_deref()) else {
        return fail("codex is not installed.".into());
    };
    let dir = std::env::temp_dir().join("design-gravity-ping");
    let _ = std::fs::create_dir_all(&dir);

    let mut cmd = command(&exe, true);
    cmd.current_dir(&dir).arg("exec").args(base_args("read-only", model.as_deref(), Some("low"))).args(["--ephemeral", "-"]);
    let out = match capture(cmd, Some("Reply with exactly the single word READY and nothing else."), Duration::from_secs(100)).await {
        Ok(out) => out,
        Err(e) => return fail(e),
    };
    let failure = out
        .stdout
        .lines()
        .filter_map(|l| serde_json::from_str::<Value>(l.trim()).ok())
        .filter_map(|ev| failure_message(&ev))
        .last();
    if let Some(msg) = &failure {
        if signed_out(msg) {
            return fail("Codex reports that no account is signed in.".into());
        }
    }
    let answer = final_text(&out.stdout);
    let ok = out.code == Some(0) && answer.as_deref().is_some_and(|r| r.to_uppercase().contains("READY"));
    PingResult {
        ok,
        latency_ms: started.elapsed().as_millis() as u64,
        model,
        detail: (!ok).then(|| match (failure, answer) {
            (Some(msg), _) => msg.chars().take(400).collect(),
            (None, Some(a)) => format!("Unexpected answer: {a}"),
            (None, None) => "codex returned no readable result.".into(),
        }),
    }
}

/// Update codex with its own updater (`codex update`), which detects how it
/// was installed (npm, Homebrew, standalone) and runs the matching upgrade.
#[tauri::command]
pub async fn codex_update(codex_path: Option<String>) -> Result<String, String> {
    let exe = resolve_codex(codex_path.as_deref()).ok_or("codex is not installed.")?;
    let mut cmd = command(&exe, false);
    cmd.arg("update");
    let out = capture(cmd, None, Duration::from_secs(600)).await?;
    let text = format!("{}
{}", out.stdout.trim(), out.stderr.trim()).trim().to_string();
    if out.code == Some(0) {
        Ok(text)
    } else if text.is_empty() {
        Err(format!("codex update exited with {}", out.code.map_or("a signal".into(), |c| c.to_string())))
    } else {
        Err(text)
    }
}

/// Open `codex login` in its own terminal; the app keeps polling
/// `codex_status` until the account resolves.
#[tauri::command]
pub async fn codex_open_sign_in(codex_path: Option<String>) -> Result<(), String> {
    let exe = resolve_codex(codex_path.as_deref()).ok_or("codex is not installed.")?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("cmd")
            .args(["/C", "start", "Codex sign-in"])
            .arg(&exe)
            .arg("login")
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Could not open a terminal: {e}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        let script = format!("tell application \"Terminal\" to do script \"'{}' login\"", exe.display());
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
            .arg("login")
            .spawn()
            .map_err(|e| format!("Could not open a terminal: {e}"))?;
    }
    Ok(())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CodexEvent {
    design_id: String,
    event: Value,
}

/// Same shape as Antigravity's exit payload, tagged with its provider.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CodexExit {
    design_id: String,
    provider: &'static str,
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

/// Run one agent turn inside the design's workspace. Every JSONL event is
/// forwarded as `agent-event`; completion arrives as `agent-exit`.
#[tauri::command]
pub async fn codex_run(
    app: AppHandle,
    runs: State<'_, Runs>,
    design_id: String,
    prompt: String,
    model: Option<String>,
    conversation_id: Option<String>,
    effort: Option<String>,
    codex_path: Option<String>,
    scope: Option<String>,
    dir: Option<String>,
) -> Result<(), String> {
    let exe = resolve_codex(codex_path.as_deref()).ok_or("codex is not installed.")?;
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

    let mut cmd = command(&exe, true);
    cmd.current_dir(&workspace).arg("exec");
    // Resuming keeps the thread's history; the session id comes from the
    // `thread.started` event of the run that created it.
    if let Some(c) = conversation_id.as_deref().filter(|c| !c.is_empty()) {
        cmd.args(["resume", c]);
    }
    cmd.args(base_args("workspace-write", model.as_deref(), effort.as_deref())).arg("-");

    let started = async {
        let mut child = cmd.spawn().map_err(|e| format!("Could not start codex: {e}"))?;
        send_prompt(&mut child, &prompt).await?;
        Ok::<Child, String>(child)
    }
    .await;
    let mut child = match started {
        Ok(child) => child,
        Err(e) => {
            runs.0.lock().await.remove(&design_id);
            return Err(e);
        }
    };
    let Some(stdout) = child.stdout.take() else {
        runs.0.lock().await.remove(&design_id);
        return Err("codex stdout unavailable".into());
    };
    let Some(mut stderr) = child.stderr.take() else {
        runs.0.lock().await.remove(&design_id);
        return Err("codex stderr unavailable".into());
    };

    let app_task = app.clone();
    tauri::async_runtime::spawn(async move {
        let stderr_task = tauri::async_runtime::spawn(async move {
            let mut buf = Vec::new();
            let _ = stderr.read_to_end(&mut buf).await;
            String::from_utf8_lossy(&buf).into_owned()
        });

        let mut conversation: Option<String> = conversation_id.filter(|c| !c.is_empty());
        let mut response: Option<String> = None;
        let mut result_ok = false;
        let mut auth_lost = false;
        let mut limited = false;
        let mut failure: Option<String> = None;
        let mut usage: Option<Value> = None;
        let mut lines = BufReader::new(stdout).lines();

        let read_loop = async {
            while let Ok(Some(line)) = lines.next_line().await {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let Ok(event) = serde_json::from_str::<Value>(trimmed) else {
                    continue;
                };
                match event["type"].as_str() {
                    Some("thread.started") => {
                        if let Some(id) = event["thread_id"].as_str() {
                            conversation = Some(id.to_string());
                        }
                    }
                    Some("item.completed") if event["item"]["type"] == "agent_message" => {
                        response = event["item"]["text"].as_str().map(str::to_string);
                    }
                    Some("turn.completed") => {
                        result_ok = true;
                        let u = &event["usage"];
                        let (i, o) = (u["input_tokens"].as_u64().unwrap_or(0), u["output_tokens"].as_u64().unwrap_or(0));
                        usage = Some(json!({ "input_tokens": i, "output_tokens": o, "total_tokens": i + o }));
                    }
                    _ => {}
                }
                if let Some(msg) = failure_message(&event) {
                    if signed_out(&msg) {
                        auth_lost = true;
                    }
                    if rate_limited(&msg) {
                        limited = true;
                    }
                    failure = Some(msg);
                }
                let _ = app_task.emit("agent-event", CodexEvent { design_id: design_id.clone(), event });
            }
        };

        let cancelled = tokio::select! {
            _ = read_loop => false,
            _ = cancel.notified() => true,
        };
        if cancelled {
            kill_tree(&mut child).await;
        }
        let code = child.wait().await.ok().and_then(|s| s.code());
        let stderr_text = stderr_task.await.unwrap_or_default();
        // A failed sign-in often only shows on stderr; match just the plain
        // markers there, since its other lines are unrelated noise.
        if mentions_signed_out(&stderr_text) {
            auth_lost = true;
        }
        let tail: String = {
            let kept: Vec<&str> = stderr_text
                .lines()
                .filter(|l| !l.contains("rmcp::") && !l.contains("failed to load skill"))
                .collect();
            let t = kept.join("\n");
            let t = t.trim();
            let skip = t.chars().count().saturating_sub(600);
            t.chars().skip(skip).collect()
        };

        app_task.state::<Runs>().0.lock().await.remove(&design_id);
        let ok = !cancelled && result_ok && code == Some(0);
        let _ = app_task.emit(
            "agent-exit",
            CodexExit {
                design_id: design_id.clone(),
                provider: "codex",
                ok,
                cancelled,
                code,
                auth_lost,
                rate_limited: limited && !ok,
                usage,
                model,
                conversation_id: conversation,
                response,
                detail: (!ok && !cancelled).then(|| failure.unwrap_or(tail)).filter(|d| !d.is_empty()),
            },
        );
    });
    Ok(())
}

/// Codex's structured outputs are strict: every property must be listed in
/// `required` and objects must be closed. Properties the caller left optional
/// become nullable so the model may still omit them; `strip_nulls` removes
/// those nulls from the answer again.
fn strictify(schema: &mut Value) {
    match schema {
        Value::Object(map) => {
            let closed = map.get("type").and_then(Value::as_str) == Some("object")
                && map.get("properties").is_some_and(Value::is_object);
            if closed {
                let required: Vec<String> = map
                    .get("required")
                    .and_then(Value::as_array)
                    .map(|r| r.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
                    .unwrap_or_default();
                let mut keys = vec![];
                if let Some(Value::Object(props)) = map.get_mut("properties") {
                    for (k, p) in props.iter_mut() {
                        keys.push(Value::String(k.clone()));
                        if !required.contains(k) {
                            nullable(p);
                        }
                    }
                }
                map.insert("required".into(), Value::Array(keys));
                map.insert("additionalProperties".into(), Value::Bool(false));
            }
            for v in map.values_mut() {
                strictify(v);
            }
        }
        Value::Array(list) => list.iter_mut().for_each(strictify),
        _ => {}
    }
}

fn nullable(prop: &mut Value) {
    let Value::Object(p) = prop else { return };
    match p.get("type").cloned() {
        Some(Value::String(t)) => {
            p.insert("type".into(), json!([t, "null"]));
        }
        Some(Value::Array(mut ts)) => {
            if !ts.iter().any(|t| t == "null") {
                ts.push(json!("null"));
            }
            p.insert("type".into(), Value::Array(ts));
        }
        _ => {}
    }
    if let Some(Value::Array(e)) = p.get_mut("enum") {
        if !e.iter().any(Value::is_null) {
            e.push(Value::Null);
        }
    }
}

fn strip_nulls(v: &mut Value) {
    match v {
        Value::Object(map) => {
            map.retain(|_, x| !x.is_null());
            map.values_mut().for_each(strip_nulls);
        }
        Value::Array(list) => list.iter_mut().for_each(strip_nulls),
        _ => {}
    }
}

enum Ask {
    Done(AskResult),
    Retry(String),
    Fail(String),
}

/// One headless turn that must answer with JSON matching `schema`
/// (`--output-schema`). Read-only: with a design id the agent answers from
/// inside that design's workspace, e.g. to critique it.
#[tauri::command]
pub async fn codex_ask(
    prompt: String,
    schema: Value,
    model: Option<String>,
    codex_path: Option<String>,
    design_id: Option<String>,
    app: AppHandle,
) -> Result<AskResult, String> {
    let exe = resolve_codex(codex_path.as_deref()).ok_or("codex is not installed.")?;
    let cwd = match design_id.as_deref() {
        Some(id) => Some(designs::design_dir(&app, id)?),
        None => None,
    };
    let mut strict = schema;
    strictify(&mut strict);
    let mut reason = String::new();
    for _ in 0..2 {
        match ask_once(&exe, &prompt, &strict, model.as_deref(), cwd.as_deref()).await {
            Ask::Done(r) => return Ok(r),
            Ask::Fail(e) => return Err(e),
            Ask::Retry(e) => reason = e,
        }
    }
    Err(reason)
}

async fn ask_once(exe: &Path, prompt: &str, schema: &Value, model: Option<&str>, cwd: Option<&Path>) -> Ask {
    let dir = std::env::temp_dir().join(format!("design-gravity-codex-ask-{}", now_ms()));
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return Ask::Fail(e.to_string());
    }
    let schema_path = dir.join("schema.json");
    if let Err(e) = std::fs::write(&schema_path, schema.to_string()) {
        return Ask::Fail(e.to_string());
    }

    let mut cmd = command(exe, true);
    cmd.current_dir(cwd.unwrap_or(&dir))
        .arg("exec")
        .args(base_args("read-only", model, None))
        .arg("--ephemeral")
        .arg("--output-schema")
        .arg(&schema_path)
        .arg("-");
    let out = capture(cmd, Some(prompt), Duration::from_secs(260)).await;
    let _ = std::fs::remove_dir_all(&dir);
    let out = match out {
        Ok(o) => o,
        Err(e) => return Ask::Fail(e),
    };
    let failure = out
        .stdout
        .lines()
        .filter_map(|l| serde_json::from_str::<Value>(l.trim()).ok())
        .filter_map(|ev| failure_message(&ev))
        .last();
    if let Some(msg) = &failure {
        if signed_out(msg) {
            return Ask::Fail("Codex is signed out.".into());
        }
        if rate_limited(msg) {
            return Ask::Fail("You’ve reached Codex’s usage limit for now.".into());
        }
    }
    let Some(text) = final_text(&out.stdout) else {
        return Ask::Retry(match failure {
            Some(msg) => msg.chars().take(400).collect(),
            None => "codex returned no readable answer.".into(),
        });
    };
    match object_in(&text) {
        Some(mut data) => {
            strip_nulls(&mut data);
            Ask::Done(AskResult { data, conversation_id: None })
        }
        None => Ask::Retry("The agent didn’t return the expected structure. Try again.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strictify_closes_objects_and_makes_optionals_nullable() {
        let mut s = json!({
            "type": "object",
            "properties": {
                "name": { "type": "string" },
                "hint": { "type": "string" },
                "kind": { "type": "string", "enum": ["a", "b"] },
                "items": { "type": "array", "items": { "type": "object", "properties": { "id": { "type": "string" }, "note": { "type": "string" } }, "required": ["id"] } }
            },
            "required": ["name", "items"]
        });
        strictify(&mut s);
        assert_eq!(s["additionalProperties"], false);
        assert_eq!(s["required"].as_array().unwrap().len(), 4);
        assert_eq!(s["properties"]["name"]["type"], "string");
        assert_eq!(s["properties"]["hint"]["type"], json!(["string", "null"]));
        assert!(s["properties"]["kind"]["enum"].as_array().unwrap().contains(&Value::Null));
        let inner = &s["properties"]["items"]["items"];
        assert_eq!(inner["additionalProperties"], false);
        assert_eq!(inner["properties"]["note"]["type"], json!(["string", "null"]));
        assert_eq!(inner["properties"]["id"]["type"], "string");
    }

    #[test]
    fn strip_nulls_drops_omitted_optionals() {
        let mut v = json!({ "a": null, "b": [{ "c": null, "d": 1 }] });
        strip_nulls(&mut v);
        assert_eq!(v, json!({ "b": [{ "d": 1 }] }));
    }

    #[test]
    fn older_generations_are_legacy() {
        let out = r#"{"models":[{"slug":"gpt-5.5","priority":13,"visibility":"list"},{"slug":"gpt-6-sol","priority":3,"visibility":"list"},{"slug":"gpt-6-astra","priority":2,"visibility":"list"},{"slug":"gpt-5.6-luna","priority":9,"visibility":"list"}]}"#;
        let m = parse_models(out);
        let ids: Vec<_> = m.iter().map(|x| (x.id.as_str(), x.legacy)).collect();
        assert_eq!(ids, [("gpt-6-astra", false), ("gpt-6-sol", false), ("gpt-5.6-luna", true), ("gpt-5.5", true)]);
    }

    #[test]
    fn models_keep_only_listed_ones() {
        let out = r#"{"models":[{"slug":"gpt-5.5","display_name":"GPT-5.5","visibility":"list"},{"slug":"hidden","display_name":"H","visibility":"hide"}]}"#;
        let m = parse_models(out);
        assert_eq!(m.len(), 1);
        assert_eq!(m[0].id, "gpt-5.5");
        assert_eq!(m[0].label, "GPT-5.5");
    }

    #[test]
    fn final_text_takes_last_agent_message() {
        let out = "{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"first\"}}\n{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"last\"}}\n";
        assert_eq!(final_text(out).as_deref(), Some("last"));
    }

    #[test]
    fn sign_out_is_detected_from_error_text() {
        assert!(signed_out("Your access token could not be refreshed. Please log out and sign in again."));
        assert!(!signed_out("Created hello.txt"));
        assert!(rate_limited("You've hit your usage limit"));
    }

    // Against the real CLI: `cargo test -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore = "needs a signed-in codex CLI"]
    async fn live_status_ping_and_ask() {
        let st = codex_status(None).await;
        println!("{} {:?} {:?} models={}", st.installed, st.version, st.auth_method, st.models.len());
        assert!(st.installed && st.authenticated, "{:?}", st.detail);
        assert!(!st.models.is_empty());

        let ping = codex_ping(None, None).await;
        println!("ping {:?}", ping.detail);
        assert!(ping.ok);

        let mut schema = json!({
            "type": "object",
            "properties": {
                "name": { "type": "string" },
                "questions": { "type": "array", "items": { "type": "object", "properties": {
                    "id": { "type": "string" }, "title": { "type": "string" }, "why": { "type": "string" },
                    "visual": { "type": "string", "enum": ["palette", "text"] } }, "required": ["id", "title", "visual"] } }
            },
            "required": ["name", "questions"]
        });
        strictify(&mut schema);
        let exe = resolve_codex(None).unwrap();
        match ask_once(&exe, "Return name 'Test' and exactly one question with id q1, title 'Pick one', visual text.", &schema, None, None).await {
            Ask::Done(r) => { println!("{}", r.data); assert_eq!(r.data["questions"][0]["id"], "q1"); }
            Ask::Retry(e) | Ask::Fail(e) => panic!("{e}"),
        }
    }

    /// The flags, stdin prompt and sandbox `codex_run` uses, then a resumed turn.
    #[tokio::test]
    #[ignore = "needs a signed-in codex CLI"]
    async fn live_write_turn_and_resume() {
        let dir = std::env::temp_dir().join(format!("dg-codex-run-{}", now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        let exe = resolve_codex(None).unwrap();

        let mut cmd = command(&exe, true);
        cmd.current_dir(&dir).arg("exec").args(base_args("workspace-write", None, Some("low"))).arg("-");
        let out = capture(cmd, Some("Create design.html containing <h1>Hi</h1>. Reply DONE."), Duration::from_secs(180)).await.unwrap();
        assert_eq!(out.code, Some(0), "{}", out.stderr);
        let events: Vec<Value> = out.stdout.lines().filter_map(|l| serde_json::from_str(l.trim()).ok()).collect();
        let thread = events.iter().find(|e| e["type"] == "thread.started").expect("thread.started")["thread_id"].as_str().unwrap().to_string();
        assert!(events.iter().any(|e| e["type"] == "turn.completed"));
        assert!(dir.join("design.html").is_file(), "no file written: {}", out.stdout);

        let mut cmd = command(&exe, true);
        cmd.current_dir(&dir).args(["exec", "resume", &thread]).args(base_args("workspace-write", None, Some("low"))).arg("-");
        let out = capture(cmd, Some("Change the heading in design.html to <h1>Bye</h1>. Reply DONE."), Duration::from_secs(180)).await.unwrap();
        assert_eq!(out.code, Some(0), "{}", out.stderr);
        assert!(std::fs::read_to_string(dir.join("design.html")).unwrap().contains("Bye"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
