// Windows' media controls (the flyout with the song and its buttons, and the keyboard's media
// keys), plus the actions they share with the tray menu. The controls live on their own thread:
// the hub sends them what is playing, and their buttons come back as actions on the hub.
use std::sync::mpsc::{channel, Sender};
use std::time::Duration;

use souvlaki::{MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition, PlatformConfig, SeekDirection};
use tauri::{AppHandle, Manager};

/// How far the flyout's fast-forward and rewind buttons move.
const SEEK_STEP_MS: u64 = 10_000;

/// What the system shows. `None` when nothing is playing.
#[derive(Clone, PartialEq, Debug)]
pub struct Showing {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub cover: Option<String>,
    pub duration_ms: u64,
    pub playing: bool,
    pub position_ms: u64,
}

pub enum Action {
    Toggle,
    Play,
    Pause,
    Next,
    Previous,
    /// Moves by this many ms from where the song is.
    SeekBy(i64),
    SeekTo(u64),
}

/// The handle to the controls' thread. Missing when Windows refused them; the app runs without.
pub struct Media(Sender<Option<Showing>>);

impl Media {
    pub fn start(app: &AppHandle) -> Result<Self, String> {
        let window = app.get_webview_window("main").ok_or("no main window")?;
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
        let (tx, rx) = channel::<Option<Showing>>();
        let (ready_tx, ready_rx) = channel::<Result<(), String>>();
        let app = app.clone();
        let name = crate::variant::name(&app);
        std::thread::spawn(move || {
            let config = PlatformConfig {
                display_name: &name,
                dbus_name: "quackify",
                hwnd: Some(hwnd as *mut std::ffi::c_void),
            };
            let mut controls = match MediaControls::new(config) {
                Ok(c) => c,
                Err(e) => return ready_tx.send(Err(format!("{e:?}"))).unwrap_or(()),
            };
            let handler_app = app.clone();
            if let Err(e) = controls.attach(move |event| on_event(&handler_app, event)) {
                return ready_tx.send(Err(format!("{e:?}"))).unwrap_or(());
            }
            let _ = ready_tx.send(Ok(()));
            let mut shown: Option<Showing> = None;
            while let Ok(next) = rx.recv() {
                // Only what Windows took counts as shown: a failed update is sent whole next time.
                match show(&mut controls, shown.as_ref(), next.as_ref()) {
                    Ok(()) => shown = next,
                    Err(e) => {
                        eprintln!("media: {e}");
                        shown = None;
                    }
                }
            }
        });
        ready_rx.recv().map_err(|e| e.to_string())??;
        Ok(Self(tx))
    }

    pub fn update(&self, showing: Option<Showing>) {
        let _ = self.0.send(showing);
    }
}

fn show(controls: &mut MediaControls, before: Option<&Showing>, now: Option<&Showing>) -> Result<(), String> {
    let err = |e: souvlaki::Error| format!("{e:?}");
    let Some(now) = now else {
        return controls.set_playback(MediaPlayback::Stopped).map_err(err);
    };
    // The cover is fetched again each time it is set: only when the song changes.
    let same_song = before.is_some_and(|b| {
        b.title == now.title && b.artist == now.artist && b.album == now.album && b.cover == now.cover && b.duration_ms == now.duration_ms
    });
    if !same_song {
        controls
            .set_metadata(MediaMetadata {
                title: Some(&now.title),
                artist: Some(&now.artist),
                album: Some(&now.album),
                cover_url: now.cover.as_deref(),
                duration: Some(Duration::from_millis(now.duration_ms)),
            })
            .map_err(err)?;
    }
    let progress = Some(MediaPosition(Duration::from_millis(now.position_ms)));
    controls
        .set_playback(if now.playing { MediaPlayback::Playing { progress } } else { MediaPlayback::Paused { progress } })
        .map_err(err)
}

fn on_event(app: &AppHandle, event: MediaControlEvent) {
    let action = match event {
        MediaControlEvent::Play => Action::Play,
        MediaControlEvent::Pause | MediaControlEvent::Stop => Action::Pause,
        MediaControlEvent::Toggle => Action::Toggle,
        MediaControlEvent::Next => Action::Next,
        MediaControlEvent::Previous => Action::Previous,
        MediaControlEvent::Seek(SeekDirection::Forward) => Action::SeekBy(SEEK_STEP_MS as i64),
        MediaControlEvent::Seek(SeekDirection::Backward) => Action::SeekBy(-(SEEK_STEP_MS as i64)),
        MediaControlEvent::SeekBy(SeekDirection::Forward, d) => Action::SeekBy(d.as_millis() as i64),
        MediaControlEvent::SeekBy(SeekDirection::Backward, d) => Action::SeekBy(-(d.as_millis() as i64)),
        MediaControlEvent::SetPosition(MediaPosition(d)) => Action::SeekTo(d.as_millis() as u64),
        MediaControlEvent::Raise => return crate::desktop::show_window(app),
        _ => return,
    };
    run(app, action);
}

/// Does `action` on whichever device is playing. Without a session it does nothing.
pub fn run(app: &AppHandle, action: Action) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let Some(hub) = crate::spotify::current_hub(&app).await else { return };
        let result = match action {
            Action::Toggle => hub.toggle().await,
            Action::Play => hub.resume().await,
            Action::Pause => hub.pause().await,
            Action::Next => hub.next().await,
            Action::Previous => hub.previous().await,
            Action::SeekBy(delta) => {
                let at = hub.position_ms() as i64;
                hub.seek((at + delta).max(0) as u32).await
            }
            Action::SeekTo(ms) => hub.seek(ms as u32).await,
        };
        if let Err(e) = result {
            eprintln!("media: {e}");
        }
    });
}

/// Shows `showing` in Windows (the media flyout and the taskbar thumbnail's buttons) and in the
/// tray tooltip.
pub fn publish(app: &AppHandle, showing: Option<Showing>) {
    #[cfg(windows)]
    crate::thumbbar::update(app, showing.as_ref().is_some_and(|s| s.playing), showing.is_some());
    if let Some(tray) = app.tray_by_id(crate::desktop::TRAY_ID) {
        let tip = match &showing {
            // Windows cuts tray tooltips at 128 characters.
            Some(s) => format!("{} - {}", s.title, s.artist).chars().take(120).collect(),
            None => crate::variant::name(app),
        };
        let _ = tray.set_tooltip(Some(tip));
    }
    if let Some(media) = app.try_state::<Media>() {
        media.update(showing);
    }
}
