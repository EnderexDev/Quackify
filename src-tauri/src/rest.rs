// Resting a window's webviews while it sits in the tray (or the mini player is closed), so
// WebView2 gives back memory and stops drawing. Tauri's hide() only hides the window: the
// WebView2 controller stays "visible" and keeps compositing for nobody. How far it goes:
// - hidden:  the controller is told it is invisible (IsVisible), the page keeps running;
// - low:     hidden, and WebView2 is asked to keep its memory low (MemoryUsageTargetLevel);
// - suspend: low, and the page is suspended (TrySuspend), its scripts and timers stopped.
// QUACKIFY_TRAY_REST=off|hidden|low|suspend picks one (for measuring); otherwise DEFAULT.
use std::sync::OnceLock;
use std::time::Instant;

use tauri::{Manager, Runtime, Webview, Window};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Mode {
    Off,
    Hidden,
    Low,
    Suspend,
}

const DEFAULT: Mode = Mode::Off;

pub fn mode() -> Mode {
    static MODE: OnceLock<Mode> = OnceLock::new();
    *MODE.get_or_init(|| {
        let mode = match std::env::var("QUACKIFY_TRAY_REST").as_deref() {
            Ok("off") => Mode::Off,
            Ok("hidden") => Mode::Hidden,
            Ok("low") => Mode::Low,
            Ok("suspend") => Mode::Suspend,
            _ => DEFAULT,
        };
        log::info!("rest: mode {mode:?}");
        mode
    })
}

/// Rests every webview in `window` (the main window holds the web player too). The web player
/// is never suspended: for a Free account it is what plays the music.
pub fn rest<R: Runtime>(window: &Window<R>) {
    let mode = mode();
    if mode == Mode::Off {
        return;
    }
    log::info!("rest: resting {} ({} webviews)", window.label(), window.webviews().len());
    for webview in window.webviews() {
        let suspend = mode == Mode::Suspend && webview.label() != crate::webplayer::LABEL;
        apply(&webview, false, mode != Mode::Hidden, suspend);
    }
}

/// Wakes every webview in `window`; called before the window shows, so its first frame is drawn.
pub fn wake<R: Runtime>(window: &Window<R>) {
    let mode = mode();
    if mode == Mode::Off {
        return;
    }
    for webview in window.webviews() {
        apply(&webview, true, mode != Mode::Hidden, mode == Mode::Suspend);
    }
}

#[cfg(windows)]
fn apply<R: Runtime>(webview: &Webview<R>, visible: bool, memory: bool, suspend: bool) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL, ICoreWebView2_19,
        ICoreWebView2_3,
    };
    use webview2_com::TrySuspendCompletedHandler;
    use windows_core::Interface;

    let label = webview.label().to_string();
    let result = webview.with_webview(move |platform| unsafe {
        let controller = platform.controller();
        log::info!("rest: {label}: visible={visible} memory={memory} suspend={suspend}");
        let core = match controller.CoreWebView2() {
            Ok(core) => core,
            Err(e) => return log::warn!("rest: {label}: no CoreWebView2: {e}"),
        };
        // Waking: resume first, so the page is running when it becomes visible.
        if visible && suspend {
            if let Ok(w3) = core.cast::<ICoreWebView2_3>() {
                if let Err(e) = w3.Resume() {
                    log::warn!("rest: {label}: Resume: {e}");
                }
            }
        }
        if memory {
            let level = if visible { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL } else { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW };
            match core.cast::<ICoreWebView2_19>() {
                Ok(w19) => {
                    if let Err(e) = w19.SetMemoryUsageTargetLevel(level) {
                        log::warn!("rest: {label}: MemoryUsageTargetLevel: {e}");
                    }
                }
                Err(e) => log::warn!("rest: {label}: no ICoreWebView2_19 (old WebView2 runtime): {e}"),
            }
        }
        if let Err(e) = controller.SetIsVisible(visible) {
            log::warn!("rest: {label}: IsVisible: {e}");
        }
        // TrySuspend needs the controller invisible, which the line above just did.
        if !visible && suspend {
            match core.cast::<ICoreWebView2_3>() {
                Ok(w3) => {
                    let started = Instant::now();
                    let name = label.clone();
                    let handler = TrySuspendCompletedHandler::create(Box::new(move |hr, ok| {
                        log::info!("rest: {name}: TrySuspend {hr:?} suspended={ok} in {:?}", started.elapsed());
                        Ok(())
                    }));
                    if let Err(e) = w3.TrySuspend(&handler) {
                        log::warn!("rest: {label}: TrySuspend: {e}");
                    }
                }
                Err(e) => log::warn!("rest: {label}: no ICoreWebView2_3: {e}"),
            }
        }
    });
    if let Err(e) = result {
        log::warn!("rest: {}: {e}", webview.label());
    }
}

#[cfg(not(windows))]
fn apply<R: Runtime>(_: &Webview<R>, _: bool, _: bool, _: bool) {}

/// For measuring: says, in the log, whether each webview in `window` is suspended right now.
#[cfg(windows)]
pub fn log_suspended<R: Runtime>(window: &Window<R>, when: &'static str) {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_3;
    use windows_core::{Interface, BOOL};
    for webview in window.webviews() {
        let label = webview.label().to_string();
        let _ = webview.with_webview(move |platform| unsafe {
            let controller = platform.controller();
            let mut visible = BOOL(0);
            let _ = controller.IsVisible(&mut visible);
            let mut suspended = BOOL(0);
            if let Ok(w3) = controller.CoreWebView2().and_then(|c| c.cast::<ICoreWebView2_3>()) {
                let _ = w3.IsSuspended(&mut suspended);
            }
            log::info!("rest: {label} {when}: visible={} suspended={}", visible.as_bool(), suspended.as_bool());
        });
    }
}

#[cfg(not(windows))]
pub fn log_suspended<R: Runtime>(_: &Window<R>, _: &'static str) {}

/// For measuring: when the tray click came in, so the page can say how long it took to paint.
static SHOWN_AT: std::sync::Mutex<Option<Instant>> = std::sync::Mutex::new(None);

pub fn mark_shown() {
    *SHOWN_AT.lock().unwrap() = Some(Instant::now());
}

/// Called by the main page two frames after it is shown again: logs the time from the click.
#[tauri::command]
pub fn rest_painted(app: tauri::AppHandle) {
    if let Some(at) = SHOWN_AT.lock().unwrap().take() {
        log::info!("rest: painted {:.1} ms after show (mode {:?})", at.elapsed().as_secs_f64() * 1000.0, mode());
    }
    if let Some(w) = app.get_window("main") {
        log_suspended(&w, "after show");
    }
}
