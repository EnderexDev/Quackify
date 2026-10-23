// Spotify's own web player inside Quackify's window, for a Free account: Spotify refuses those at
// librespot's login (measured 21/10/26: "Travel restriction" for an account that plays fine on
// open.spotify.com), so the rest of the app cannot run for them. It is a second webview laid over
// the main one below Quackify's bar (BAR_HEIGHT, the same as .web-player-bar in App.css). The
// page gets no access to the app: the capabilities only cover the main webview.
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Runtime, WebviewBuilder, WebviewUrl, Window};

const LABEL: &str = "web-player";
const URL: &str = "https://open.spotify.com";
/// Quackify's bar above the web player, in logical pixels.
const BAR_HEIGHT: f64 = 56.0;

// Opening and closing run one at a time, in order: the page opens, closes and opens again at once
// in development (React's strict mode). Closing only hides the webview and blanks it, because a
// closed webview leaves the app's list later, not at once; opening again reuses it.
static TURN: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Where the web player goes in `window`: everything below the bar.
fn bounds<R: Runtime>(window: &Window<R>) -> tauri::Result<(LogicalPosition<f64>, LogicalSize<f64>)> {
    let size = window.inner_size()?.to_logical::<f64>(window.scale_factor()?);
    Ok((LogicalPosition::new(0.0, BAR_HEIGHT), LogicalSize::new(size.width, (size.height - BAR_HEIGHT).max(0.0))))
}

// Async: a webview built in a synchronous command deadlocks on Windows (Tauri's own warning on
// WebviewWindowBuilder::new, and add_child waits on the main thread the same way).
#[tauri::command]
pub async fn web_player_open(app: AppHandle) -> Result<(), String> {
    let _turn = TURN.lock().await;
    let window = app.get_window("main").ok_or("no main window")?;
    let url = URL.parse::<tauri::Url>().map_err(|e| e.to_string())?;
    if let Some(webview) = app.get_webview(LABEL) {
        webview.navigate(url).map_err(|e| e.to_string())?;
        fit(&window);
        return webview.show().map_err(|e| e.to_string());
    }
    let (position, size) = bounds(&window).map_err(|e| e.to_string())?;
    window
        .add_child(WebviewBuilder::new(LABEL, WebviewUrl::External(url)), position, size)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Takes the web player away, and the music it plays with it.
#[tauri::command]
pub async fn web_player_close(app: AppHandle) -> Result<(), String> {
    let _turn = TURN.lock().await;
    let Some(webview) = app.get_webview(LABEL) else { return Ok(()) };
    webview.hide().map_err(|e| e.to_string())?;
    webview.navigate("about:blank".parse::<tauri::Url>().map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

/// Keeps the web player filling the window below the bar as the window changes size.
pub fn fit<R: Runtime>(window: &Window<R>) {
    let Some(webview) = window.app_handle().get_webview(LABEL) else { return };
    if let Ok((position, size)) = bounds(window) {
        let _ = webview.set_position(position);
        let _ = webview.set_size(size);
    }
}
