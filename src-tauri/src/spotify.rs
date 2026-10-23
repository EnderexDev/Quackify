// The Spotify session: OAuth login, the credentials cache, and the local Connect device
// (librespot's Spirc driving one player). What plays where is connect.rs.
use std::path::PathBuf;
use std::sync::Arc;

use librespot_connect::{ConnectConfig, Spirc};
use librespot_core::{
    authentication::Credentials, cache::Cache, config::DeviceType, config::SessionConfig, session::Session,
};
use librespot_oauth::OAuthClientBuilder;
use librespot_playback::{
    audio_backend,
    config::{AudioFormat, Bitrate, PlayerConfig},
    mixer::{self, MixerConfig},
    player::{Player, PlayerEvent},
};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;

use crate::connect::{ConnectView, Hub, Modes, NowPlaying, Repeat};
use crate::pathfinder::Pathfinder;
use crate::settings::{ProgressMode, Quality};

// The client id and redirect librespot itself logs in with; Spotify has this redirect registered.
const CLIENT_ID: &str = "65b708073fc0480ea92a077233ca87bd";
const REDIRECT_URI: &str = "http://127.0.0.1:8898/login";
const SCOPES: &[&str] = &["streaming"];
const LOGIN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5 * 60);
const LOGIN_CLEANUP_WAIT: std::time::Duration = std::time::Duration::from_secs(5);
const HANDOFF_WAIT: std::time::Duration = std::time::Duration::from_secs(2);

/// The browser tab after the login: the duck with a check on a glass card. One page with the
/// duck inline, and no name in it: it is shown before the app knows who logged in.
const LOGIN_DONE_PAGE: &str = r##"<!doctype html><html lang="{lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>{title}</title><style>html,body{height:100%;margin:0}body{display:grid;place-items:center;font-family:"Segoe UI Variable","Segoe UI",system-ui,sans-serif;color:#f6f4ee;background:radial-gradient(ellipse 55% 60% at 50% 45%,rgba(255,216,77,.30),transparent 70%),#0a0a0c}.card{width:min(420px,calc(100% - 48px));padding:36px 32px 30px;text-align:center;border:1px solid rgba(255,255,255,.1);border-radius:22px;background:rgba(20,20,26,.6);backdrop-filter:blur(24px) saturate(140%);box-shadow:0 20px 50px rgba(0,0,0,.5)}.duck{position:relative;display:inline-block}.check{position:absolute;right:-6px;bottom:2px;width:26px;height:26px;border-radius:50%;background:#29d39a;border:3px solid #16161b;display:grid;place-items:center}h1{margin:18px 0 8px;font-size:24px;font-weight:750}p{margin:0;color:#9a978f;font-size:14px;line-height:1.5}kbd{display:inline-block;margin-top:18px;padding:3px 8px;border:1px solid rgba(255,255,255,.14);border-radius:6px;background:rgba(255,255,255,.06);color:#f6f4ee;font:600 12px "Segoe UI",system-ui,sans-serif}</style></head><body><div class="card"><div class="duck"><svg width="88" height="88" viewBox="0 0 64 64" aria-hidden="true"><path fill="#ffd84d" d="M38 10c7.7 0 14 6.1 14 13.7 0 3.1-1 5.9-2.8 8.2C56.7 35 61 41 61 47.6 61 56.6 52.4 62 41 62H20C9.5 62 3 55.8 3 47.4c0-6.8 5.5-11.6 12.3-11.6 3.2 0 6 1 8.1 2.9-.7-2-1.1-4.1-1.1-6.4C22.3 18.2 29.3 10 38 10z"/><path fill="#ff9f1c" d="M50 21.5c4.8-.6 9.2.4 11 2.6-1.8 2.6-6.4 4-11.6 3.6z"/><circle cx="42" cy="20" r="3" fill="#1a1a1a"/><path fill="#f2c230" d="M20 44c6 6 18 7 26 1-3 8-13 11-21 8-4-1.5-6-5-5-9z"/></svg><span class="check"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0a0a0c" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span></div><h1>{heading}</h1><p>{text}</p><kbd>Ctrl W</kbd></div></body></html>"##;

/// The page in the app's language (the one the Settings page last sent).
fn login_done_page(language: &str) -> String {
    let (lang, title, heading, text) = if language == "pt" {
        ("pt-BR", "Quackify: login concluído", "Pronto, o Quackify entrou", "Pode fechar esta aba e voltar pro app. A música já tá te esperando.")
    } else {
        ("en", "Quackify: logged in", "All set, Quackify is in", "You can close this tab and go back to the app. Your music is waiting.")
    };
    LOGIN_DONE_PAGE.replace("{lang}", lang).replace("{title}", title).replace("{heading}", heading).replace("{text}", text)
}


