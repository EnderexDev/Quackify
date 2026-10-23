// Spotify Connect, the part librespot's Spirc does not cover: the account's device list, what
// the active device is playing, remote control of another device, and transfers between them.
//
// The source of truth is the account's cluster (`GET /connect-state/v1/cluster`). The dealer
// pushes a message whenever it changes; each push, and each local player event, schedules one
// debounced re-read, so there is a single parser for the whole state.
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use http::{header, HeaderMap, HeaderValue, Method};
use librespot_connect::{LoadRequest, LoadRequestOptions, PlayingTrack, Spirc};
use librespot_playback::mixer::Mixer;
use librespot_core::{dealer::protocol::Message, session::Session, spotify_uri::SpotifyUri};
use librespot_metadata::{Episode, Metadata, Track};
use librespot_protocol::connect::ClusterUpdate;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

const REFRESH_DEBOUNCE: Duration = Duration::from_millis(250);
// The device registers itself shortly after start, and the server does not tell the device
// about its own registration: read the cluster again after this long.
const SETTLE_REREAD: Duration = Duration::from_secs(3);
/// How long a queue edit waits, at most, for Spotify to show it (tries x step).
const QUEUE_SETTLE_TRIES: u32 = 12;
const QUEUE_SETTLE_STEP: Duration = Duration::from_millis(250);
/// How this device shows up in the other Spotify apps.

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Repeat {
    #[default]
    Off,
    All,
    One,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Device {
    id: String,
    name: String,
    /// COMPUTER, SMARTPHONE, SPEAKER, TV... as Spotify names them.
    kind: String,
    /// 0..1
    volume: f64,
    is_active: bool,
    is_local: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Playback {
    track_uri: String,
    context_uri: Option<String>,
    /// Position of the track inside its context (for highlighting the right row).
    index: Option<u32>,
    is_playing: bool,
    /// Where the track was when the cluster was read; the UI extrapolates from there.
    position_ms: u64,
    duration_ms: u64,
    shuffle: bool,
    repeat: Repeat,
    /// What plays next: added to the queue first, then the rest of the context.
    next_tracks: Vec<QueuedTrack>,
    /// What played before in this playback, the latest first.
    prev_tracks: Vec<QueuedTrack>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct QueuedTrack {
    uri: String,
    /// Tells two copies of the same song apart when skipping to one.
    uid: String,
    /// "queue" for a track the user added, "context" or "autoplay" for the rest.
    provider: String,
}

/// How many upcoming tracks the queue view gets.
const QUEUE_LIMIT: usize = 50;

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
pub struct ConnectView {
    local_device_id: String,
    active_device_id: Option<String>,
    devices: Vec<Device>,
    playback: Option<Playback>,
}

#[derive(Serialize, Clone)]
pub struct Named {
    uri: String,
    name: String,
}

#[derive(Serialize, Clone)]
pub struct NowPlaying {
    uri: String,
    name: String,
    artists: Vec<Named>,
    album: Named,
    image: Option<String>,
    duration_ms: u32,
}

pub struct Hub {
    app: AppHandle,
    session: Session,
    spirc: Arc<Spirc>,
    mixer: Arc<dyn Mixer>,
    view: StdMutex<ConnectView>,
    // When the view was read, to move a playing position forward in snapshots.
    view_read_at: StdMutex<Instant>,
    now_playing: StdMutex<Option<NowPlaying>>,
    // The track whose metadata was last asked for: an older answer arriving late is dropped.
    wanted_track: StdMutex<Option<String>>,
    refresh_pending: AtomicBool,
    // This app's player stopped (the last song ended with nothing after it). librespot 0.8 then
    // leaves the playback it publishes as playing at 0:00, so the view says paused instead, and
    // play starts the song again (librespot ignores play while stopped).
    local_stopped: AtomicBool,
    // One cluster read at a time, in order, so an older answer never overwrites a newer one.
    refreshing: tokio::sync::Mutex<()>,
    // Queue edits one at a time, each on the queue the previous one left.
    editing_queue: tokio::sync::Mutex<()>,
    // Track metadata already fetched, for the queue and lists that only carry URIs.
    track_cache: StdMutex<std::collections::HashMap<String, NowPlaying>>,
}

enum Target {
    Local,
    Remote(String),
}

impl Hub {
    pub fn start(app: AppHandle, session: Session, spirc: Arc<Spirc>, mixer: Arc<dyn Mixer>) -> Arc<Self> {
        let hub = Arc::new(Self {
            app,
            view: StdMutex::new(ConnectView {
                local_device_id: session.device_id().to_string(),
                ..Default::default()
            }),
            view_read_at: StdMutex::new(Instant::now()),
            session,
            spirc,
            mixer,
            now_playing: StdMutex::new(None),
            wanted_track: StdMutex::new(None),
            refresh_pending: AtomicBool::new(false),
            local_stopped: AtomicBool::new(false),
            refreshing: tokio::sync::Mutex::new(()),
            editing_queue: tokio::sync::Mutex::new(()),
            track_cache: StdMutex::new(Default::default()),
        });
        match hub
            .session
            .dealer()
            .listen_for("hm://connect-state/v1/cluster", Message::from_raw::<ClusterUpdate>)
        {
            Ok(mut updates) => {
                let weak = Arc::downgrade(&hub);
                tauri::async_runtime::spawn(async move {
                    while updates.next().await.is_some() {
                        let Some(hub) = weak.upgrade() else { break };
                        hub.schedule_refresh();
                    }
                });
            }
            Err(e) => eprintln!("connect: cluster subscription failed: {e}"),
        }
        hub.schedule_refresh();
        let later = hub.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(SETTLE_REREAD).await;
            later.schedule_refresh();
        });
        hub
    }

    /// The last view read, with a playing position moved forward to now.
    pub fn view(&self) -> ConnectView {
        let mut view = self.view.lock().unwrap().clone();
        let elapsed = self.view_read_at.lock().unwrap().elapsed().as_millis() as u64;
        if let Some(p) = view.playback.as_mut().filter(|p| p.is_playing) {
            p.position_ms += elapsed;
            if p.duration_ms > 0 {
                p.position_ms = p.position_ms.min(p.duration_ms);
            }
        }
        view
    }

    /// The context the cluster says `track_uri` plays from, while that is the track playing.
    pub fn context_of(&self, track_uri: &str) -> Option<String> {
        let view = self.view.lock().unwrap();
        view.playback.as_ref().filter(|p| p.track_uri == track_uri).and_then(|p| p.context_uri.clone())
    }

    pub fn now_playing(&self) -> Option<NowPlaying> {
        self.now_playing.lock().unwrap().clone()
    }

    /// Re-reads the cluster soon; a burst of triggers costs one read. A trigger that lands while
    /// a read is in flight schedules one more read, which waits for the first to finish.
    pub fn schedule_refresh(self: &Arc<Self>) {
        if self.refresh_pending.swap(true, Ordering::SeqCst) {
            return;
        }
        let hub = self.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(REFRESH_DEBOUNCE).await;
            let _turn = hub.refreshing.lock().await;
            hub.refresh_pending.store(false, Ordering::SeqCst);
            if let Err(e) = hub.refresh().await {
                eprintln!("connect: cluster read failed: {e}");
            }
        });
    }

    async fn refresh(self: &Arc<Self>) -> Result<(), String> {
        let bytes = self
            .session
            .spclient()
            .request(&Method::GET, "/connect-state/v1/cluster", None, None)
            .await
            .map_err(|e| e.to_string())?;
        let cluster: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        let mut view = parse_cluster(&cluster, self.session.device_id());
        if self.local_stopped.load(Ordering::SeqCst) && view.active_device_id.as_deref() == Some(view.local_device_id.as_str()) {
            if let Some(p) = view.playback.as_mut() {
                p.is_playing = false;
                p.position_ms = 0;
            }
        }
        // This device's volume is its mixer's: the cluster's copy can lag behind a change.
        let local_volume = f64::from(self.mixer.volume()) / f64::from(u16::MAX);
        for d in view.devices.iter_mut().filter(|d| d.is_local) {
            d.volume = local_volume;
        }
        // This device can always take the music, even before the cluster lists it.
        if !view.devices.iter().any(|d| d.is_local) {
            view.devices.insert(0, Device {
                id: view.local_device_id.clone(),
                name: crate::settings::current(&self.app).device_name(),
                kind: "COMPUTER".to_string(),
                volume: local_volume,
                is_active: false,
                is_local: true,
            });
        }

        let track = view.playback.as_ref().map(|p| p.track_uri.clone());
        let changed = {
            let mut current = self.view.lock().unwrap();
            let changed = *current != view;
            *current = view.clone();
            *self.view_read_at.lock().unwrap() = Instant::now();
            changed
        };
        if changed {
            let _ = self.app.emit("connect", &view);
        }
        if let Some(uri) = track {
            self.announce_track(uri);
        }
        self.publish_media();
        Ok(())
    }

    /// Tells Windows (media flyout, media keys, tray) what plays now. Until the playing track's
    /// metadata arrives, it keeps showing the previous one rather than a blank.
    fn publish_media(&self) {
        let view = self.view();
        let showing = match view.playback {
            None => None,
            Some(p) => {
                let np = self.now_playing.lock().unwrap().clone();
                match np {
                    Some(t) if t.uri == p.track_uri => Some(crate::media::Showing {
                        title: t.name,
                        artist: t.artists.iter().map(|a| a.name.as_str()).collect::<Vec<_>>().join(", "),
                        album: t.album.name,
                        cover: t.image,
                        duration_ms: u64::from(t.duration_ms),
                        playing: p.is_playing,
                        position_ms: p.position_ms,
                    }),
                    _ => return,
                }
            }
        };
        crate::media::publish(&self.app, showing);
    }

    /// Where the song playing is, in ms.
    pub fn position_ms(&self) -> u64 {
        self.view().playback.map_or(0, |p| p.position_ms)
    }

    pub async fn toggle(self: &Arc<Self>) -> Result<(), String> {
        if self.view().playback.is_some_and(|p| p.is_playing) {
            self.pause().await
        } else {
            self.resume().await
        }
    }

    /// Fetches a track's metadata and tells the UI it is the one playing now.
    /// Asking again for the track already shown or already on the way does nothing.
    pub fn announce_track(self: &Arc<Self>, uri: String) {
        {
            let mut wanted = self.wanted_track.lock().unwrap();
            if wanted.as_deref() == Some(uri.as_str()) {
                return;
            }
            *wanted = Some(uri.clone());
        }
        let hub = self.clone();
        tauri::async_runtime::spawn(async move {
            let fetched = fetch_item(&hub.session, &uri).await;
            let Some(np) = fetched else {
                // Let a later trigger try this track again.
                let mut wanted = hub.wanted_track.lock().unwrap();
                if wanted.as_deref() == Some(uri.as_str()) {
                    *wanted = None;
                }
                return;
            };
            // Checked and published under one lock, so a newer track cannot be overwritten.
            let wanted = hub.wanted_track.lock().unwrap();
            if wanted.as_deref() != Some(uri.as_str()) {
                return;
            }
            *hub.now_playing.lock().unwrap() = Some(np.clone());
            let _ = hub.app.emit("now-playing", np);
            drop(wanted);
            hub.publish_media();
        });
    }

    fn target(&self) -> Target {
        let view = self.view.lock().unwrap();
        match &view.active_device_id {
            Some(id) if *id != view.local_device_id => Target::Remote(id.clone()),
            _ => Target::Local,
        }
    }

    async fn remote_command(self: &Arc<Self>, to: &str, mut command: Value) -> Result<(), String> {
        command["logging_params"] = json!({ "command_id": random_hex() });
        let body = json!({ "command": command }).to_string();
        let from = self.session.device_id();
        let mut headers = HeaderMap::new();
        headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
        self.session
            .spclient()
            .request(
                &Method::POST,
                &format!("/connect-state/v1/player/command/from/{from}/to/{to}"),
                Some(headers),
                Some(body.as_bytes()),
            )
            .await
            .map_err(|e| e.to_string())?;
        self.schedule_refresh();
        Ok(())
    }

    fn local(&self, r: Result<(), librespot_core::Error>) -> Result<(), String> {
        r.map_err(|e| e.to_string())
    }

    pub async fn pause(self: &Arc<Self>) -> Result<(), String> {
        match self.target() {
            Target::Local => self.local(self.spirc.pause()),
            Target::Remote(to) => self.remote_command(&to, json!({ "endpoint": "pause" })).await,
        }
    }

    /// What this app's player does, from its events: stopped, or loading and playing again.
    pub fn set_local_stopped(&self, stopped: bool) {
        self.local_stopped.store(stopped, Ordering::SeqCst);
    }

    pub async fn resume(self: &Arc<Self>) -> Result<(), String> {
        match self.target() {
            Target::Local if self.local_stopped.load(Ordering::SeqCst) => {
                // The song ended with nothing after it: play it again, in its album or playlist
                // when it had one.
                let Some(p) = self.view().playback else { return Ok(()) };
                match p.context_uri.filter(|c| c.starts_with("spotify:") && !c.starts_with("spotify:web-api")) {
                    Some(context) => self.play_context(context, Some(p.track_uri), None).await,
                    None => self.play_tracks(vec![p.track_uri], 0).await,
                }
            }
            Target::Local => self.local(self.spirc.play()),
            Target::Remote(to) => self.remote_command(&to, json!({ "endpoint": "resume" })).await,
        }
    }

    pub async fn next(self: &Arc<Self>) -> Result<(), String> {
        match self.target() {
            Target::Local => self.local(self.spirc.next()),
            Target::Remote(to) => self.remote_command(&to, json!({ "endpoint": "skip_next" })).await,
        }
    }

    pub async fn previous(self: &Arc<Self>) -> Result<(), String> {
        match self.target() {
            Target::Local => self.local(self.spirc.prev()),
            Target::Remote(to) => self.remote_command(&to, json!({ "endpoint": "skip_prev" })).await,
        }
    }

    pub async fn seek(self: &Arc<Self>, position_ms: u32) -> Result<(), String> {
        match self.target() {
            Target::Local => self.local(self.spirc.set_position_ms(position_ms)),
            Target::Remote(to) => {
                self.remote_command(&to, json!({ "endpoint": "seek_to", "value": position_ms, "position": position_ms }))
                    .await
            }
        }
    }

    pub async fn shuffle(self: &Arc<Self>, on: bool) -> Result<(), String> {
        match self.target() {
            Target::Local => self.local(self.spirc.shuffle(on)),
            Target::Remote(to) => {
                self.remote_command(&to, json!({ "endpoint": "set_shuffling_context", "value": on }))
                    .await
            }
        }
    }

    pub async fn repeat(self: &Arc<Self>, repeat: Repeat) -> Result<(), String> {
        let (context, track) = match repeat {
            Repeat::Off => (false, false),
            Repeat::All => (true, false),
            Repeat::One => (true, true),
        };
        match self.target() {
            Target::Local => {
                self.local(self.spirc.repeat(context))?;
                self.local(self.spirc.repeat_track(track))
            }
            Target::Remote(to) => {
                self.remote_command(&to, json!({ "endpoint": "set_repeating_context", "value": context }))
                    .await?;
                self.remote_command(&to, json!({ "endpoint": "set_repeating_track", "value": track }))
                    .await
            }
        }
    }

    /// `volume` goes from 0 to 1, for whichever device is playing.
    pub async fn set_volume(self: &Arc<Self>, volume: f64) -> Result<(), String> {
        let v = (volume.clamp(0.0, 1.0) * f64::from(u16::MAX)).round() as u16;
        match self.target() {
            Target::Local => {
                if let Some(cache) = self.session.cache() {
                    cache.save_volume(v);
                }
                self.local(self.spirc.set_volume(v))?;
                self.schedule_refresh();
                Ok(())
            }
            Target::Remote(to) => {
                let from = self.session.device_id();
                let mut headers = HeaderMap::new();
                headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
                self.session
                    .spclient()
                    .request(
                        &Method::PUT,
                        &format!("/connect-state/v1/connect/volume/from/{from}/to/{to}"),
                        Some(headers),
                        Some(json!({ "volume": v }).to_string().as_bytes()),
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                self.schedule_refresh();
                Ok(())
            }
        }
    }

    /// Plays a playlist, album, artist or Liked Songs from `track_uri`, on the active device
    /// (this one when nothing is playing anywhere).
    /// Plays a context, from `track_uri` when given and `position_ms` into it (Continue picks up
    /// where the user left).
    pub async fn play_context(
        self: &Arc<Self>,
        context_uri: String,
        track_uri: Option<String>,
        position_ms: Option<u32>,
    ) -> Result<(), String> {
        let context_uri = self.resolvable(&context_uri);
        match self.target() {
            Target::Local => {
                self.local(self.spirc.activate())?;
                self.local(self.spirc.load(LoadRequest::from_context_uri(
                    context_uri,
                    LoadRequestOptions {
                        start_playing: true,
                        seek_to: position_ms.unwrap_or(0),
                        playing_track: track_uri.map(PlayingTrack::Uri),
                        ..Default::default()
                    },
                )))
            }
            Target::Remote(to) => {
                let mut options = json!({});
                if let Some(t) = track_uri {
                    options["skip_to"] = json!({ "track_uri": t });
                }
                if let Some(ms) = position_ms {
                    options["seek_to"] = json!(ms);
                }
                self.remote_command(
                    &to,
                    json!({
                        "endpoint": "play",
                        "context": { "uri": context_uri, "url": format!("context://{context_uri}") },
                        "play_origin": { "feature_identifier": "quackify" },
                        "options": options,
                    }),
                )
                .await
            }
        }
    }

    /// Plays a loose list of tracks (search results) from `index`.
    pub async fn play_tracks(self: &Arc<Self>, uris: Vec<String>, index: usize) -> Result<(), String> {
        match self.target() {
            Target::Local => {
                self.local(self.spirc.activate())?;
                self.local(self.spirc.load(LoadRequest::from_tracks(
                    uris,
                    LoadRequestOptions {
                        start_playing: true,
                        playing_track: Some(PlayingTrack::Index(index as u32)),
                        ..Default::default()
                    },
                )))
            }
            Target::Remote(to) => {
                let tracks: Vec<Value> = uris.iter().map(|u| json!({ "uri": u })).collect();
                let first = uris.get(index).cloned().unwrap_or_default();
                self.remote_command(
                    &to,
                    json!({
                        "endpoint": "play",
                        "context": { "uri": first, "pages": [{ "tracks": tracks }] },
                        "play_origin": { "feature_identifier": "quackify" },
                        "options": { "skip_to": { "track_index": index, "track_uri": first } },
                    }),
                )
                .await
            }
        }
    }

    /// Adds a track to the queue of whatever device is playing.
    pub async fn add_to_queue(self: &Arc<Self>, uri: String) -> Result<(), String> {
        let to = {
            let v = self.view.lock().unwrap();
            v.active_device_id.clone().ok_or("Nothing is playing right now")?
        };
        self.remote_command(
            &to,
            json!({
                "endpoint": "add_to_queue",
                "track": { "uri": uri, "metadata": { "is_queued": "true" }, "provider": "queue" },
            }),
        )
        .await
    }

    /// Changes what plays next on the device playing: the cluster is read fresh, edited and sent
    /// back whole, as Spotify's own apps do.
    pub async fn edit_queue(self: &Arc<Self>, edit: QueueEdit) -> Result<(), String> {
        // Each edit reads the queue, changes it and sends it whole: two at once would undo each
        // other, so they run in turn, and the next one waits for Spotify to show this one.
        let _turn = self.editing_queue.lock().await;
        let to = {
            let v = self.view.lock().unwrap();
            v.active_device_id.clone().ok_or("Nothing is playing right now")?
        };
        let cluster = self.read_cluster().await?;
        let ps = &cluster["player_state"];
        let next = ps["next_tracks"].as_array().cloned().unwrap_or_default();
        let edited = edit_next_tracks(&next, &edit);
        self.remote_command(
            &to,
            json!({
                "endpoint": "set_queue",
                "next_tracks": edited,
                "prev_tracks": ps["prev_tracks"].as_array().cloned().unwrap_or_default(),
                "queue_revision": ps["queue_revision"].as_str().unwrap_or_default(),
            }),
        )
        .await?;
        // Done when Spotify's queue starts the way the one sent does.
        let wanted = queue_head(&edited);
        for _ in 0..QUEUE_SETTLE_TRIES {
            tokio::time::sleep(QUEUE_SETTLE_STEP).await;
            if let Ok(c) = self.read_cluster().await {
                let now = c["player_state"]["next_tracks"].as_array().cloned().unwrap_or_default();
                if queue_head(&now) == wanted {
                    break;
                }
            }
        }
        Ok(())
    }

    async fn read_cluster(&self) -> Result<Value, String> {
        let bytes = self
            .session
            .spclient()
            .request(&Method::GET, "/connect-state/v1/cluster", None, None)
            .await
            .map_err(|e| e.to_string())?;
        serde_json::from_slice(&bytes).map_err(|e| e.to_string())
    }

    /// Jumps to a track further down the queue, dropping the ones before it.
    pub async fn skip_to(self: &Arc<Self>, uri: String, uid: String) -> Result<(), String> {
        let to = {
            let v = self.view.lock().unwrap();
            v.active_device_id.clone().ok_or("Nothing is playing right now")?
        };
        self.remote_command(&to, json!({ "endpoint": "skip_next", "track": { "uri": uri, "uid": uid } }))
            .await
    }

    /// Name, artists, album and cover for each URI, in order; unknown ones are left out.
    pub async fn tracks(self: &Arc<Self>, uris: Vec<String>) -> Vec<NowPlaying> {
        let missing: Vec<String> = {
            let cache = self.track_cache.lock().unwrap();
            uris.iter().filter(|u| !cache.contains_key(*u)).cloned().collect()
        };
        let fetched = futures_util::future::join_all(missing.into_iter().map(|uri| {
            let session = self.session.clone();
            async move {
                fetch_item(&session, &uri).await
            }
        }))
        .await;
        let mut cache = self.track_cache.lock().unwrap();
        for np in fetched.into_iter().flatten() {
            cache.insert(np.uri.clone(), np);
        }
        uris.iter().filter_map(|u| cache.get(u).cloned()).collect()
    }

    /// Moves playback to `device_id`: this device pulls it, another device gets it pushed.
    pub async fn transfer(self: &Arc<Self>, device_id: String) -> Result<(), String> {
        let (local, active) = {
            let v = self.view.lock().unwrap();
            (v.local_device_id.clone(), v.active_device_id.clone())
        };
        if Some(&device_id) == active.as_ref() {
            return Ok(());
        }
        if device_id == local {
            self.local(self.spirc.transfer(None))?;
        } else {
            let from = active.unwrap_or_else(|| local.clone());
            self.session
                .spclient()
                .transfer(&from, &device_id, None)
                .await
                .map_err(|e| e.to_string())?;
        }
        self.schedule_refresh();
        Ok(())
    }

    /// Whether this device holds the account's playback: `Some(playing)` if so.
    pub fn active_here(&self) -> Option<bool> {
        let v = self.view.lock().unwrap();
        (v.active_device_id.as_deref() == Some(v.local_device_id.as_str()))
            .then(|| v.playback.as_ref().is_some_and(|p| p.is_playing))
    }

    /// The library's Liked Songs entry is the user's collection context.
    fn resolvable(&self, uri: &str) -> String {
        if uri.starts_with("spotify:collection") {
            format!("spotify:user:{}:collection", self.session.username())
        } else {
            uri.to_string()
        }
    }
}

