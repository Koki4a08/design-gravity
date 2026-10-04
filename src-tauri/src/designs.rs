//! Design storage: one workspace folder per design under the app data dir.
//! `meta.json` is owned by the front end; the agent writes the design next to
//! it, either as a small React project (`app/page.tsx`, `components/`,
//! `styles/globals.css`) or, for graphics and older designs, as `design.svg`
//! or `design.html`.

use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const ARTIFACTS: [&str; 2] = ["design.html", "design.svg"];

/// A project design: the page the preview renders, and the folders it lives in.
const PROJECT_ENTRY: &str = "app/page.tsx";
const PROJECT_DIRS: [&str; 3] = ["app", "components", "styles"];
const PROJECT_EXTS: [&str; 5] = ["tsx", "ts", "jsx", "js", "css"];
const MAX_PROJECT_FILE: u64 = 1024 * 1024;
const MAX_PROJECT_FILES: usize = 200;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Artifact {
    pub file: String,
    /// The document itself; empty for a project, which the front end renders from `files`.
    pub content: String,
    pub modified_ms: u64,
    /// Project designs: every source file, keyed by path relative to the workspace.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files: Option<BTreeMap<String, String>>,
}

fn mtime_ms(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as u64)
}

fn collect_project(root: &Path, dir: &Path, out: &mut BTreeMap<String, String>, newest: &mut u64) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        if out.len() >= MAX_PROJECT_FILES {
            return;
        }
        let path = entry.path();
        if path.is_dir() {
            collect_project(root, &path, out, newest);
            continue;
        }
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        if !PROJECT_EXTS.contains(&ext.as_str()) || fs::metadata(&path).map_or(true, |m| m.len() > MAX_PROJECT_FILE) {
            continue;
        }
        let Ok(text) = fs::read_to_string(&path) else { continue };
        let Ok(rel) = path.strip_prefix(root) else { continue };
        let key = rel.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/");
        *newest = (*newest).max(mtime_ms(&path));
        out.insert(key, text);
    }
}

/// The project under `root` (a workspace or a saved version), if it has a page.
fn read_project(root: &Path) -> Option<(BTreeMap<String, String>, u64)> {
    if !root.join(PROJECT_ENTRY).is_file() {
        return None;
    }
    let mut files = BTreeMap::new();
    let mut newest = 0;
    for d in PROJECT_DIRS {
        collect_project(root, &root.join(d), &mut files, &mut newest);
    }
    Some((files, newest))
}

fn project_artifact(files: BTreeMap<String, String>, modified_ms: u64) -> Artifact {
    Artifact { file: PROJECT_ENTRY.into(), content: String::new(), modified_ms, files: Some(files) }
}

fn copy_project(from: &Path, to: &Path) -> std::io::Result<()> {
    for d in PROJECT_DIRS {
        copy_dir(&from.join(d), &to.join(d))?;
    }
    Ok(())
}

/// The design in a workspace right now: one artifact file, or the project.
enum Current {
    File(PathBuf),
    Project,
}

fn current(dir: &Path) -> Option<Current> {
    let file = ARTIFACTS.iter().map(|n| dir.join(n)).filter(|p| p.is_file()).max_by_key(|p| mtime_ms(p));
    let project = read_project(dir).map(|(_, t)| t);
    match (file, project) {
        (Some(f), Some(t)) if mtime_ms(&f) > t => Some(Current::File(f)),
        (_, Some(_)) => Some(Current::Project),
        (Some(f), None) => Some(Current::File(f)),
        (None, None) => None,
    }
}

/// Remove whatever design the workspace holds, before another takes its place.
fn clear_current(dir: &Path) -> std::io::Result<()> {
    for name in ARTIFACTS {
        let p = dir.join(name);
        if p.is_file() {
            fs::remove_file(p)?;
        }
    }
    for d in PROJECT_DIRS {
        let p = dir.join(d);
        if p.is_dir() {
            fs::remove_dir_all(p)?;
        }
    }
    Ok(())
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub fn root_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No app data folder: {e}"))?
        .join("designs");
    fs::create_dir_all(&dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    Ok(dir)
}

pub fn design_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("Invalid design id.".into());
    }
    Ok(root_dir(app)?.join(id))
}