struct Engine {
    // Which connection this is, so a dropped one only revives itself, never a newer engine.
    generation: u64,
    session: Session,
    spirc: Arc<Spirc>,
    hub: Arc<Hub>,
    /// Filled a moment after the login (the "spotify-profile" event says when), so the app does
    /// not wait for it to open.
    profile: Arc<std::sync::Mutex<Profile>>,
}

/// How often the watcher looks at whether the session is still alive.
const SESSION_CHECK: std::time::Duration = std::time::Duration::from_secs(5);

static GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Waits between tries to come back after the connection drops, the last one repeating.
const REVIVE_WAITS: &[std::time::Duration] = &[
    std::time::Duration::from_secs(2),
    std::time::Duration::from_secs(5),
    std::time::Duration::from_secs(15),
    std::time::Duration::from_secs(30),
    std::time::Duration::from_secs(60),
];

/// The connection to Spotify dropped by itself (network gone, the PC slept, the server closed
/// it): librespot ends the session and takes the device out of Connect, and does not reconnect.
/// This logs back in with the saved login, retrying while the network is down, until it works
/// or the engine is replaced (logout, a new login, a settings reconnect, quitting).
/// Boxed: connect starts the next watcher, which calls revive again.
fn revive(app: AppHandle, generation: u64) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> {
    Box::pin(revive_inner(app, generation))
}

async fn revive_inner(app: AppHandle, generation: u64) {
    let state = app.state::<SpotifyState>();
    let still_mine = |slot: &Option<Engine>| slot.as_ref().is_some_and(|e| e.generation == generation);
    for attempt in 0.. {
        // A deliberate shutdown (quit, logout, a settings reconnect) already took this engine out.
        if attempt == 0 && !still_mine(&*state.0.lock().await) {
            return;
        }
        let wait = REVIVE_WAITS[attempt.min(REVIVE_WAITS.len() - 1)];
        eprintln!("[spotify] connection lost, reconnecting in {}s (try {})", wait.as_secs(), attempt + 1);
        tokio::time::sleep(wait).await;
        // Checked after the wait: a logout or a new login during it means nothing to revive.
        if !still_mine(&*state.0.lock().await) {
            return;
        }
        let Some(credentials) = open_cache(&app, None).ok().and_then(|c| c.credentials()) else { return };
        match connect(&app, credentials).await {
            Ok(engine) => {
                let mut slot = state.0.lock().await;
                if !still_mine(&slot) {
                    engine.shutdown();
                    return;
                }
                if let Some(old) = slot.replace(engine) {
                    old.shutdown();
                }
                eprintln!("[spotify] reconnected");
                return;
            }
            Err(e) => eprintln!("[spotify] reconnect failed: {e}"),
        }
    }
}

impl Engine {
    fn shutdown(&self) {
        let _ = self.spirc.shutdown();
        self.session.shutdown();
    }
}

/// The name and picture Spotify shows for the account.
#[derive(Serialize, Clone, Default)]
pub struct Profile {
    display_name: Option<String>,
    image: Option<String>,
}

#[derive(Default)]
pub struct SpotifyState(Mutex<Option<Engine>>);

#[derive(Serialize)]
pub struct Status {
    logged_in: bool,
    username: Option<String>,
    profile: Profile,
}

/// Local player events, for a precise clock while this device is the one playing.
#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum UiEvent {
    Loading { uri: String },
    Playing { uri: String, position_ms: u32 },
    Paused { uri: String, position_ms: u32 },
    Seeked { uri: String, position_ms: u32 },
    Stopped,
    Unavailable { uri: String },
}

fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("librespot"))
        .map_err(|e| e.to_string())
}

/// The login and volume cache; with `audio_limit`, songs are cached too, up to that many bytes.
fn open_cache(app: &AppHandle, audio_limit: Option<u64>) -> Result<Cache, String> {
    let dir = cache_dir(app)?;
    let audio = audio_limit.and_then(|_| crate::settings::prepare_cache_dir(app));
    let audio_limit = audio.as_ref().and(audio_limit);
    Cache::new(Some(&dir), Some(&dir), audio.as_ref(), audio_limit).map_err(|e| e.to_string())
}

/// This install's Connect device id, made once and kept. librespot makes a new one on every
/// launch, which leaves controllers holding an id that is gone after a restart.
fn device_id(app: &AppHandle) -> String {
    let fresh = || SessionConfig::default().device_id;
    let Ok(path) = cache_dir(app).map(|dir| dir.join("device_id")) else { return fresh() };
    if let Some(id) = std::fs::read_to_string(&path).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
        return id;
    }
    let id = fresh();
    let _ = std::fs::create_dir_all(path.parent().unwrap_or(&path)).and_then(|_| std::fs::write(&path, &id));
    id
}