fn random_hex() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    format!("{nanos:032x}")
}

fn num(v: &Value) -> u64 {
    // The cluster sends 64-bit numbers as strings.
    v.as_u64()
        .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
        .unwrap_or(0)
}

/// Songs and episodes of a cluster track list (delimiters and the like left out), at most
/// QUEUE_LIMIT.
fn queued<'a>(list: impl Iterator<Item = &'a Value>) -> Vec<QueuedTrack> {
    list.filter_map(|t| {
        let uri = t["uri"].as_str()?;
        (uri.starts_with("spotify:track:") || uri.starts_with("spotify:episode:")).then(|| QueuedTrack {
            uri: uri.to_string(),
            uid: t["uid"].as_str().unwrap_or_default().to_string(),
            provider: t["provider"].as_str().unwrap_or("context").to_string(),
        })
    })
    .take(QUEUE_LIMIT)
    .collect()
}

/// The first tracks of a queue, by uri and provider, to tell whether an edit has landed.
fn queue_head(list: &[Value]) -> Vec<(String, String)> {
    list.iter()
        .filter(|t| t["uri"].as_str().is_some_and(|u| u.starts_with("spotify:track:") || u.starts_with("spotify:episode:")))
        .take(10)
        .map(|t| (t["uri"].as_str().unwrap_or_default().to_string(), t["provider"].as_str().unwrap_or_default().to_string()))
        .collect()
}