#[tauri::command]
pub fn designs_list(app: AppHandle) -> Result<Vec<Value>, String> {
    let mut out = Vec::new();
    for entry in fs::read_dir(root_dir(&app)?).map_err(|e| e.to_string())?.flatten() {
        let meta = entry.path().join("meta.json");
        if let Ok(text) = fs::read_to_string(&meta) {
            if let Ok(value) = serde_json::from_str::<Value>(&text) {
                out.push(value);
            }
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn design_save_meta(app: AppHandle, id: String, meta: Value) -> Result<(), String> {
    let dir = design_dir(&app, &id)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
    let tmp = dir.join("meta.json.tmp");
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, dir.join("meta.json")).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn design_read_artifact(app: AppHandle, id: String) -> Result<Option<Artifact>, String> {
    let dir = design_dir(&app, &id)?;
    Ok(match current(&dir) {
        Some(Current::Project) => read_project(&dir).map(|(files, t)| project_artifact(files, t)),
        Some(Current::File(path)) => {
            let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
            let file = path.file_name().unwrap().to_string_lossy().into_owned();
            Some(Artifact { file, content, modified_ms: mtime_ms(&path), files: None })
        }
        None => None,
    })
}

#[tauri::command]
pub fn design_delete(app: AppHandle, id: String) -> Result<(), String> {
    let dir = design_dir(&app, &id)?;
    if dir.is_dir() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn design_dir_path(app: AppHandle, id: String) -> Result<String, String> {
    Ok(design_dir(&app, &id)?.display().to_string())
}

/// Write an export chosen through the native save dialog.
#[tauri::command]
pub fn export_write(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| format!("Could not write {path}: {e}"))
}

/// Binary exports, e.g. a project as .zip.
#[tauri::command]
pub fn export_write_bytes(path: String, bytes: Vec<u8>) -> Result<(), String> {
    fs::write(&path, bytes).map_err(|e| format!("Could not write {path}: {e}"))
}

/// A text file the agent wrote in the workspace, e.g. `export/standalone.html`.
#[tauri::command]
pub fn design_read_file(app: AppHandle, id: String, path: String) -> Result<Option<String>, String> {
    if !relative_ok(&path) {
        return Err("Invalid file path.".into());
    }
    Ok(fs::read_to_string(design_dir(&app, &id)?.join(path)).ok())
}

/// Copy the current design into `versions/` (a file, or a folder for a
/// project) and return its number.
#[tauri::command]
pub fn design_snapshot(app: AppHandle, id: String) -> Result<u32, String> {
    let dir = design_dir(&app, &id)?;
    let cur = current(&dir).ok_or("Nothing to snapshot yet.")?;
    let versions = dir.join("versions");
    fs::create_dir_all(&versions).map_err(|e| e.to_string())?;
    let next = fs::read_dir(&versions)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter_map(|e| e.path().file_stem()?.to_str()?.parse::<u32>().ok())
        .max()
        .unwrap_or(0)
        + 1;
    match cur {
        Current::File(src) => {
            let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("html");
            fs::copy(&src, versions.join(format!("{next:03}.{ext}"))).map_err(|e| e.to_string())?;
        }
        Current::Project => copy_project(&dir, &versions.join(format!("{next:03}"))).map_err(|e| e.to_string())?,
    }
    Ok(next)
}

/// Version `n`: `versions/NNN.html|svg`, or the folder `versions/NNN/` for a project.
fn version_path(dir: &Path, n: u32) -> Option<PathBuf> {
    let folder = dir.join("versions").join(format!("{n:03}"));
    if folder.join(PROJECT_ENTRY).is_file() {
        return Some(folder);
    }
    ["html", "svg"]
        .iter()
        .map(|ext| dir.join("versions").join(format!("{n:03}.{ext}")))
        .find(|p| p.is_file())
}

fn read_version_at(path: &Path) -> Result<Artifact, String> {
    if path.is_dir() {
        let (files, _) = read_project(path).ok_or("That version no longer exists.")?;
        return Ok(project_artifact(files, 0));
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let file = if path.extension().is_some_and(|e| e == "svg") { "design.svg" } else { "design.html" };
    Ok(Artifact { file: file.into(), content, modified_ms: 0, files: None })
}

#[tauri::command]
pub fn design_read_version(app: AppHandle, id: String, n: u32) -> Result<Artifact, String> {
    let dir = design_dir(&app, &id)?;
    let path = version_path(&dir, n).ok_or("That version no longer exists.")?;
    read_version_at(&path)
}

/// Make version `n` the current design again (the agent edits it next turn).
#[tauri::command]
pub fn design_restore_version(app: AppHandle, id: String, n: u32) -> Result<Artifact, String> {
    let dir = design_dir(&app, &id)?;
    let path = version_path(&dir, n).ok_or("That version no longer exists.")?;
    clear_current(&dir).map_err(|e| e.to_string())?;
    if path.is_dir() {
        copy_project(&path, &dir).map_err(|e| e.to_string())?;
    } else {
        let is_svg = path.extension().is_some_and(|e| e == "svg");
        fs::copy(&path, dir.join(if is_svg { "design.svg" } else { "design.html" })).map_err(|e| e.to_string())?;
    }
    design_read_artifact(app, id)?.ok_or_else(|| "Restore failed.".into())
}

fn safe_name(name: &str) -> String {
    let base = std::path::Path::new(name)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file");
    let cleaned: String = base
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') { c } else { '-' })
        .collect();
    let trimmed = cleaned.trim_matches('-');
    if trimmed.is_empty() { "file".into() } else { trimmed.chars().take(80).collect() }
}

/// Pick a free name under attachments/, keeping the extension.
fn free_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) => (s.to_string(), format!(".{e}")),
        None => (name.to_string(), String::new()),
    };
    (2..).map(|n| dir.join(format!("{stem}-{n}{ext}"))).find(|p| !p.exists()).unwrap()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    /// Path relative to the design workspace, e.g. "attachments/logo.png".
    pub path: String,
    pub name: String,
    pub size: u64,
}

const MAX_ATTACHMENT: u64 = 20 * 1024 * 1024;

/// Copy a file the user picked into the design's workspace.
#[tauri::command]
pub fn design_attach_file(app: AppHandle, id: String, source: String) -> Result<Attachment, String> {
    let src = PathBuf::from(&source);
    let size = fs::metadata(&src).map_err(|e| format!("Can't read {source}: {e}"))?.len();
    if size > MAX_ATTACHMENT {
        return Err("Files over 20 MB can't be attached.".into());
    }
    let dir = design_dir(&app, &id)?.join("attachments");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let target = free_path(&dir, &safe_name(&source));
    fs::copy(&src, &target).map_err(|e| e.to_string())?;
    let name = target.file_name().unwrap().to_string_lossy().into_owned();
    Ok(Attachment { path: format!("attachments/{name}"), name, size })
}

/// Save pasted or dropped bytes (e.g. a screenshot from the clipboard).
#[tauri::command]
pub fn design_attach_bytes(app: AppHandle, id: String, name: String, bytes: Vec<u8>) -> Result<Attachment, String> {
    if bytes.len() as u64 > MAX_ATTACHMENT {
        return Err("Files over 20 MB can't be attached.".into());
    }
    let dir = design_dir(&app, &id)?.join("attachments");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let target = free_path(&dir, &safe_name(&name));
    fs::write(&target, &bytes).map_err(|e| e.to_string())?;
    let name = target.file_name().unwrap().to_string_lossy().into_owned();
    Ok(Attachment { path: format!("attachments/{name}"), name, size: bytes.len() as u64 })
}

/// Image attachments as data URLs, so sandboxed previews can show designs
/// that reference `attachments/…`.
#[tauri::command]
pub fn design_attachment_urls(app: AppHandle, id: String) -> Result<std::collections::HashMap<String, String>, String> {
    use base64::Engine;
    let dir = design_dir(&app, &id)?.join("attachments");
    let mut out = std::collections::HashMap::new();
    let Ok(entries) = fs::read_dir(&dir) else { return Ok(out) };
    for entry in entries.flatten() {
        let path = entry.path();
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        let mime = match ext.as_str() {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "svg" => "image/svg+xml",
            "avif" => "image/avif",
            _ => continue,
        };
        if let Ok(bytes) = fs::read(&path) {
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            let data = base64::engine::general_purpose::STANDARD.encode(bytes);
            out.insert(format!("attachments/{name}"), format!("data:{mime};base64,{data}"));
        }
    }
    Ok(out)
}

// ---- Design systems ---------------------------------------------------------

fn systems_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No app data folder: {e}"))?
        .join("systems");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub fn system_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("Invalid design system id.".into());
    }
    Ok(systems_root(app)?.join(id))
}