/// Logs in and registers this app as a Spotify Connect device.
async fn connect(app: &AppHandle, credentials: Credentials) -> Result<Engine, String> {
    let settings = crate::settings::current(app);
    let cache = open_cache(app, settings.audio_cache.then(|| settings.cache_limit_bytes()))?;
    let initial_volume = cache.volume().unwrap_or(u16::MAX / 2);
    let session = Session::new(
        SessionConfig { autoplay: Some(settings.autoplay), device_id: device_id(app), ..Default::default() },
        Some(cache),
    );

    // librespot's default volume curve (log, 60 dB), the one Spotify's own apps use.
    let mixer = mixer::find(None).ok_or("no mixer")?(MixerConfig::default())
        .map_err(|e| e.to_string())?;
    let backend = audio_backend::find(None).ok_or("no audio backend")?;
    let player_config = PlayerConfig {
        bitrate: match settings.quality {
            Quality::Normal => Bitrate::Bitrate96,
            Quality::High => Bitrate::Bitrate160,
            Quality::VeryHigh => Bitrate::Bitrate320,
        },
        normalisation: settings.normalize,
        normalisation_pregain_db: settings.loudness.pregain_db(),
        gapless: settings.gapless,
        ..Default::default()
    };
    // Wave and Live play through Quackify's own output, with the meter; if it cannot open, rodio.
    let meter = (settings.progress_mode != ProgressMode::Simple).then(|| (app.clone(), mixer.get_soft_volume()));
    let player = Player::new(player_config, session.clone(), mixer.get_soft_volume(), move || {
        if let Some((app, volume)) = meter {
            match crate::meter::OutputSink::open(app, volume) {
                Ok(sink) => return Box::new(sink),
                Err(e) => eprintln!("[output] falling back to rodio: {e}"),
            }
        }
        backend(None, AudioFormat::default())
    });

    let config = ConnectConfig {
        name: settings.device_name(),
        device_type: DeviceType::Computer,
        initial_volume,
        ..Default::default()
    };
    // Spirc connects the session itself and saves reusable credentials to the cache.
    let (spirc, task) = Spirc::new(config, session.clone(), credentials, player.clone(), mixer.clone())
        .await
        .map_err(|e| e.to_string())?;
    let generation = GENERATION.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
    // A dead session does not always end the Spirc task (it can sit waiting on the dealer), so
    // the watcher also checks the session itself.
    let mut running = tauri::async_runtime::spawn(task);
    let (watcher, watched) = (app.clone(), session.clone());
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut running => break,
                _ = tokio::time::sleep(SESSION_CHECK) => if watched.is_invalid() { break },
            }
        }
        revive(watcher, generation).await;
    });
    let spirc = Arc::new(spirc);
    let hub = Hub::start(app.clone(), session.clone(), spirc.clone(), mixer);

    let mut events = player.get_player_event_channel();
    let (app2, hub2) = (app.clone(), hub.clone());
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            let ui = match event {
                PlayerEvent::Loading { track_id, .. } => {
                    hub2.set_local_stopped(false);
                    hub2.local_track(track_id.to_string());
                    Some(UiEvent::Loading { uri: track_id.to_string() })
                }
                PlayerEvent::Playing { track_id, position_ms, .. } => {
                    hub2.set_local_stopped(false);
                    hub2.local_track(track_id.to_string());
                    Some(UiEvent::Playing { uri: track_id.to_string(), position_ms })
                }
                PlayerEvent::Paused { track_id, position_ms, .. } => {
                    hub2.local_track(track_id.to_string());
                    Some(UiEvent::Paused { uri: track_id.to_string(), position_ms })
                }
                PlayerEvent::Seeked { track_id, position_ms, .. }
                | PlayerEvent::PositionCorrection { track_id, position_ms, .. } => {
                    Some(UiEvent::Seeked { uri: track_id.to_string(), position_ms })
                }
                PlayerEvent::Stopped { .. } => {
                    hub2.set_local_stopped(true);
                    Some(UiEvent::Stopped)
                }
                PlayerEvent::Unavailable { track_id, .. } => Some(UiEvent::Unavailable { uri: track_id.to_string() }),
                // Its URI can be another version of the song asked for (relinked), which the
                // cluster never shows: the song is told by the events that carry the one asked for.
                PlayerEvent::TrackChanged { .. } => None,
                // Shuffle, repeat and volume can change from another Spotify app: re-read the state.
                PlayerEvent::ShuffleChanged { .. }
                | PlayerEvent::RepeatChanged { .. }
                | PlayerEvent::VolumeChanged { .. } => None,
                _ => continue,
            };
            hub2.schedule_refresh();
            if let Some(ui) = ui {
                let _ = app2.emit("player-event", ui);
            }
        }
    });

    // The name and picture come after: the app opens without waiting for them (about 0.2 s).
    let profile = Arc::new(std::sync::Mutex::new(Profile::default()));
    let (app3, session3, profile3) = (app.clone(), session.clone(), profile.clone());
    tauri::async_runtime::spawn(async move {
        let fetched = fetch_profile(&session3).await;
        *profile3.lock().unwrap() = fetched.clone();
        // With the account, so a late answer for an account logged out meanwhile is left out.
        let _ = app3.emit(
            "spotify-profile",
            serde_json::json!({ "username": session3.username(), "display_name": fetched.display_name, "image": fetched.image }),
        );
    });
    Ok(Engine { generation, session, spirc, hub, profile })
}