/// A track of the queue as the panel saw it. librespot gives queued songs new uids on every
/// change, so a uid seen a moment ago may be gone: then the song is found by its URI.
#[derive(serde::Deserialize, Debug, Clone, PartialEq)]
pub struct QueueRef {
    pub uid: String,
    pub uri: String,
}

/// A change to what plays next.
#[derive(serde::Deserialize, Debug, Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum QueueEdit {
    /// Takes these tracks out.
    Remove { tracks: Vec<QueueRef> },
    /// Moves these tracks to just before `before`, or to the end of the songs you added.
    Move { tracks: Vec<QueueRef>, before: Option<QueueRef> },
    /// Takes out every song you added, leaving the rest of the context.
    Clear,
}

/// Where each ref is in `list`: by uid, else the first not yet taken copy of its URI (the songs
/// you added first). Refs not found are left out.
fn find_refs(list: &[Value], refs: &[QueueRef]) -> Vec<usize> {
    let uid = |t: &Value| t["uid"].as_str().unwrap_or_default().to_string();
    let uri = |t: &Value| t["uri"].as_str().unwrap_or_default().to_string();
    let mut taken: Vec<usize> = vec![];
    for r in refs {
        let by_uid = (!r.uid.is_empty())
            .then(|| list.iter().position(|t| uid(t) == r.uid))
            .flatten()
            .filter(|i| !taken.contains(i));
        let by_uri = || {
            let free = |i: &usize| !taken.contains(i) && uri(&list[*i]) == r.uri;
            // A song you added before one from the rest of the list.
            (0..list.len())
                .filter(free)
                .find(|i| list[*i]["provider"].as_str() == Some("queue"))
                .or_else(|| (0..list.len()).find(free))
        };
        if let Some(i) = by_uid.or_else(by_uri) {
            taken.push(i);
        }
    }
    taken
}