#[tauri::command]
pub fn systems_list(app: AppHandle) -> Result<Vec<Value>, String> {
    let mut out = Vec::new();
    for entry in fs::read_dir(systems_root(&app)?).map_err(|e| e.to_string())?.flatten() {
        if let Ok(text) = fs::read_to_string(entry.path().join("meta.json")) {
            if let Ok(v) = serde_json::from_str::<Value>(&text) {
                out.push(v);
            }
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn system_save_meta(app: AppHandle, id: String, meta: Value) -> Result<(), String> {
    let dir = system_dir(&app, &id)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
    let tmp = dir.join("meta.json.tmp");
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, dir.join("meta.json")).map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemFiles {
    /// system.json as written by the agent (tokens), if any.
    pub spec: Option<String>,
    /// DESIGN.md, the prose rules.
    pub guide: Option<String>,
    /// preview.html, the specimen page.
    pub preview: Option<String>,
}

#[tauri::command]
pub fn system_read(app: AppHandle, id: String) -> Result<SystemFiles, String> {
    let dir = system_dir(&app, &id)?;
    let read = |n: &str| fs::read_to_string(dir.join(n)).ok();
    Ok(SystemFiles { spec: read("system.json"), guide: read("DESIGN.md"), preview: read("preview.html") })
}

#[tauri::command]
pub fn system_delete(app: AppHandle, id: String) -> Result<(), String> {
    let dir = system_dir(&app, &id)?;
    if dir.is_dir() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Copy a system's rules into a design workspace (design-system/), so the
/// agent can read them while designing. Returns false if the system is gone.
#[tauri::command]
pub fn design_use_system(app: AppHandle, design_id: String, system_id: String) -> Result<bool, String> {
    let src = system_dir(&app, &system_id)?;
    let dst = design_dir(&app, &design_id)?.join("design-system");
    if !src.is_dir() {
        return Ok(false);
    }
    fs::create_dir_all(&dst).map_err(|e| e.to_string())?;
    let mut copied = false;
    for name in ["DESIGN.md", "system.json", "preview.html"] {
        let from = src.join(name);
        if from.is_file() {
            fs::copy(&from, dst.join(name)).map_err(|e| e.to_string())?;
            copied = true;
        }
    }
    Ok(copied)
}

// ---- Branches, variants and flows -------------------------------------------

/// A path relative to a workspace: no root, no `..`.
fn relative_ok(p: &str) -> bool {
    !p.is_empty() && std::path::Path::new(p).components().all(|c| matches!(c, std::path::Component::Normal(_)))
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    if !from.is_dir() {
        return Ok(());
    }
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            copy_dir(&path, &to.join(entry.file_name()))?;
        } else {
            fs::copy(&path, to.join(entry.file_name()))?;
        }
    }
    Ok(())
}

/// Start a new design from another: its current artifact (or version `n`),
/// its design system and its attachments. With `artifact: false` only the
/// system and attachments come along (a fresh variant of the same brief).
/// Returns the new design's artifact.
#[tauri::command]
pub fn design_fork(
    app: AppHandle,
    from_id: String,
    to_id: String,
    version: Option<u32>,
    artifact: Option<bool>,
) -> Result<Option<Artifact>, String> {
    let src = design_dir(&app, &from_id)?;
    let dst = design_dir(&app, &to_id)?;
    fs::create_dir_all(&dst).map_err(|e| e.to_string())?;
    let source = match (artifact.unwrap_or(true), version) {
        (false, _) => None,
        (true, Some(n)) => version_path(&src, n),
        (true, None) => match current(&src) {
            Some(Current::File(p)) => Some(p),
            Some(Current::Project) => Some(src.clone()),
            None => None,
        },
    };
    match source {
        Some(path) if path.is_dir() => copy_project(&path, &dst).map_err(|e| e.to_string())?,
        Some(path) => {
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("html");
            fs::copy(&path, dst.join(format!("design.{ext}"))).map_err(|e| e.to_string())?;
        }
        None => {}
    }
    for sub in ["design-system", "attachments"] {
        copy_dir(&src.join(sub), &dst.join(sub)).map_err(|e| e.to_string())?;
    }
    design_read_artifact(app, to_id)
}

/// Copy another design's current artifact into this workspace under `as_name`
/// (e.g. `refs/variant-b.html`), so the agent can read it as a reference. A
/// project lands as a folder named without the extension (`refs/variant-b/`).
/// Returns the path it was written to.
#[tauri::command]
pub fn design_import(app: AppHandle, id: String, from_id: String, as_name: String) -> Result<String, String> {
    if !relative_ok(&as_name) {
        return Err("Invalid reference name.".into());
    }
    let src_dir = design_dir(&app, &from_id)?;
    let dst_dir = design_dir(&app, &id)?;
    match current(&src_dir).ok_or("That design has nothing to borrow yet.")? {
        Current::Project => {
            let name = as_name.rsplit_once('.').map_or(as_name.as_str(), |(stem, _)| stem).to_string();
            let dst = dst_dir.join(&name);
            if dst.is_dir() {
                fs::remove_dir_all(&dst).map_err(|e| e.to_string())?;
            }
            copy_project(&src_dir, &dst).map_err(|e| e.to_string())?;
            Ok(format!("{name}/"))
        }
        Current::File(src) => {
            let dst = dst_dir.join(&as_name);
            if let Some(parent) = dst.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::copy(&src, &dst).map_err(|e| e.to_string())?;
            Ok(as_name)
        }
    }
}

// ---- References for extracting a design system -------------------------------

fn system_refs(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    let dir = system_dir(app, id)?.join("refs");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Copy a file the user picked into the system's refs/.
#[tauri::command]
pub fn system_ref_file(app: AppHandle, id: String, source: String) -> Result<String, String> {
    let src = PathBuf::from(&source);
    let size = fs::metadata(&src).map_err(|e| format!("Can't read {source}: {e}"))?.len();
    if size > MAX_ATTACHMENT {
        return Err("Files over 20 MB can't be used.".into());
    }
    let dir = system_refs(&app, &id)?;
    let target = free_path(&dir, &safe_name(&source));
    fs::copy(&src, &target).map_err(|e| e.to_string())?;
    Ok(format!("refs/{}", target.file_name().unwrap().to_string_lossy()))
}

/// Save pasted or dropped bytes into the system's refs/.
#[tauri::command]
pub fn system_ref_bytes(app: AppHandle, id: String, name: String, bytes: Vec<u8>) -> Result<String, String> {
    if bytes.len() as u64 > MAX_ATTACHMENT {
        return Err("Files over 20 MB can't be used.".into());
    }
    let dir = system_refs(&app, &id)?;
    let target = free_path(&dir, &safe_name(&name));
    fs::write(&target, &bytes).map_err(|e| e.to_string())?;
    Ok(format!("refs/{}", target.file_name().unwrap().to_string_lossy()))
}

/// Copy a design's current artifact (or project folder) into the system's refs/.
#[tauri::command]
pub fn system_ref_design(app: AppHandle, id: String, design_id: String) -> Result<String, String> {
    let src_dir = design_dir(&app, &design_id)?;
    let dir = system_refs(&app, &id)?;
    match current(&src_dir).ok_or("That design has nothing to read yet.")? {
        Current::Project => {
            let target = free_path(&dir, "design");
            copy_project(&src_dir, &target).map_err(|e| e.to_string())?;
            Ok(format!("refs/{}/", target.file_name().unwrap().to_string_lossy()))
        }
        Current::File(src) => {
            let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("html");
            let target = free_path(&dir, &format!("design.{ext}"));
            fs::copy(&src, &target).map_err(|e| e.to_string())?;
            Ok(format!("refs/{}", target.file_name().unwrap().to_string_lossy()))
        }
    }
}
