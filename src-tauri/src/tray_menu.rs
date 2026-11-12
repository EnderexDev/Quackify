// The tray icon's menu, drawn by the app instead of Windows: a small transparent window that
// loads the same page as the main window, which draws the menu (TrayMenu.tsx) when its label is
// "tray". Made hidden at start, so a right click shows it at once; it hides when it loses focus,
// like a native menu.
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder, WindowEvent};

use crate::desktop;
use crate::media::{self, Action};

pub const LABEL: &str = "tray";
/// The size before the page says its own; it fits the menu with the default items.
const WIDTH: f64 = 260.0;
const HEIGHT: f64 = 330.0;
/// A right click on the icon while the menu is open first hides it (pressing the taskbar takes
/// the focus away), then lands here: a press this soon after hiding counts as the closing one.
const REOPEN_GUARD: Duration = Duration::from_millis(250);

/// When the menu last hid.
static HIDDEN_AT: Mutex<Option<Instant>> = Mutex::new(None);
/// The page's size in logical pixels, as it last said: turned into the pixels of whichever
/// monitor the menu opens on (two monitors can have different scales).
static SIZE: Mutex<(f64, f64)> = Mutex::new((WIDTH, HEIGHT));
/// The right button went down on the icon while the menu was open: its release only closes it,
/// however long the button was held.
static CLOSING_PRESS: AtomicBool = AtomicBool::new(false);

/// Makes the window, hidden. A webview made on the first click shows blank for a moment.
pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title(format!("{} menu", crate::variant::name(app)))
        .inner_size(WIDTH, HEIGHT)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .build()?;
    Ok(())
}

/// The right button pressed on the icon: remembers whether the menu was open (or had just hidden
/// because of this press), so the release does not open it again.
pub fn press(app: &AppHandle) {
    let open = app.get_webview_window(LABEL).is_some_and(|w| w.is_visible().unwrap_or(false));
    let just_hid = HIDDEN_AT.lock().ok().and_then(|t| *t).is_some_and(|t| t.elapsed() < REOPEN_GUARD);
    CLOSING_PRESS.store(open || just_hid, Ordering::SeqCst);
    if open {
        hide(app);
    }
}

/// The right button released on the icon: shows the menu with a corner at the cursor (`at`, in
/// physical pixels), above it and to its right like Windows' own tray menus, turned to whichever
/// side keeps it on the screen.
pub fn open(app: &AppHandle, at: PhysicalPosition<f64>) {
    let Some(w) = app.get_webview_window(LABEL) else { return };
    if CLOSING_PRESS.swap(false, Ordering::SeqCst) {
        return;
    }
    if w.is_visible().unwrap_or(false) {
        hide(app);
        return;
    }
    let (lw, lh) = SIZE.lock().map(|s| *s).unwrap_or((WIDTH, HEIGHT));
    let monitor = w.monitor_from_point(at.x, at.y).ok().flatten();
    let scale = monitor.as_ref().map(|m| m.scale_factor()).unwrap_or(1.0);
    let (width, height) = ((lw * scale).ceil() as i32, (lh * scale).ceil() as i32);
    let (cx, cy) = (at.x as i32, at.y as i32);
    let (mut x, mut y) = (cx, cy - height);
    if let Some(monitor) = monitor {
        let area = monitor.work_area();
        let (left, top) = (area.position.x, area.position.y);
        let (right, bottom) = (left + area.size.width as i32, top + area.size.height as i32);
        if x + width > right {
            x = cx - width;
        }
        if y < top {
            y = cy;
        }
        x = x.clamp(left, (right - width).max(left));
        y = y.clamp(top, (bottom - height).max(top));
    }
    let _ = w.set_position(PhysicalPosition::new(x, y));
    // Sized again once on that monitor: a move to another scale may have resized it.
    let _ = w.set_size(PhysicalSize::new(width as u32, height as u32));
    // The page reads the check marks and what plays before it is seen.
    let _ = app.emit_to(LABEL, "tray-menu-open", ());
    let _ = w.show();
    let _ = w.set_focus();
    watch_outside_clicks(app.clone());
}

/// Windows does not always give the menu the focus (the focus a click elsewhere would take
/// away), so a press of any mouse button outside it closes it too, checked while it is open.
fn watch_outside_clicks(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // A button still held from the click that opened the menu does not count.
        let mut was_down = true;
        loop {
            tokio::time::sleep(Duration::from_millis(15)).await;
            let Some(w) = app.get_window(LABEL) else { return };
            if !w.is_visible().unwrap_or(false) {
                return;
            }
            let down = any_button_down();
            if down && !was_down && !cursor_inside(&w) {
                hide(&app);
                return;
            }
            was_down = down;
        }
    });
}