/// The next tracks after `edit`, from the cluster's own list (so tracks keep every field
/// Spotify gave them, and the ones not shown are kept too).
pub fn edit_next_tracks(next: &[Value], edit: &QueueEdit) -> Vec<Value> {
    let added = |t: &Value| t["provider"].as_str() == Some("queue");
    match edit {
        QueueEdit::Remove { tracks } => {
            let gone = find_refs(next, tracks);
            next.iter().enumerate().filter(|(i, _)| !gone.contains(i)).map(|(_, t)| t.clone()).collect()
        }
        QueueEdit::Clear => next.iter().filter(|t| !added(t)).cloned().collect(),
        QueueEdit::Move { tracks, before } => {
            let picked = find_refs(next, tracks);
            let mut moving: Vec<Value> = picked.iter().map(|i| next[*i].clone()).collect();
            let mut rest: Vec<Value> = next.iter().enumerate().filter(|(i, _)| !picked.contains(i)).map(|(_, t)| t.clone()).collect();
            let at = match before {
                Some(b) => find_refs(&rest, std::slice::from_ref(b)).first().copied().unwrap_or(rest.len()),
                // The end of the songs you added: right after the last one.
                None => rest.iter().rposition(added).map_or(0, |i| i + 1),
            };
            // Dropped among the songs you added (or at their end), a song becomes one of them:
            // it stays there and goes with Clear queue. Dropped further down, among the rest of
            // the list, it becomes part of that and plays in that place.
            let into_added = before.is_none() || rest.get(at).is_some_and(added) || (at > 0 && added(&rest[at - 1]));
            for t in &mut moving {
                if into_added {
                    t["provider"] = Value::from("queue");
                    t["metadata"]["is_queued"] = Value::from("true");
                } else if added(t) {
                    t["provider"] = Value::from("context");
                    if let Some(m) = t["metadata"].as_object_mut() {
                        m.remove("is_queued");
                    }
                }
            }
            rest.splice(at..at, moving);
            rest
        }
    }
}