async fn fetch_profile(session: &Session) -> Profile {
    let Ok(bytes) = session.spclient().get_user_profile(&session.username(), Some(0), Some(0)).await else {
        return Profile::default();
    };
    let v: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    Profile {
        display_name: v["name"].as_str().filter(|s| !s.is_empty()).map(str::to_string),
        image: v["image_url"].as_str().filter(|s| !s.is_empty()).map(str::to_string),
    }
}

fn status_of(engine: &Option<Engine>) -> Status {
    match engine {
        Some(e) if !e.session.is_invalid() => Status {
            logged_in: true,
            username: Some(e.session.username()),
            profile: e.profile.lock().unwrap().clone(),
        },
        _ => Status { logged_in: false, username: None, profile: Profile::default() },
    }
}

pub(crate) async fn session(state: &State<'_, SpotifyState>) -> Result<Session, String> {
    let slot = state.0.lock().await;
    Ok(slot.as_ref().ok_or("not logged in")?.session.clone())
}

/// Builds the player again with the current settings (they only apply at connection). The new
/// device comes up first and takes the music from the old one, still playing if it was, like a
/// Connect transfer between two devices; then the old one goes.
pub async fn reconnect(app: &AppHandle) -> Result<(), String> {
    use librespot_core::{dealer::protocol::TransferOptions, spclient::TransferRequest};
    let state = app.state::<SpotifyState>();
    let mut slot = state.0.lock().await;
    let Some(old) = slot.take() else { return Ok(()) };
    let credentials = match open_cache(app, None).map(|c| c.credentials()) {
        Ok(Some(c)) => c,
        Ok(None) => {
            *slot = Some(old);
            return Err("the saved login is gone; log in again".into());
        }
        Err(e) => {
            *slot = Some(old);
            return Err(e);
        }
    };
    let engine = match connect(app, credentials).await {
        Ok(engine) => engine,
        Err(e) => {
            *slot = Some(old);
            return Err(e);
        }
    };
    if let Some(playing) = old.hub.active_here() {
        // The new device has to be in the cluster before it can receive the music.
        tokio::time::sleep(HANDOFF_WAIT).await;
        let request = TransferRequest {
            transfer_options: TransferOptions {
                restore_paused: Some(if playing { "resume" } else { "restore" }.to_string()),
                ..Default::default()
            },
        };
        let (from, to) = (old.session.device_id().to_string(), engine.session.device_id().to_string());
        if let Err(e) = engine.session.spclient().transfer(&from, &to, Some(&request)).await {
            eprintln!("settings: playback not handed over: {e}");
        }
    }
    old.shutdown();
    *slot = Some(engine);
    Ok(())
}

/// Ends the session, if any, when the app quits.
pub async fn shutdown(app: &AppHandle) {
    let state = app.state::<SpotifyState>();
    if let Some(engine) = state.0.lock().await.take() {
        engine.shutdown();
    }
    crate::media::publish(app, None);
}

/// The hub of the logged-in session, for callers outside a command (media keys, tray).
pub async fn current_hub(app: &AppHandle) -> Option<Arc<Hub>> {
    let state = app.state::<SpotifyState>();
    let slot = state.0.lock().await;
    slot.as_ref().map(|e| e.hub.clone())
}

async fn hub(state: &State<'_, SpotifyState>) -> Result<Arc<Hub>, String> {
    let slot = state.0.lock().await;
    Ok(slot.as_ref().ok_or("not logged in")?.hub.clone())
}

#[tauri::command]
pub async fn spotify_status(state: State<'_, SpotifyState>) -> Result<Status, String> {
    Ok(status_of(&*state.0.lock().await))
}

/// Starts logging back in as the app starts, while the window and the page are still loading
/// (about 0.6 s), so spotify_restore finds it under way or done.
pub fn restore_early(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<SpotifyState>();
        let mut slot = state.0.lock().await;
        if slot.is_some() {
            return;
        }
        let Some(credentials) = open_cache(&app, None).ok().and_then(|c| c.credentials()) else { return };
        match connect(&app, credentials).await {
            Ok(engine) => *slot = Some(engine),
            // spotify_restore tries again and reports it.
            Err(e) => eprintln!("spotify: early login failed: {e}"),
        }
    });
}

