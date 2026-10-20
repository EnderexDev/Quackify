// Living on the Windows desktop: the tray icon and its menu, closing to the tray, starting with
// Windows (straight to the tray), and bringing the window back.
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Manager, WindowEvent};
use tauri_plugin_autostart::ManagerExt;

use crate::media::{self, Action};

pub const TRAY_ID: &str = "main";
/// Passed by the Windows startup entry: start in the tray, without the window.
pub const MINIMIZED_ARG: &str = "--minimized";

#[derive(Serialize, Deserialize)]
#[serde(default)]
struct Settings {
    /// The window's close button hides it to the tray, and the music keeps playing.
    close_to_tray: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self { close_to_tray: true }
    }
}

pub struct Desktop {
    file: Option<PathBuf>,
    close_to_tray: AtomicBool,
    quitting: AtomicBool,
}

impl Desktop {
    fn save(&self) {
        let Some(file) = &self.file else { return };
        let settings = Settings { close_to_tray: self.close_to_tray.load(Ordering::SeqCst) };
        if let Some(dir) = file.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Err(e) = std::fs::write(file, serde_json::to_string_pretty(&settings).unwrap_or_default()) {
            eprintln!("desktop: settings not saved: {e}");
        }
    }
}

pub fn setup(app: &mut App) -> tauri::Result<()> {
    let file = app.path().app_data_dir().ok().map(|d| d.join("settings.json"));
    let settings: Settings = file
        .as_ref()
        .and_then(|f| std::fs::read_to_string(f).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    app.manage(Desktop {
        file,
        close_to_tray: AtomicBool::new(settings.close_to_tray),
        quitting: AtomicBool::new(false),
    });

    let show = MenuItem::with_id(app, "show", "Show Quackify", true, None::<&str>)?;
    let toggle = MenuItem::with_id(app, "toggle", "Play / Pause", true, None::<&str>)?;
    let next = MenuItem::with_id(app, "next", "Next", true, None::<&str>)?;
    let previous = MenuItem::with_id(app, "previous", "Previous", true, None::<&str>)?;
    let close_to_tray =
        CheckMenuItem::with_id(app, "close_to_tray", "Close to tray", true, settings.close_to_tray, None::<&str>)?;
    let autostart_on = app.autolaunch().is_enabled().unwrap_or(false);
    let autostart = CheckMenuItem::with_id(app, "autostart", "Start with Windows", true, autostart_on, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit Quackify", true, None::<&str>)?;
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

    let (close_item, autostart_item) = (close_to_tray.clone(), autostart.clone());
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(app.default_window_icon().cloned().expect("the bundle has an icon"))
        .tooltip("Quackify")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "show" => show_window(app),
            "toggle" => media::run(app, Action::Toggle),
            "next" => media::run(app, Action::Next),
            "previous" => media::run(app, Action::Previous),
            "close_to_tray" => {
                // The item has already flipped its own check mark.
                let on = close_item.is_checked().unwrap_or(true);
                let desktop = app.state::<Desktop>();
                desktop.close_to_tray.store(on, Ordering::SeqCst);
                desktop.save();
            }
            "autostart" => {
                let want = autostart_item.is_checked().unwrap_or(false);
                let launch = app.autolaunch();
                let result = if want { launch.enable() } else { launch.disable() };
                if let Err(e) = result {
                    eprintln!("desktop: start with Windows: {e}");
                }
                // Show what Windows actually has, in case the change failed.
                let _ = autostart_item.set_checked(launch.is_enabled().unwrap_or(false));
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

/// Brings the window back from the tray, the taskbar or behind other windows.
pub fn show_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// The close button hides the window when closing to the tray is on.
pub fn on_window_event(window: &tauri::Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        let desktop = window.state::<Desktop>();
        if desktop.close_to_tray.load(Ordering::SeqCst) && !desktop.quitting.load(Ordering::SeqCst) {
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
