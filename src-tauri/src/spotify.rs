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

use crate::connect::{ConnectView, Hub, NowPlaying, Repeat};
use crate::pathfinder::Pathfinder;
use crate::settings::{ProgressMode, Quality};

// The client id and redirect librespot itself logs in with; Spotify has this redirect registered.
const CLIENT_ID: &str = "65b708073fc0480ea92a077233ca87bd";
const REDIRECT_URI: &str = "http://127.0.0.1:8898/login";
const SCOPES: &[&str] = &["streaming"];
const LOGIN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5 * 60);
const LOGIN_CLEANUP_WAIT: std::time::Duration = std::time::Duration::from_secs(5);
const HANDOFF_WAIT: std::time::Duration = std::time::Duration::from_secs(2);

const LOGIN_DONE_PAGE: &str = r#"<!doctype html><html><body style="font-family:sans-serif;background:#1a1a1a;color:#ffd84d;text-align:center;padding-top:20vh"><h1>Quackify is in. You can close this tab.</h1></body></html>"#;

struct Engine {
    session: Session,
    spirc: Arc<Spirc>,
    hub: Arc<Hub>,
    profile: Profile,
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

/// Logs in and registers this app as a Spotify Connect device.
async fn connect(app: &AppHandle, credentials: Credentials) -> Result<Engine, String> {
    let settings = crate::settings::current(app);
    let cache = open_cache(app, settings.audio_cache.then(|| settings.cache_limit_bytes()))?;
    let initial_volume = cache.volume().unwrap_or(u16::MAX / 2);
    let session = Session::new(SessionConfig { autoplay: Some(settings.autoplay), ..Default::default() }, Some(cache));

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
    tauri::async_runtime::spawn(task);
    let spirc = Arc::new(spirc);
    let hub = Hub::start(app.clone(), session.clone(), spirc.clone(), mixer);

    let mut events = player.get_player_event_channel();
    let (app2, hub2) = (app.clone(), hub.clone());
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            let ui = match event {
                PlayerEvent::Loading { track_id, .. } => {
                    hub2.set_local_stopped(false);
                    Some(UiEvent::Loading { uri: track_id.to_string() })
                }
                PlayerEvent::Playing { track_id, position_ms, .. } => {
                    hub2.set_local_stopped(false);
                    Some(UiEvent::Playing { uri: track_id.to_string(), position_ms })
                }
                PlayerEvent::Paused { track_id, position_ms, .. } => {
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
                PlayerEvent::TrackChanged { audio_item } => {
                    hub2.announce_track(audio_item.uri.clone());
                    None
                }
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

    let profile = fetch_profile(&session).await;
    Ok(Engine { session, spirc, hub, profile })
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
            profile: e.profile.clone(),
        },
        _ => Status { logged_in: false, username: None, profile: Profile::default() },
    }
}

async fn session(state: &State<'_, SpotifyState>) -> Result<Session, String> {
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
    let credentials = match open_cache(app, None)?.credentials() {
        Some(c) => c,
        None => {
            *slot = Some(old);
            return Err("the saved login is gone; log in again".into());
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
    let mut waiting = tauri::async_runtime::spawn_blocking(|| {
        OAuthClientBuilder::new(CLIENT_ID, REDIRECT_URI, SCOPES.to_vec())
            .open_in_browser()
            .with_custom_message(LOGIN_DONE_PAGE)
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
    state: State<'_, SpotifyState>,
) -> Result<(), String> {
    hub(&state).await?.play_context(context_uri, track_uri).await
}

/// Plays a loose list of tracks (search results) from `index`.
#[tauri::command]
pub async fn spotify_play_tracks(uris: Vec<String>, index: usize, state: State<'_, SpotifyState>) -> Result<(), String> {
    hub(&state).await?.play_tracks(uris, index).await
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
}
