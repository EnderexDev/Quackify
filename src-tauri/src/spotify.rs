// Spotify playback through librespot: OAuth login, a credentials cache and one local player.
use std::path::PathBuf;
use std::sync::Arc;

use librespot_core::{
    authentication::Credentials, cache::Cache, config::SessionConfig, session::Session,
    spotify_uri::SpotifyUri,
};
use librespot_oauth::OAuthClientBuilder;
use librespot_playback::{
    audio_backend,
    config::{AudioFormat, PlayerConfig},
    mixer::{self, MixerConfig},
    player::{Player, PlayerEvent},
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;

// The client id and redirect librespot itself logs in with; Spotify has this redirect registered.
const CLIENT_ID: &str = "65b708073fc0480ea92a077233ca87bd";
const REDIRECT_URI: &str = "http://127.0.0.1:8898/login";
const SCOPES: &[&str] = &["streaming"];
const LOGIN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5 * 60);

const LOGIN_DONE_PAGE: &str = r#"<!doctype html><html><body style="font-family:sans-serif;background:#1a1a1a;color:#ffd84d;text-align:center;padding-top:20vh"><h1>Quackify is in. You can close this tab.</h1></body></html>"#;

struct Engine {
    session: Session,
    player: Arc<Player>,
}

#[derive(Default)]
pub struct SpotifyState(Mutex<Option<Engine>>);

#[derive(Serialize)]
pub struct Status {
    logged_in: bool,
    username: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum UiEvent {
    Loading { uri: String },
    Playing { uri: String, position_ms: u32 },
    Paused { uri: String, position_ms: u32 },
    Stopped,
    EndOfTrack { uri: String },
    Unavailable { uri: String },
}

fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("librespot"))
        .map_err(|e| e.to_string())
}

fn open_cache(app: &AppHandle) -> Result<Cache, String> {
    let dir = cache_dir(app)?;
    Cache::new(Some(&dir), None, None, None).map_err(|e| e.to_string())
}

// Accepts spotify:track:<id> or an open.spotify.com/track/<id> link.
fn parse_uri(input: &str) -> Result<SpotifyUri, String> {
    let input = input.trim();
    let uri = match input.split_once("open.spotify.com/") {
        Some((_, rest)) => {
            let path = rest.split(['?', '#']).next().unwrap_or("");
            let parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty() && !p.starts_with("intl-")).collect();
            match parts.as_slice() {
                [kind, id, ..] => format!("spotify:{kind}:{id}"),
                _ => return Err(format!("not a Spotify link: {input}")),
            }
        }
        None => input.to_string(),
    };
    SpotifyUri::from_uri(&uri).map_err(|e| format!("{uri}: {e}"))
}

async fn connect(app: &AppHandle, credentials: Credentials) -> Result<Engine, String> {
    let session = Session::new(SessionConfig::default(), Some(open_cache(app)?));
    session
        .connect(credentials, true)
        .await
        .map_err(|e| e.to_string())?;

    let mixer = mixer::find(None).ok_or("no mixer")?(MixerConfig::default())
        .map_err(|e| e.to_string())?;
    let backend = audio_backend::find(None).ok_or("no audio backend")?;
    let player = Player::new(
        PlayerConfig::default(),
        session.clone(),
        mixer.get_soft_volume(),
        move || backend(None, AudioFormat::default()),
    );

    let mut events = player.get_player_event_channel();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            let ui = match event {
                PlayerEvent::Loading { track_id, .. } => UiEvent::Loading { uri: track_id.to_string() },
                PlayerEvent::Playing { track_id, position_ms, .. } => {
                    UiEvent::Playing { uri: track_id.to_string(), position_ms }
                }
                PlayerEvent::Paused { track_id, position_ms, .. } => {
                    UiEvent::Paused { uri: track_id.to_string(), position_ms }
                }
                PlayerEvent::Stopped { .. } => UiEvent::Stopped,
                PlayerEvent::EndOfTrack { track_id, .. } => UiEvent::EndOfTrack { uri: track_id.to_string() },
                PlayerEvent::Unavailable { track_id, .. } => UiEvent::Unavailable { uri: track_id.to_string() },
                _ => continue,
            };
            let _ = app.emit("player-event", ui);
        }
    });

    Ok(Engine { session, player })
}

fn status_of(engine: &Option<Engine>) -> Status {
    match engine {
        Some(e) if !e.session.is_invalid() => Status {
            logged_in: true,
            username: Some(e.session.username()),
        },
        _ => Status { logged_in: false, username: None },
    }
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
        if let Some(credentials) = open_cache(&app)?.credentials() {
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
            wake_redirect_listener();
            let _ = waiting.await;
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
        old.player.stop();
        old.session.shutdown();
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
    // The saved credentials go first: if they cannot be deleted, the session stays as it was.
    let file = cache_dir(&app)?.join("credentials.json");
    if file.exists() {
        std::fs::remove_file(file).map_err(|e| e.to_string())?;
    }
    if let Some(old) = state.0.lock().await.take() {
        old.player.stop();
        old.session.shutdown();
    }
    Ok(())
}

#[tauri::command]
pub async fn spotify_play(uri: String, state: State<'_, SpotifyState>) -> Result<String, String> {
    let uri = parse_uri(&uri)?;
    let slot = state.0.lock().await;
    let engine = slot.as_ref().ok_or("not logged in")?;
    let shown = uri.to_string();
    engine.player.load(uri, true, 0);
    Ok(shown)
}

#[tauri::command]
pub async fn spotify_pause(state: State<'_, SpotifyState>) -> Result<(), String> {
    let slot = state.0.lock().await;
    slot.as_ref().ok_or("not logged in")?.player.pause();
    Ok(())
}

#[tauri::command]
pub async fn spotify_resume(state: State<'_, SpotifyState>) -> Result<(), String> {
    let slot = state.0.lock().await;
    slot.as_ref().ok_or("not logged in")?.player.play();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::parse_uri;

    #[test]
    fn parses_uris_and_links() {
        let id = "4uLU6hMCjMI75M1A2tKUQC";
        let want = format!("spotify:track:{id}");
        assert_eq!(parse_uri(&want).unwrap().to_string(), want);
        assert_eq!(parse_uri(&format!("https://open.spotify.com/track/{id}?si=abc")).unwrap().to_string(), want);
        assert_eq!(parse_uri(&format!("https://open.spotify.com/intl-pt/track/{id}")).unwrap().to_string(), want);
        assert!(parse_uri("https://open.spotify.com/").is_err());
    }
}
