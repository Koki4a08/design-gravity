mod agy;
mod codex;
mod designs;
mod updates;
mod window;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(agy::Runs::default())
        .setup(|app| {
            if let Some(main) = app.get_webview_window("main") {
                let _ = window::set_border(&main, window::DEFAULT_BORDER);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            window::window_border,
            agy::agy_status,
            agy::agy_ping,
            agy::agy_open_sign_in,
            agy::agy_update,
            agy::agent_run,
            agy::agent_cancel,
            designs::designs_list,
            designs::design_save_meta,
            designs::design_read_artifact,
            designs::design_delete,
            designs::design_dir_path,
            designs::export_write,
            designs::design_snapshot,
            designs::design_read_version,
            designs::design_restore_version,
            designs::design_attach_file,
            designs::design_attach_bytes,
            designs::design_attachment_urls,
            designs::systems_list,
            designs::system_save_meta,
            designs::system_read,
            designs::system_delete,
            designs::design_use_system,
            agy::agy_ask,
            codex::codex_status,
            codex::codex_ping,
            codex::codex_open_sign_in,
            codex::codex_update,
            updates::cli_latest_version,
            codex::codex_run,
            codex::codex_ask,
            designs::design_fork,
            designs::design_import,
            designs::system_ref_file,
            designs::system_ref_bytes,
            designs::system_ref_design,
            designs::export_write_bytes,
            designs::design_read_file,
            designs::design_prepare_project,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Design Gravity");
}