/// Logs back in with the credentials librespot cached after the last OAuth login, if any.
#[tauri::command]
pub async fn spotify_restore(app: AppHandle, state: State<'_, SpotifyState>) -> Result<Status, String> {
    let mut slot = state.0.lock().await;
    if slot.is_none() {
        if let Some(credentials) = open_cache(&app, None)?.credentials() {
            *slot = Some(connect(&app, credentials).await?);
        }
    }
    Ok(status_of(&slot))
}

// The library's redirect listener blocks on accept() with no way out. A request without a
// `code` makes it return an error, which is how a pending login gets cancelled.
fn wake_redirect_listener() {
    use std::io::Write;
    let addr = REDIRECT_URI
        .trim_start_matches("http://")
        .split('/')
        .next()
        .unwrap_or_default();
    if let Ok(mut stream) = std::net::TcpStream::connect(addr) {
        let _ = stream.write_all(b"GET /login?error=cancelled HTTP/1.1\r\n\r\n");
    }
}

/// Opens the Spotify consent page in the browser and waits for the redirect.
#[tauri::command]
pub async fn spotify_login(app: AppHandle, state: State<'_, SpotifyState>) -> Result<Status, String> {
    let page_lang = crate::settings::current(&app).language;
    let mut waiting = tauri::async_runtime::spawn_blocking(move || {
        OAuthClientBuilder::new(CLIENT_ID, REDIRECT_URI, SCOPES.to_vec())
            .open_in_browser()
            .with_custom_message(&login_done_page(&page_lang))
            .build()
            .and_then(|client| client.get_access_token())
            .map_err(|e| e.to_string())
    });
    let joined = match tokio::time::timeout(LOGIN_TIMEOUT, &mut waiting).await {
        Ok(joined) => joined,
        Err(_) => {
            // Wake the listener so its thread ends and frees the port. A token exchange already
            // under way cannot be cancelled, so the wait for it is bounded too.
            wake_redirect_listener();
            let _ = tokio::time::timeout(LOGIN_CLEANUP_WAIT, waiting).await;
            return Err("login timed out, try again".into());
        }
    };
    let token = joined
        .map_err(|e| e.to_string())
        .and_then(|r| r)
        .map_err(|e| {
            if e.contains("error=cancelled") {
                "login cancelled".to_string()
            } else if e.contains("error=access_denied") {
                "access was denied on the Spotify page".to_string()
            } else {
                e
            }
        })?;

    let engine = connect(&app, Credentials::with_access_token(token.access_token)).await?;
    let mut slot = state.0.lock().await;
    if let Some(old) = slot.replace(engine) {
        old.shutdown();
    }
    Ok(status_of(&slot))
}

/// Ends a pending login (the user closed the tab or changed their mind).
#[tauri::command]
pub fn spotify_cancel_login() {
    wake_redirect_listener();
}

#[tauri::command]
pub async fn spotify_logout(app: AppHandle, state: State<'_, SpotifyState>) -> Result<(), String> {
    // Holding the engine lock for the whole logout keeps a restore or login from writing the
    // credentials back in between. They go first: if they cannot be deleted, the session stays.
    let mut slot = state.0.lock().await;
    let file = cache_dir(&app)?.join("credentials.json");
    if file.exists() {
        std::fs::remove_file(file).map_err(|e| e.to_string())?;
    }
    if let Some(old) = slot.take() {
        old.shutdown();
    }
    crate::media::publish(&app, None);
    Ok(())
}

/// Runs one of Spotify's internal GraphQL operations (see pathfinder.rs) and returns its data.
#[tauri::command]
pub async fn spotify_query(
    op: String,
    variables: Value,
    state: State<'_, SpotifyState>,
    pathfinder: State<'_, Pathfinder>,
) -> Result<Value, String> {
    let session = {
        let slot = state.0.lock().await;
        slot.as_ref().ok_or("not logged in")?.session.clone()
    };
    pathfinder.query(&session, &op, variables).await
}

#[derive(Serialize)]
pub struct PlayerState {
    connect: ConnectView,
    now_playing: Option<NowPlaying>,
}

/// Devices, what plays where, and the current track: for a window that just (re)loaded.
#[tauri::command]
pub async fn spotify_player_state(state: State<'_, SpotifyState>) -> Result<PlayerState, String> {
    let hub = hub(&state).await?;
    Ok(PlayerState { connect: hub.view(), now_playing: hub.now_playing() })
}

/// Plays a playlist, album, artist or Liked Songs from `track_uri` (or from the top).
#[tauri::command]
pub async fn spotify_play_context(
    context_uri: String,
    track_uri: Option<String>,
    position_ms: Option<u32>,
    modes: Modes,
    state: State<'_, SpotifyState>,
) -> Result<(), String> {
    hub(&state).await?.play_context(context_uri, track_uri, position_ms, modes).await
}

