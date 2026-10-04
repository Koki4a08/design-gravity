//! Frameless-window chrome. Windows 11 draws a 1px DWM border around an
//! undecorated window with a shadow, white by default; we colour it to the theme.

use tauri::WebviewWindow;

/// Night Studio's edge, applied before the web view has loaded a theme.
pub const DEFAULT_BORDER: &str = "#1c1b24";

#[tauri::command]
pub fn window_border(window: WebviewWindow, color: String) -> Result<(), String> {
    set_border(&window, &color)
}

#[cfg(windows)]
pub fn set_border(window: &WebviewWindow, color: &str) -> Result<(), String> {
    use windows_sys::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_BORDER_COLOR};

    let hex = color.trim_start_matches('#');
    let rgb = u32::from_str_radix(hex, 16).map_err(|_| format!("bad colour {color}"))?;
    if hex.len() != 6 {
        return Err(format!("bad colour {color}"));
    }
    // COLORREF is 0x00BBGGRR.
    let colorref: u32 = ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 0xff);
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    // Fails harmlessly on Windows 10, which has no such attribute.
    unsafe {
        DwmSetWindowAttribute(
            hwnd.0 as _,
            DWMWA_BORDER_COLOR as _,
            &colorref as *const u32 as _,
            std::mem::size_of::<u32>() as u32,
        );
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn set_border(_window: &WebviewWindow, _color: &str) -> Result<(), String> {
    Ok(())
}
