// The mini player: a second window, small and always on top, made when first opened. It loads
// the same page as the main window, which draws the mini player when its label is "mini".
// Dropped near an edge of the screen's work area, it snaps to it; where it was is kept for next
// time.
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

pub const LABEL: &str = "mini";
const WIDTH: f64 = 330.0;
const HEIGHT: f64 = 162.0;
/// How far from an edge, in logical pixels, a dropped window snaps to it.
const SNAP: f64 = 24.0;
/// The gap kept between the window and the edge it snaps to.
const MARGIN: f64 = 12.0;
/// How long the window must stay still before it counts as dropped.
const SETTLE: Duration = Duration::from_millis(200);

/// Bumped by every move: only the last one of a drag snaps.
static MOVES: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize, Deserialize, Clone, Copy)]
struct Place {
    x: i32,
    y: i32,
}

fn place_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("mini-player.json"))
}

fn saved_place(app: &AppHandle) -> Option<Place> {
    let text = std::fs::read_to_string(place_file(app)?).ok()?;
    serde_json::from_str(&text).ok()
}

fn save_place(app: &AppHandle, place: Place) {
    let Some(file) = place_file(app) else { return };
    if let Some(dir) = file.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string(&place) {
        let _ = std::fs::write(file, json);
    }
}

pub fn is_open(app: &AppHandle) -> bool {
    app.get_webview_window(LABEL).is_some_and(|w| w.is_visible().unwrap_or(false))
}

/// Opens the mini player, or brings it forward; says the main window so (its button lights up).
pub fn open(app: &AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(LABEL) {
        w.show().map_err(|e| e.to_string())?;
        let _ = w.set_focus();
        let _ = app.emit("mini-player", true);
        return Ok(());
    }
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title(format!("{} mini player", crate::variant::name(app)))
        .inner_size(WIDTH, HEIGHT)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;
    place(app, &window);
    window.show().map_err(|e| e.to_string())?;
    let _ = window.set_focus();
    let _ = app.emit("mini-player", true);
    Ok(())
}

/// Puts the window where it was last time, if that is still on a screen; otherwise in the
/// bottom right corner of the main window's screen.
fn place(app: &AppHandle, window: &WebviewWindow) {
    if let Some(p) = saved_place(app) {
        if window.monitor_from_point(p.x as f64, p.y as f64).ok().flatten().is_some() {
            let _ = window.set_position(PhysicalPosition::new(p.x, p.y));
            return;
        }
    }
    let monitor = app
        .get_window("main")
        .and_then(|m| m.current_monitor().ok().flatten())
        .or_else(|| window.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else { return };
    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    let x = area.position.x + area.size.width as i32 - ((WIDTH + MARGIN) * scale) as i32;
    let y = area.position.y + area.size.height as i32 - ((HEIGHT + MARGIN) * scale) as i32;
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

pub fn close(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.hide();
    }
    let _ = app.emit("mini-player", false);
}

pub fn toggle(app: &AppHandle) {
    if is_open(app) {
        close(app);
    } else if let Err(e) = open(app) {
        eprintln!("mini: {e}");
    }
}

/// The mini player's own events: closing it hides it (it opens again at once), and a move
/// snaps it once the drag is over.
pub fn on_window_event(window: &tauri::Window, event: &WindowEvent) {
    match event {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            close(window.app_handle());
        }
        WindowEvent::Moved(_) => {
            let n = MOVES.fetch_add(1, Ordering::SeqCst) + 1;
            let window = window.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(SETTLE).await;
                    if MOVES.load(Ordering::SeqCst) != n {
                        return;
                    }
                    // Held still, but still held: not dropped yet.
                    if !mouse_down() {
                        break;
                    }
                }
                snap(&window);
            });
        }
        _ => {}
    }
}

#[cfg(windows)]
fn mouse_down() -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
    unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) as u16 & 0x8000 != 0 }
}

#[cfg(not(windows))]
fn mouse_down() -> bool {
    false
}

/// Moves the window to the edges it was dropped near, kept inside the work area, and saves
/// where it ended.
fn snap(window: &tauri::Window) {
    let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) else { return };
    let center = (pos.x as f64 + size.width as f64 / 2.0, pos.y as f64 + size.height as f64 / 2.0);
    let Some(monitor) = window.monitor_from_point(center.0, center.1).ok().flatten() else { return };
    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    let (snap, margin) = (SNAP * scale, (MARGIN * scale) as i32);
    let (left, top) = (area.position.x, area.position.y);
    let right = left + area.size.width as i32 - size.width as i32;
    let bottom = top + area.size.height as i32 - size.height as i32;
    let pull = |at: i32, low: i32, high: i32| {
        if ((at - low) as f64) < snap + margin as f64 {
            low + margin
        } else if ((high - at) as f64) < snap + margin as f64 {
            high - margin
        } else {
            at
        }
        .clamp(low, high.max(low))
    };
    let (x, y) = (pull(pos.x, left, right), pull(pos.y, top, bottom));
    if (x, y) != (pos.x, pos.y) {
        // Its own move event comes back and lands here again, where nothing changes.
        let _ = window.set_position(PhysicalPosition::new(x, y));
    }
    save_place(window.app_handle(), Place { x, y });
}

// Async: a window made from a synchronous command blocks the thread that has to make it, on
// Windows (the mini player came up blank and the main window stopped answering).
#[tauri::command]
pub async fn mini_player_toggle(app: AppHandle) {
    toggle(&app);
}

#[tauri::command]
pub async fn mini_player_open(app: AppHandle) -> Result<(), String> {
    open(&app)
}

#[tauri::command]
pub fn mini_player_close(app: AppHandle) {
    close(&app);
}

#[tauri::command]
pub fn mini_player_is_open(app: AppHandle) -> bool {
    is_open(&app)
}

/// Keeps the mini player over other windows, or lets it go behind them.
#[tauri::command]
pub fn mini_player_on_top(app: AppHandle, on: bool) -> Result<(), String> {
    let w = app.get_webview_window(LABEL).ok_or("The mini player is not open")?;
    w.set_always_on_top(on).map_err(|e| e.to_string())
}

/// From the mini player: the main window comes forward and is told what to show.
#[tauri::command]
pub fn mini_player_show_main(app: AppHandle, what: String) {
    crate::desktop::show_window(&app);
    let _ = app.emit_to("main", "mini-player-show", what);
}