/// Plays a loose list of tracks (search results) from `index`.
#[tauri::command]
pub async fn spotify_play_tracks(
    uris: Vec<String>,
    index: usize,
    modes: Modes,
    state: State<'_, SpotifyState>,
) -> Result<(), String> {
    hub(&state).await?.play_tracks(uris, index, modes).await
}

#[tauri::command]
pub async fn spotify_pause(state: State<'_, SpotifyState>) -> Result<(), String> {
    hub(&state).await?.pause().await
}

#[tauri::command]
pub async fn spotify_resume(state: State<'_, SpotifyState>) -> Result<(), String> {
    hub(&state).await?.resume().await
}

#[tauri::command]
pub async fn spotify_next(state: State<'_, SpotifyState>) -> Result<(), String> {
    hub(&state).await?.next().await
}

#[tauri::command]
pub async fn spotify_previous(state: State<'_, SpotifyState>) -> Result<(), String> {
    hub(&state).await?.previous().await
}

#[tauri::command]
pub async fn spotify_seek(position_ms: u32, state: State<'_, SpotifyState>) -> Result<(), String> {
    hub(&state).await?.seek(position_ms).await
}

/// `volume` goes from 0 to 1.
#[tauri::command]
pub async fn spotify_set_volume(volume: f64, state: State<'_, SpotifyState>) -> Result<(), String> {
    hub(&state).await?.set_volume(volume).await
}

#[tauri::command]
pub async fn spotify_set_shuffle(on: bool, state: State<'_, SpotifyState>) -> Result<(), String> {
    hub(&state).await?.shuffle(on).await
}

#[tauri::command]
pub async fn spotify_set_repeat(repeat: Repeat, state: State<'_, SpotifyState>) -> Result<(), String> {
    hub(&state).await?.repeat(repeat).await
}

/// Moves playback to another Spotify Connect device (or pulls it to this one).
#[tauri::command]
pub async fn spotify_transfer(device_id: String, state: State<'_, SpotifyState>) -> Result<(), String> {
    hub(&state).await?.transfer(device_id).await
}

/// Adds a track to the queue of the device that is playing.
#[tauri::command]
pub async fn spotify_add_to_queue(uri: String, state: State<'_, SpotifyState>) -> Result<(), String> {
    hub(&state).await?.add_to_queue(uri).await
}

/// Metadata for a list of track URIs (the queue only carries URIs).
#[tauri::command]
pub async fn spotify_tracks(uris: Vec<String>, state: State<'_, SpotifyState>) -> Result<Vec<NowPlaying>, String> {
    Ok(hub(&state).await?.tracks(uris).await)
}

/// A user's profile as Spotify's own profile page reads it: name, picture, followers, public
/// playlists and recently played artists. No username: the logged-in user.
#[tauri::command]
pub async fn spotify_user_profile(username: Option<String>, state: State<'_, SpotifyState>) -> Result<Value, String> {
    let session = session(&state).await?;
    let user = username.unwrap_or_else(|| session.username());
    let bytes = session
        .spclient()
        .get_user_profile(&user, Some(50), Some(20))
        .await
        .map_err(|e| e.to_string())?;
    let mut v: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    v["is_me"] = Value::Bool(user == session.username());
    v["username"] = Value::String(user);
    Ok(v)
}

/// The song radio of a track: the playlist Spotify makes from it ("Go to song radio").
#[tauri::command]
pub async fn spotify_song_radio(uri: String, state: State<'_, SpotifyState>) -> Result<String, String> {
    use librespot_core::SpotifyUri;
    let id = SpotifyUri::from_uri(&uri).map_err(|e| e.to_string())?;
    let session = session(&state).await?;
    let bytes = session.spclient().get_radio_for_track(&id).await.map_err(|e| e.to_string())?;
    radio_playlist(&serde_json::from_slice(&bytes).map_err(|e| e.to_string())?)
        .ok_or_else(|| "Spotify has no radio for this song.".to_string())
}

fn radio_playlist(v: &Value) -> Option<String> {
    v["mediaItems"].as_array()?.iter().find_map(|m| m["uri"].as_str().filter(|u| u.starts_with("spotify:playlist:")).map(str::to_string))
}

/// Removes, moves or clears what plays next.
#[tauri::command]
pub async fn spotify_edit_queue(edit: crate::connect::QueueEdit, state: State<'_, SpotifyState>) -> Result<(), String> {
    hub(&state).await?.edit_queue(edit).await
}

/// Jumps to a track in the queue.
#[tauri::command]
pub async fn spotify_skip_to(uri: String, uid: String, state: State<'_, SpotifyState>) -> Result<(), String> {
    hub(&state).await?.skip_to(uri, uid).await
}

