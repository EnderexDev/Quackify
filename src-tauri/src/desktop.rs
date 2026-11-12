// Living on the Windows desktop: the tray icon (its menu is tray_menu.rs), closing to the tray, starting with
// Windows (straight to the tray), and bringing the window back.
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Manager, WindowEvent};
use auto_launch::{AutoLaunch, AutoLaunchBuilder, WindowsEnableMode};

use crate::settings::{self, Store};

pub const TRAY_ID: &str = "main";
/// Passed by the Windows startup entry: start in the tray, without the window.
pub const MINIMIZED_ARG: &str = "--minimized";

pub struct Desktop {
    quitting: AtomicBool,
}

/// The tray menu (tray_menu.rs) reads its check marks each time it opens; an open one hears
/// this. Called wherever the settings or Windows' startup entry change.
pub fn sync_tray(app: &AppHandle) {
    let _ = app.emit_to(crate::tray_menu::LABEL, "tray-menu-sync", ());
}

/// From the tray menu: saves "close to tray" and tells the Settings page.
pub fn set_close_to_tray(app: &AppHandle, on: bool) {
    let store = app.state::<Store>();
    if let Err(e) = store.set(settings::Settings { close_to_tray: on, ..store.get() }) {
        log::warn!("desktop: settings not saved: {e}");
    }
    let _ = app.emit("settings-changed", ());
}

/// The Windows startup entry (the user's Run key), with or without `--minimized`.
fn launcher(app: &AppHandle, minimized: bool) -> Result<AutoLaunch, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let args: &[&str] = if minimized { &[MINIMIZED_ARG] } else { &[] };
    AutoLaunchBuilder::new()
        .set_app_name(&crate::variant::name(app))
        .set_app_path(&exe.display().to_string())
        .set_args(args)
        .set_windows_enable_mode(WindowsEnableMode::CurrentUser)
        .build()
        .map_err(|e| e.to_string())
}

pub fn start_with_windows(app: &AppHandle) -> bool {
    launcher(app, false).and_then(|l| l.is_enabled().map_err(|e| e.to_string())).unwrap_or(false)
}

/// Turns the Windows startup entry on (minimized or not, per the settings) or off; says what
/// Windows has afterwards.
pub fn set_start_with_windows(app: &AppHandle, on: bool) -> Result<bool, String> {
    let launch = launcher(app, settings::current(app).start_minimized)?;
    let result = if on { launch.enable() } else { launch.disable() };
    sync_tray(app);
    result.map_err(|e| e.to_string())?;
    Ok(start_with_windows(app))
}

pub fn setup(app: &mut App) -> tauri::Result<()> {
    let name = crate::variant::name(app.handle());
    app.manage(Desktop { quitting: AtomicBool::new(false) });
    crate::tray_menu::setup(app.handle())?;

    // No menu of Windows' own: a right click opens the app's (tray_menu.rs).
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(app.default_window_icon().cloned().expect("the bundle has an icon"))
        .tooltip(&name)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button, button_state, position, .. } = event {
                match (button, button_state) {
                    (MouseButton::Left, MouseButtonState::Up) => show_window(tray.app_handle()),
                    (MouseButton::Right, MouseButtonState::Down) => crate::tray_menu::press(tray.app_handle()),
                    (MouseButton::Right, MouseButtonState::Up) => crate::tray_menu::open(tray.app_handle(), position),
                    _ => {}
                }
            }
        })
        .build(app)?;

    // The window starts hidden (tauri.conf.json), so starting with Windows does not flash it.
    if !std::env::args().any(|a| a == MINIMIZED_ARG) {
        show_window(app.handle());
    }
    Ok(())
}

/// Brings the window back from the tray, the taskbar or behind other windows. The window, not
/// the webview window: with the web player inside it, it holds two webviews.
pub fn show_window(app: &AppHandle) {
    if let Some(w) = app.get_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// The close button hides the window when closing to the tray is on.
pub fn on_window_event(window: &tauri::Window, event: &WindowEvent) {
    if let WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } = event {
        crate::webplayer::fit(window);
    }
    if let WindowEvent::CloseRequested { api, .. } = event {
        let quitting = window.state::<Desktop>().quitting.load(Ordering::SeqCst);
        if settings::current(window.app_handle()).close_to_tray && !quitting {
            api.prevent_close();
            let _ = window.hide();
        }
    }
    // Closed for real: the app ends with it. The tray menu's window, always there and hidden,
    // would otherwise keep it running with no window to show.
    if let WindowEvent::Destroyed = event {
        if window.label() == "main" {
            window.app_handle().exit(0);
        }
    }
}

/// Leaves for real: the session goes first, so other Spotify apps stop listing this device.
pub fn quit(app: &AppHandle) {
    app.state::<Desktop>().quitting.store(true, Ordering::SeqCst);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        crate::spotify::shutdown(&app).await;
        app.exit(0);
    });
}
