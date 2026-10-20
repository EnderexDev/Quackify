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
use librespot_metadata::{Metadata, Track};
use librespot_protocol::connect::ClusterUpdate;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

const REFRESH_DEBOUNCE: Duration = Duration::from_millis(250);
// The device registers itself shortly after start, and the server does not tell the device
// about its own registration: read the cluster again after this long.
const SETTLE_REREAD: Duration = Duration::from_secs(3);
/// How this device shows up in the other Spotify apps.
pub const DEVICE_NAME: &str = "Quackify";

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
    // One cluster read at a time, in order, so an older answer never overwrites a newer one.
    refreshing: tokio::sync::Mutex<()>,
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
            refreshing: tokio::sync::Mutex::new(()),
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
        // This device's volume is its mixer's: the cluster's copy can lag behind a change.
        let local_volume = f64::from(self.mixer.volume()) / f64::from(u16::MAX);
        for d in view.devices.iter_mut().filter(|d| d.is_local) {
            d.volume = local_volume;
        }
        // This device can always take the music, even before the cluster lists it.
        if !view.devices.iter().any(|d| d.is_local) {
            view.devices.insert(0, Device {
                id: view.local_device_id.clone(),
                name: DEVICE_NAME.to_string(),
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
            let fetched = match SpotifyUri::from_uri(&uri) {
                Ok(id) => Track::get(&hub.session, &id).await.ok(),
                Err(_) => None,
            };
            let Some(t) = fetched else {
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
            let np = now_playing(&t, uri);
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

    pub async fn resume(self: &Arc<Self>) -> Result<(), String> {
        match self.target() {
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
    pub async fn play_context(self: &Arc<Self>, context_uri: String, track_uri: Option<String>) -> Result<(), String> {
        let context_uri = self.resolvable(&context_uri);
        match self.target() {
            Target::Local => {
                self.local(self.spirc.activate())?;
                self.local(self.spirc.load(LoadRequest::from_context_uri(
                    context_uri,
                    LoadRequestOptions {
                        start_playing: true,
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
                let id = SpotifyUri::from_uri(&uri).ok()?;
                let t = Track::get(&session, &id).await.ok()?;
                Some(now_playing(&t, uri))
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
            next_tracks: ps["next_tracks"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|t| {
                            let uri = t["uri"].as_str()?;
                            (uri.starts_with("spotify:track:") || uri.starts_with("spotify:episode:")).then(|| QueuedTrack {
                                uri: uri.to_string(),
                                uid: t["uid"].as_str().unwrap_or_default().to_string(),
                                provider: t["provider"].as_str().unwrap_or("context").to_string(),
                            })
                        })
                        .take(QUEUE_LIMIT)
                        .collect()
                })
                .unwrap_or_default(),
        }
    });

    ConnectView {
        local_device_id: local_device_id.to_string(),
        active_device_id: active,
        devices,
        playback,
    }
}

fn now_playing(t: &Track, uri: String) -> NowPlaying {
    let image = t
        .album
        .covers
        .iter()
        .max_by_key(|i| i.width)
        .and_then(|i| i.id.to_base16().ok())
        .map(|hex| format!("https://i.scdn.co/image/{hex}"));
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