async fn playlist_api(session: &Session, path: &str, body: Value) -> Result<Value, String> {
    use http::{header, HeaderMap, HeaderValue, Method};
    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(header::ACCEPT, HeaderValue::from_static("application/json"));
    let bytes = session
        .spclient()
        .request(&Method::POST, path, Some(headers), Some(body.to_string().as_bytes()))
        .await
        .map_err(|e| e.to_string())?;
    Ok(serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

// The playlist service rejects the optional fields the web player's encoder adds (400):
// these bodies are the minimal ones it accepts.

/// Creates a playlist named `name` at the top of the user's library and returns its URI.
#[tauri::command]
pub async fn spotify_create_playlist(name: String, state: State<'_, SpotifyState>) -> Result<String, String> {
    let session = session(&state).await?;
    let created = playlist_api(
        &session,
        "/playlist/v2/playlist",
        serde_json::json!({
            "ops": [{
                "kind": "UPDATE_LIST_ATTRIBUTES",
                "updateListAttributes": {
                    "newAttributes": { "values": { "name": name } }
                }
            }],
        }),
    )
    .await?;
    let uri = created["uri"].as_str().ok_or("Spotify did not return the new playlist")?.to_string();
    let user = session.username();
    playlist_api(
        &session,
        &format!("/playlist/v2/user/{user}/rootlist/changes"),
        serde_json::json!({
            "deltas": [{
                "ops": [{ "kind": "ADD", "add": { "items": [{ "uri": uri }], "addFirst": true } }],
            }],
        }),
    )
    .await?;
    Ok(uri)
}

/// Renames a playlist and sets its description.
#[tauri::command]
pub async fn spotify_edit_playlist(
    uri: String,
    name: String,
    description: String,
    state: State<'_, SpotifyState>,
) -> Result<(), String> {
    let session = session(&state).await?;
    let id = uri.strip_prefix("spotify:playlist:").ok_or("not a playlist")?;
    playlist_api(
        &session,
        &format!("/playlist/v2/playlist/{id}/changes"),
        serde_json::json!({
            "deltas": [{
                "ops": [{
                    "kind": "UPDATE_LIST_ATTRIBUTES",
                    "updateListAttributes": {
                        "newAttributes": { "values": { "name": name, "description": description } }
                    }
                }],
            }],
        }),
    )
    .await?;
    Ok(())
}

/// Adds a playlist to the user's library (the rootlist) or removes it. The GraphQL library
/// operations refuse playlist URIs, so playlists go through the playlist service.
#[tauri::command]
pub async fn spotify_rootlist_change(uri: String, add: bool, state: State<'_, SpotifyState>) -> Result<(), String> {
    let session = session(&state).await?;
    let op = if add {
        serde_json::json!({ "kind": "ADD", "add": { "items": [{ "uri": uri }], "addFirst": true } })
    } else {
        serde_json::json!({ "kind": "REM", "rem": { "items": [{ "uri": uri }], "itemsAsKey": true } })
    };
    let user = session.username();
    playlist_api(
        &session,
        &format!("/playlist/v2/user/{user}/rootlist/changes"),
        serde_json::json!({ "deltas": [{ "ops": [op] }] }),
    )
    .await?;
    Ok(())
}

/// A song's lyrics, as the web player's lyrics view gets them.
#[derive(Serialize, Debug, PartialEq)]
pub struct Lyrics {
    /// Each line has its start time; otherwise the times are all zero.
    synced: bool,
    lines: Vec<LyricsLine>,
    provider: String,
    /// The song's colors (`#rrggbb`), for the background, the lines, and the line being sung.
    background: Option<String>,
    text: Option<String>,
    highlight: Option<String>,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct LyricsLine {
    start_ms: u64,
    words: String,
}

fn parse_lyrics(v: &Value) -> Option<Lyrics> {
    let l = &v["lyrics"];
    let lines: Vec<LyricsLine> = l["lines"]
        .as_array()?
        .iter()
        .map(|line| LyricsLine {
            // Spotify sends the times as strings.
            start_ms: line["startTimeMs"].as_str().and_then(|s| s.parse().ok()).unwrap_or(0),
            words: line["words"].as_str().unwrap_or_default().to_string(),
        })
        .collect();
    if lines.is_empty() {
        return None;
    }
    // Colors are signed ARGB integers.
    let color = |key: &str| v["colors"][key].as_i64().map(|c| format!("#{:06x}", c as u32 & 0xff_ffff));
    Some(Lyrics {
        synced: l["syncType"].as_str() == Some("LINE_SYNCED"),
        lines,
        provider: l["providerDisplayName"].as_str().unwrap_or_default().to_string(),
        background: color("background"),
        text: color("text"),
        highlight: color("highlightText"),
    })
}

/// The lyrics of a track, or nothing when Spotify has none for it.
/// The loudness of each stretch of a song, before it plays (waveform.rs).
#[tauri::command]
pub async fn spotify_waveform(uri: String, state: State<'_, SpotifyState>) -> Result<Vec<f32>, String> {
    let session = session(&state).await?;
    crate::waveform::measure(&session, &uri).await
}

#[tauri::command]
pub async fn spotify_lyrics(uri: String, state: State<'_, SpotifyState>) -> Result<Option<Lyrics>, String> {
    use http::{header, HeaderMap, HeaderValue, Method};
    use librespot_core::{error::ErrorKind, SpotifyId};
    let id = uri.strip_prefix("spotify:track:").ok_or("not a track")?;
    let id = SpotifyId::from_base62(id).map_err(|e| e.to_string())?;
    let session = session(&state).await?;
    let mut headers = HeaderMap::new();
    headers.insert(header::ACCEPT, HeaderValue::from_static("application/json"));
    headers.insert("app-platform", HeaderValue::from_static("WebPlayer"));
    let path = format!(
        "/color-lyrics/v2/track/{}?format=json&vocalRemoval=false&market=from_token",
        id.to_base62().map_err(|e| e.to_string())?
    );
    match session.spclient().request(&Method::GET, &path, Some(headers), None).await {
        Ok(bytes) => Ok(serde_json::from_slice(&bytes).ok().as_ref().and_then(parse_lyrics)),
        Err(e) if e.kind == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Whether each playlist URI is in the user's library, in order.
#[tauri::command]
pub async fn spotify_rootlist_has(uris: Vec<String>, state: State<'_, SpotifyState>) -> Result<Vec<bool>, String> {
    use librespot_protocol::playlist4_external::SelectedListContent;
    use protobuf::Message as _;
    let session = session(&state).await?;
    let bytes = session
        .spclient()
        .get_rootlist(0, Some(10_000))
        .await
        .map_err(|e| e.to_string())?;
    let list = SelectedListContent::parse_from_bytes(&bytes).map_err(|e| e.to_string())?;
    let saved: std::collections::HashSet<String> = list
        .contents
        .items
        .iter()
        .map(|i| i.uri().to_string())
        .collect();
    Ok(uris.iter().map(|u| saved.contains(u)).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_radio_playlist() {
        let v = serde_json::json!({ "total": 1, "mediaItems": [{ "uri": "spotify:playlist:37i9dQZF1E8abc" }] });
        assert_eq!(radio_playlist(&v).as_deref(), Some("spotify:playlist:37i9dQZF1E8abc"));
        assert_eq!(radio_playlist(&serde_json::json!({ "mediaItems": [] })), None);
    }

    #[test]
    fn reads_synced_lyrics_and_colors() {
        let v = serde_json::json!({
            "lyrics": {
                "syncType": "LINE_SYNCED",
                "lines": [
                    { "startTimeMs": "13120", "words": "Yeah", "endTimeMs": "0" },
                    { "startTimeMs": "27170", "words": "I've been tryna call", "endTimeMs": "0" }
                ],
                "providerDisplayName": "Musixmatch"
            },
            "colors": { "background": -1889493, "text": -16777216, "highlightText": -1 }
        });
        let l = parse_lyrics(&v).unwrap();
        assert!(l.synced);
        assert_eq!(l.lines[1], LyricsLine { start_ms: 27170, words: "I've been tryna call".into() });
        assert_eq!(l.provider, "Musixmatch");
        assert_eq!(l.background.as_deref(), Some("#e32b2b"));
        assert_eq!(l.text.as_deref(), Some("#000000"));
        assert_eq!(l.highlight.as_deref(), Some("#ffffff"));
    }

    #[test]
    fn unsynced_or_empty_lyrics() {
        let v = serde_json::json!({ "lyrics": { "syncType": "UNSYNCED", "lines": [{ "startTimeMs": "0", "words": "la" }] } });
        let l = parse_lyrics(&v).unwrap();
        assert!(!l.synced);
        assert_eq!(l.background, None);
        assert_eq!(parse_lyrics(&serde_json::json!({ "lyrics": { "lines": [] } })), None);
    }

    #[test]
    fn login_page_in_both_languages() {
        let pt = login_done_page("pt");
        assert!(pt.contains("<html lang=\"pt-BR\">") && pt.contains("Pronto, o Quackify entrou") && pt.contains("login concluído"));
        let en = login_done_page("en");
        assert!(en.contains("<html lang=\"en\">") && en.contains("All set, Quackify is in"));
        // No placeholder left, and the CSS braces untouched.
        for page in [&pt, &en] {
            assert!(!page.contains("{lang}") && !page.contains("{title}") && !page.contains("{heading}") && !page.contains("{text}"));
            assert!(page.contains("html,body{height:100%;margin:0}"));
        }
    }
}
