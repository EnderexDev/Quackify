// Spotify's own web player in a window of ours, for a Free account: Spotify refuses those at
// librespot's login (measured 21/10/26: "Travel restriction" for an account that plays fine on
// open.spotify.com), so the rest of the app cannot run for them. The page gets no access to the
// app (the capabilities only cover the main window).
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const LABEL: &str = "web-player";
const URL: &str = "https://open.spotify.com";

// Async: a window built in a synchronous command deadlocks on Windows (Tauri's own warning on
// WebviewWindowBuilder::new).
#[tauri::command]
pub async fn web_player_open(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        return window.set_focus().map_err(|e| e.to_string());
    }
    let url = URL.parse::<tauri::Url>().map_err(|e| e.to_string())?;
    WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::External(url))
        .title(format!("{} - Spotify Web Player", crate::variant::name(&app)))
        .inner_size(1280.0, 800.0)
        .min_inner_size(800.0, 600.0)
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