pub fn parse_cluster(c: &Value, local_device_id: &str) -> ConnectView {
    let active = c["active_device_id"].as_str().filter(|s| !s.is_empty()).map(str::to_string);
    let mut devices: Vec<Device> = c["devices"]
        .as_object()
        .map(|m| {
            m.iter()
                .filter(|(_, d)| d["can_play"].as_bool().unwrap_or(true))
                .map(|(id, d)| Device {
                    id: id.clone(),
                    name: d["name"].as_str().unwrap_or("Unknown device").to_string(),
                    kind: d["device_type"].as_str().unwrap_or("UNKNOWN").to_string(),
                    volume: num(&d["volume"]) as f64 / f64::from(u16::MAX),
                    is_active: Some(id) == active.as_ref(),
                    is_local: id == local_device_id,
                })
                .collect()
        })
        .unwrap_or_default();
    // This device first, then the active one, then by name.
    devices.sort_by(|a, b| {
        b.is_local
            .cmp(&a.is_local)
            .then(b.is_active.cmp(&a.is_active))
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    let ps = &c["player_state"];
    let track_uri = ps["track"]["uri"].as_str().unwrap_or_default();
    let playback = (active.is_some() && !track_uri.is_empty()).then(|| {
        let is_playing = ps["is_playing"].as_bool().unwrap_or(false) && !ps["is_paused"].as_bool().unwrap_or(false);
        let duration_ms = num(&ps["duration"]);
        let mut position_ms = num(&ps["position_as_of_timestamp"]);
        if is_playing {
            let at = num(&ps["timestamp"]);
            let server_now = num(&c["server_timestamp_ms"]);
            if at > 0 && server_now > at {
                position_ms += server_now - at;
            }
        }
        if duration_ms > 0 {
            position_ms = position_ms.min(duration_ms);
        }
        let o = &ps["options"];
        let repeat = if o["repeating_track"].as_bool().unwrap_or(false) {
            Repeat::One
        } else if o["repeating_context"].as_bool().unwrap_or(false) {
            Repeat::All
        } else {
            Repeat::Off
        };
        Playback {
            track_uri: track_uri.to_string(),
            context_uri: ps["context_uri"].as_str().filter(|s| !s.is_empty()).map(str::to_string),
            index: ps["index"]["track"].as_u64().map(|i| i as u32),
            is_playing,
            position_ms,
            duration_ms,
            shuffle: o["shuffling_context"].as_bool().unwrap_or(false),
            repeat,
            next_tracks: queued(ps["next_tracks"].as_array().into_iter().flatten()),
            prev_tracks: queued(ps["prev_tracks"].as_array().into_iter().flatten().rev()),
        }
    });

    ConnectView {
        local_device_id: local_device_id.to_string(),
        active_device_id: active,
        devices,
        playback,
    }
}

/// What plays, for the player bar: a song, or a podcast episode (its show stands in for the
/// album and the artist).
async fn fetch_item(session: &Session, uri: &str) -> Option<NowPlaying> {
    let id = SpotifyUri::from_uri(uri).ok()?;
    match id {
        SpotifyUri::Episode { .. } => Some(episode_playing(&Episode::get(session, &id).await.ok()?, uri.to_string())),
        _ => Some(now_playing(&Track::get(session, &id).await.ok()?, uri.to_string())),
    }
}

fn largest_cover(covers: &librespot_metadata::image::Images) -> Option<String> {
    covers
        .iter()
        .max_by_key(|i| i.width)
        .and_then(|i| i.id.to_base16().ok())
        .map(|hex| format!("https://i.scdn.co/image/{hex}"))
}

fn episode_playing(e: &Episode, uri: String) -> NowPlaying {
    // The episode's metadata names its show but not the show's URI; the pages look it up.
    let show = Named { uri: String::new(), name: e.show_name.clone() };
    NowPlaying {
        uri,
        name: e.name.clone(),
        artists: vec![show.clone()],
        album: show,
        image: largest_cover(&e.covers),
        duration_ms: e.duration.max(0) as u32,
    }
}

fn now_playing(t: &Track, uri: String) -> NowPlaying {
    let image = largest_cover(&t.album.covers);
    NowPlaying {
        uri,
        name: t.name.clone(),
        artists: t
            .artists
            .iter()
            .map(|a| Named { uri: a.id.to_string(), name: a.name.clone() })
            .collect(),
        album: Named { uri: t.album.id.to_string(), name: t.album.name.clone() },
        image,
        duration_ms: t.duration.max(0) as u32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Value {
        json!({
            "active_device_id": "pc",
            "server_timestamp_ms": "10000",
            "devices": {
                "pc": { "name": "PC-ENDEREX", "device_type": "COMPUTER", "can_play": true, "volume": 65535 },
                "me": { "name": "Quackify", "device_type": "COMPUTER", "can_play": true, "volume": 32768 },
                "tv": { "name": "Todo lugar", "device_type": "SPEAKER", "can_play": true, "volume": 0 },
                "ghost": { "name": "Cannot play", "device_type": "SPEAKER", "can_play": false }
            },
            "player_state": {
                "timestamp": "8000",
                "position_as_of_timestamp": "1000",
                "duration": "237262",
                "is_playing": true,
                "is_paused": false,
                "track": { "uri": "spotify:track:141ldaB3OVfIcklQmUj12O" },
                "context_uri": "spotify:playlist:37i9dQZF1F5p3rmiWPIYgZ",
                "index": { "page": 0, "track": 7 },
                "options": { "shuffling_context": true, "repeating_context": true, "repeating_track": false },
                "next_tracks": [
                    { "uri": "spotify:track:queued", "provider": "queue" },
                    { "uri": "spotify:delimiter", "provider": "context" },
                    { "uri": "spotify:track:next", "provider": "context" }
                ]
            }
        })
    }

    fn t(uid: &str, provider: &str) -> Value {
        json!({ "uri": format!("spotify:track:{uid}"), "uid": uid, "provider": provider })
    }
    fn uids(list: &[Value]) -> Vec<&str> {
        list.iter().map(|t| t["uid"].as_str().unwrap()).collect()
    }
    fn r(uid: &str) -> QueueRef {
        QueueRef { uid: uid.into(), uri: format!("spotify:track:{uid}") }
    }
    fn rs(list: &[&str]) -> Vec<QueueRef> {
        list.iter().map(|u| r(u)).collect()
    }

    #[test]
    fn queue_edits() {
        let next = vec![t("q1", "queue"), t("q2", "queue"), t("c1", "context"), t("c2", "context")];
        let rm = edit_next_tracks(&next, &QueueEdit::Remove { tracks: rs(&["q2"]) });
        assert_eq!(uids(&rm), ["q1", "c1", "c2"]);
        let clear = edit_next_tracks(&next, &QueueEdit::Clear);
        assert_eq!(uids(&clear), ["c1", "c2"]);
        let up = edit_next_tracks(&next, &QueueEdit::Move { tracks: rs(&["q2"]), before: Some(r("q1")) });
        assert_eq!(uids(&up), ["q2", "q1", "c1", "c2"]);
        // A context song moved into the queue goes after the added ones, as one of them.
        let into = edit_next_tracks(&next, &QueueEdit::Move { tracks: rs(&["c2"]), before: None });
        assert_eq!(uids(&into), ["q1", "q2", "c2", "c1"]);
        assert_eq!(into[2]["provider"], "queue");
        assert_eq!(uids(&edit_next_tracks(&into, &QueueEdit::Clear)), ["c1"]);
        // A track without a uid is never removed by a remove meant for another.
        let mut odd = next.clone();
        odd.push(json!({ "uri": "spotify:track:x", "provider": "context" }));
        odd.push(json!({ "uri": "spotify:track:y", "uid": "", "provider": "context" }));
        // A uid that is gone (librespot renumbers queued songs) falls back to the song itself.
        let stale = QueueRef { uid: "q99".into(), uri: "spotify:track:q2".into() };
        assert_eq!(uids(&edit_next_tracks(&next, &QueueEdit::Remove { tracks: vec![stale] })), ["q1", "c1", "c2"]);
        // Nothing matching removes nothing.
        let none = QueueRef { uid: "".into(), uri: "spotify:track:zz".into() };
        assert_eq!(edit_next_tracks(&odd, &QueueEdit::Remove { tracks: vec![none] }).len(), 6);
        let down = edit_next_tracks(&next, &QueueEdit::Move { tracks: rs(&["q1"]), before: Some(r("c2")) });
        assert_eq!(uids(&down), ["q2", "c1", "q1", "c2"]);
        // An added song moved down among the rest becomes part of it, where it was put.
        assert_eq!(down[2]["provider"], "context");
        assert_eq!(uids(&edit_next_tracks(&down, &QueueEdit::Clear)), ["c1", "q1", "c2"]);
        // Fields Spotify sent come back untouched.
        assert_eq!(rm[0], next[0]);
    }

    #[test]
    fn reads_devices_and_the_remote_playback() {
        let v = parse_cluster(&sample(), "me");
        let names: Vec<&str> = v.devices.iter().map(|d| d.name.as_str()).collect();
        assert_eq!(names, ["Quackify", "PC-ENDEREX", "Todo lugar"], "this device, the active one, then by name; unplayable dropped");
        assert!(v.devices[0].is_local && !v.devices[0].is_active);
        assert!(v.devices[1].is_active);
        assert!((v.devices[0].volume - 0.5).abs() < 0.001);
        let p = v.playback.unwrap();
        assert_eq!(p.position_ms, 3000, "1000 at t=8000, read at t=10000 while playing");
        assert_eq!(p.index, Some(7));
        assert!(p.shuffle);
        assert_eq!(p.repeat, Repeat::All);
        let queue: Vec<(&str, &str)> = p.next_tracks.iter().map(|t| (t.uri.as_str(), t.provider.as_str())).collect();
        assert_eq!(queue, [("spotify:track:queued", "queue"), ("spotify:track:next", "context")], "delimiters are not tracks");
    }

    #[test]
    fn a_paused_track_does_not_move_and_no_active_device_means_no_playback() {
        let mut c = sample();
        c["player_state"]["is_paused"] = json!(true);
        assert_eq!(parse_cluster(&c, "me").playback.unwrap().position_ms, 1000);
        c["active_device_id"] = json!("");
        assert!(parse_cluster(&c, "me").playback.is_none());
    }

    #[test]
    fn repeat_track_wins_over_repeat_context() {
        let mut c = sample();
        c["player_state"]["options"]["repeating_track"] = json!(true);
        assert_eq!(parse_cluster(&c, "me").playback.unwrap().repeat, Repeat::One);
    }
}
