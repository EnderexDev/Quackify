// Living on the Windows desktop: the tray icon and its menu, closing to the tray, starting with
// Windows (straight to the tray), and bringing the window back.
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Manager, WindowEvent};
use auto_launch::{AutoLaunch, AutoLaunchBuilder, WindowsEnableMode};

use crate::media::{self, Action};
use crate::settings::{self, Store};

pub const TRAY_ID: &str = "main";
/// Passed by the Windows startup entry: start in the tray, without the window.
pub const MINIMIZED_ARG: &str = "--minimized";

pub struct Desktop {
    quitting: AtomicBool,
    // The tray's check marks, kept in step with the Settings page.
    close_item: CheckMenuItem<tauri::Wry>,
    autostart_item: CheckMenuItem<tauri::Wry>,
}

/// Puts the tray's check marks back in line with the settings and Windows' startup entry.
pub fn sync_tray(app: &AppHandle) {
    if let Some(desktop) = app.try_state::<Desktop>() {
        let _ = desktop.close_item.set_checked(settings::current(app).close_to_tray);
        let _ = desktop.autostart_item.set_checked(start_with_windows(app));
    }
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
    let settings = settings::current(app.handle());
    let name = crate::variant::name(app.handle());

    let show = MenuItem::with_id(app, "show", format!("Show {name}"), true, None::<&str>)?;
    let toggle = MenuItem::with_id(app, "toggle", "Play / Pause", true, None::<&str>)?;
    let next = MenuItem::with_id(app, "next", "Next", true, None::<&str>)?;
    let previous = MenuItem::with_id(app, "previous", "Previous", true, None::<&str>)?;
    let close_to_tray =
        CheckMenuItem::with_id(app, "close_to_tray", "Close to tray", true, settings.close_to_tray, None::<&str>)?;
    let autostart_on = start_with_windows(app.handle());
    let autostart = CheckMenuItem::with_id(app, "autostart", "Start with Windows", true, autostart_on, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", format!("Quit {name}"), true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &show,
            &PredefinedMenuItem::separator(app)?,
            &toggle,
            &next,
            &previous,
            &PredefinedMenuItem::separator(app)?,
            &close_to_tray,
            &autostart,
            &PredefinedMenuItem::separator(app)?,
            &quit_item,
        ],
    )?;

    app.manage(Desktop {
        quitting: AtomicBool::new(false),
        close_item: close_to_tray.clone(),
        autostart_item: autostart.clone(),
    });

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(app.default_window_icon().cloned().expect("the bundle has an icon"))
        .tooltip(&name)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "show" => show_window(app),
            "toggle" => media::run(app, Action::Toggle),
            "next" => media::run(app, Action::Next),
            "previous" => media::run(app, Action::Previous),
            "close_to_tray" => {
                // The item has already flipped its own check mark.
                let on = app.state::<Desktop>().close_item.is_checked().unwrap_or(true);
                let store = app.state::<Store>();
                if let Err(e) = store.set(settings::Settings { close_to_tray: on, ..store.get() }) {
                    eprintln!("desktop: settings not saved: {e}");
                }
                let _ = app.emit("settings-changed", ());
            }
            "autostart" => {
                let want = app.state::<Desktop>().autostart_item.is_checked().unwrap_or(false);
                if let Err(e) = set_start_with_windows(app, want) {
                    eprintln!("desktop: start with Windows: {e}");
                }
                let _ = app.emit("settings-changed", ());
            }
            "quit" => quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_window(tray.app_handle());
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
}

/// Leaves for real: the session goes first, so other Spotify apps stop listing this device.
fn quit(app: &AppHandle) {
    app.state::<Desktop>().quitting.store(true, Ordering::SeqCst);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        crate::spotify::shutdown(&app).await;
        app.exit(0);
    });
}