#[cfg(windows)]
fn any_button_down() -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_MBUTTON, VK_RBUTTON};
    [VK_LBUTTON, VK_RBUTTON, VK_MBUTTON].iter().any(|k| unsafe { GetAsyncKeyState(k.0 as i32) as u16 & 0x8000 != 0 })
}

#[cfg(not(windows))]
fn any_button_down() -> bool {
    false
}

fn cursor_inside(w: &tauri::Window) -> bool {
    let (Ok(c), Ok(pos), Ok(size)) = (w.cursor_position(), w.outer_position(), w.outer_size()) else { return true };
    let (x, y) = (c.x as i32, c.y as i32);
    x >= pos.x && y >= pos.y && x < pos.x + size.width as i32 && y < pos.y + size.height as i32
}

pub fn hide(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(LABEL) {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
            if let Ok(mut t) = HIDDEN_AT.lock() {
                *t = Some(Instant::now());
            }
        }
    }
}

/// Clicking anywhere else takes the focus away: the menu goes, like a native one.
pub fn on_window_event(window: &tauri::Window, event: &WindowEvent) {
    match event {
        WindowEvent::Focused(false) => hide(window.app_handle()),
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            hide(window.app_handle());
        }
        _ => {}
    }
}

/// What the menu shows besides its fixed items.
#[derive(serde::Serialize)]
pub struct View {
    name: String,
    close_to_tray: bool,
    start_with_windows: bool,
}

#[tauri::command]
pub fn tray_menu_state(app: AppHandle) -> View {
    View {
        name: crate::variant::name(&app),
        close_to_tray: crate::settings::current(&app).close_to_tray,
        start_with_windows: desktop::start_with_windows(&app),
    }
}

/// The page's size, measured: the window takes it.
#[tauri::command]
pub fn tray_menu_resize(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    let w = app.get_window(LABEL).ok_or("The tray menu is missing")?;
    let (width, height) = (width.ceil(), height.ceil());
    if let Ok(mut s) = SIZE.lock() {
        *s = (width, height);
    }
    w.set_size(LogicalSize::new(width, height)).map_err(|e| e.to_string())?;
    if w.is_visible().unwrap_or(false) {
        keep_on_screen(&w);
    }
    Ok(())
}

/// Grown while open: pulled back inside the work area of the monitor it is on.
fn keep_on_screen(w: &tauri::Window) {
    let (Ok(pos), Ok(size)) = (w.outer_position(), w.outer_size()) else { return };
    let Some(monitor) = w.current_monitor().ok().flatten() else { return };
    let area = monitor.work_area();
    let (left, top) = (area.position.x, area.position.y);
    let right = left + area.size.width as i32 - size.width as i32;
    let bottom = top + area.size.height as i32 - size.height as i32;
    let (x, y) = (pos.x.clamp(left, right.max(left)), pos.y.clamp(top, bottom.max(top)));
    if (x, y) != (pos.x, pos.y) {
        let _ = w.set_position(PhysicalPosition::new(x, y));
    }
}

#[tauri::command]
pub fn tray_menu_hide(app: AppHandle) {
    hide(&app);
}

/// An item was clicked. The menu hides first, then the item runs. Async: the mini player is a
/// window made here, and a window made from a synchronous command blocks on Windows (mini.rs).
#[tauri::command]
pub async fn tray_menu_action(app: AppHandle, id: String) {
    hide(&app);
    match id.as_str() {
        "show" => desktop::show_window(&app),
        "toggle" => media::run(&app, Action::Toggle),
        "next" => media::run(&app, Action::Next),
        "previous" => media::run(&app, Action::Previous),
        "mini" => crate::mini::toggle(&app),
        "close_to_tray" => desktop::set_close_to_tray(&app, !crate::settings::current(&app).close_to_tray),
        "autostart" => {
            if let Err(e) = desktop::set_start_with_windows(&app, !desktop::start_with_windows(&app)) {
                log::warn!("tray menu: start with Windows: {e}");
            }
            let _ = app.emit("settings-changed", ());
        }
        "quit" => desktop::quit(&app),
        other => log::warn!("tray menu: unknown item {other}"),
    }
}
