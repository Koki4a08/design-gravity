//! Latest published versions of the agent CLIs, so the app can offer an
//! update. Fetched with the system's own `curl` (shipped with Windows 10+,
//! macOS and every common Linux) to keep an HTTP stack out of the binary.

use serde_json::Value;
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// agy's own auto-updater; its root page names the current stable release.
const AGY_UPDATER: &str = "https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/";
/// Codex ships every release to npm, whatever the local install method.
const CODEX_LATEST: &str = "https://registry.npmjs.org/@openai/codex/latest";

fn curl() -> Command {
    // The System32 copy, so a stray curl earlier on PATH is never picked up.
    #[cfg(windows)]
    let exe = std::env::var_os("SystemRoot")
        .map(|root| std::path::PathBuf::from(root).join("System32").join("curl.exe"))
        .filter(|p| p.is_file())
        .unwrap_or_else(|| "curl".into());
    #[cfg(not(windows))]
    let exe = std::path::PathBuf::from("curl");
    let mut cmd = Command::new(exe);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

async fn fetch(url: &str) -> Result<String, String> {
    let mut cmd = curl();
    cmd.args(["-fsSL", "--max-time", "15", url]);
    let out = tokio::time::timeout(Duration::from_secs(20), cmd.output())
        .await
        .map_err(|_| "The version check timed out.".to_string())?
        .map_err(|e| format!("Could not run curl: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "Version check failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// "… Stable Version: 1.2.16. Rolled out to 100%" -> "1.2.16".
fn agy_stable(page: &str) -> Option<String> {
    let rest = &page[page.find("Stable Version:")? + "Stable Version:".len()..];
    let version: String = rest
        .trim_start()
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    let version = version.trim_end_matches('.');
    (!version.is_empty()).then(|| version.to_string())
}

/// The newest published version of a provider's CLI, or None when the
/// source answered but named no version.
#[tauri::command]
pub async fn cli_latest_version(provider: String) -> Result<Option<String>, String> {
    if provider == "codex" {
        let body = fetch(CODEX_LATEST).await?;
        let json: Value = serde_json::from_str(&body).map_err(|e| format!("Unexpected npm answer: {e}"))?;
        Ok(json.get("version").and_then(Value::as_str).map(str::to_string))
    } else {
        Ok(agy_stable(&fetch(AGY_UPDATER).await?))
    }
}

#[cfg(test)]
mod tests {
    use super::agy_stable;

    #[test]
    fn reads_the_stable_version() {
        let page = "Antigravity CLI auto updater is running! Stable Version: 1.2.16. Rolled out to 100%";
        assert_eq!(agy_stable(page).as_deref(), Some("1.2.16"));
        assert_eq!(agy_stable("nothing here"), None);
    }
}
