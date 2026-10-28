// Listening history: what plays here goes to the account's history, the way Spotify's own apps
// report it. librespot sends nothing, so without this Spotify never hears of a song played in
// Quackify (measured 23/10/26: 7 minutes played, nothing in recently played; with the report,
// the album was on top two minutes later). Off unless the Settings switch is on: Spotify does not
// say whether unofficial apps may.
//
// One report per song played, with the time it really played: pauses do not count and a seek
// adds nothing. The format follows librespot PR #1759 (RawCoreStream, from desktop 1.2.96.518).
use std::io::Write;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

use librespot_core::{FileId, Session, SpotifyUri};
use librespot_metadata::audio::{AudioFileFormat, AudioFiles, AudioItem};
use librespot_playback::config::Bitrate;
use librespot_playback::player::PlayerEvent;
use librespot_protocol::extension_kind::ExtensionKind;
use protobuf::{CodedInputStream, CodedOutputStream};
use sha1::{Digest, Sha1};
use tauri::AppHandle;

use crate::connect::Hub;

// The desktop version the event format was taken from. Spotify takes other values without an
// error, but may drop the listen from the history later.
const VERSION: &str = "1.2.96.518";
const VERSION_CODE: i64 = 129600518;
const CORE_VERSION: i64 = 6005400000002005;
const SDK: &str = "0.9.4-rl-essopt-loginsend-onlinesend-bcdsend-heartbeat300.0s/30.0s-modern-payload125kB-batch100";
const ENDPOINT: &str = "/gabo-receiver-service/v3/events/";
/// Tries for one report, with the same bytes each time, so a retry is never a second listen.
const ATTEMPTS: u32 = 3;
/// How long quitting or reconnecting waits for the song playing to be reported.
const FLUSH_WAIT: Duration = Duration::from_secs(3);
/// Listens waiting to be sent; past this, Spotify has not answered for a long while.
const QUEUE: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum EndReason {
    /// The song played to its end.
    TrackDone,
    /// Skipped, stopped, or another song started.
    EndPlay,
}

impl EndReason {
    fn name(self) -> &'static str {
        match self {
            EndReason::TrackDone => "trackdone",
            EndReason::EndPlay => "endplay",
        }
    }
}

/// One song played, ready to report.
#[derive(Clone, Debug, PartialEq)]
pub struct Report {
    pub uri: String,
    pub file_id: [u8; 20],
    pub audio_format: &'static str,
    pub context: String,
    pub started_at_ms: i64,
    pub ended_at_ms: i64,
    pub played_ms: i64,
    pub reason: EndReason,
}

/// The file librespot's player picks for `bitrate`, in its own order (player.rs, load_track).
fn pick_file(files: &AudioFiles, bitrate: Bitrate) -> Option<(AudioFileFormat, FileId)> {
    use AudioFileFormat::*;
    let order = match bitrate {
        Bitrate::Bitrate96 => [OGG_VORBIS_96, MP3_96, OGG_VORBIS_160, MP3_160, MP3_256, OGG_VORBIS_320, MP3_320],
        Bitrate::Bitrate160 => [OGG_VORBIS_160, MP3_160, OGG_VORBIS_96, MP3_96, MP3_256, OGG_VORBIS_320, MP3_320],
        Bitrate::Bitrate320 => [OGG_VORBIS_320, MP3_320, MP3_256, OGG_VORBIS_160, MP3_160, OGG_VORBIS_96, MP3_96],
    };
    order.iter().find_map(|f| files.get(f).map(|id| (*f, *id)))
}

fn format_name(format: AudioFileFormat) -> Option<&'static str> {
    use AudioFileFormat::*;
    Some(match format {
        OGG_VORBIS_96 => "Vorbis 96 kbps",
        OGG_VORBIS_160 => "Vorbis 160 kbps",
        OGG_VORBIS_320 => "Vorbis 320 kbps",
        MP3_96 => "MP3 96 kbps",
        MP3_160 => "MP3 160 kbps",
        MP3_256 => "MP3 256 kbps",
        MP3_320 => "MP3 320 kbps",
        _ => return None,
    })
}

fn millis(t: SystemTime) -> i64 {
    t.duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// The song in the player now and how long it has really played.
#[derive(Debug)]
struct Play {
    uri: String,
    file_id: Option<[u8; 20]>,
    audio_format: Option<&'static str>,
    duration_ms: u32,
    context: Option<String>,
    /// When it first played; a song loaded and never played is not reported.
    started_at: Option<SystemTime>,
    /// Since when it has been playing, while it plays.
    playing_since: Option<Instant>,
    played: Duration,
}

impl Play {
    fn pause(&mut self, now: Instant) {
        if let Some(since) = self.playing_since.take() {
            self.played += now.saturating_duration_since(since);
        }
    }
}

/// Follows the player's events and turns each song played into one report. No clock of its own:
/// every call says when it happened, so the tests can drive it.
#[derive(Default, Debug)]
pub struct Tracker {
    play: Option<Play>,
}

impl Tracker {
    /// A new song is in the player; the one before, if any, is done.
    pub fn track_changed(
        &mut self,
        uri: &str,
        duration_ms: u32,
        file: Option<(AudioFileFormat, FileId)>,
        now: Instant,
        wall: SystemTime,
    ) -> Option<Report> {
        let done = self.finish(EndReason::EndPlay, now, wall);
        let format = file.and_then(|(f, _)| format_name(f));
        self.play = Some(Play {
            uri: uri.to_string(),
            file_id: file.filter(|_| format.is_some()).map(|(_, id)| id.0),
            audio_format: format,
            duration_ms,
            context: None,
            started_at: None,
            playing_since: None,
            played: Duration::ZERO,
        });
        done
    }

    fn current(&mut self, uri: &str) -> Option<&mut Play> {
        self.play.as_mut().filter(|p| p.uri == uri)
    }

    pub fn playing(&mut self, uri: &str, now: Instant, wall: SystemTime) {
        if let Some(p) = self.current(uri) {
            p.started_at.get_or_insert(wall);
            p.playing_since.get_or_insert(now);
        }
    }

    pub fn paused(&mut self, uri: &str, now: Instant) {
        if let Some(p) = self.current(uri) {
            p.pause(now);
        }
    }

    /// Where the song plays from, when the cluster says so.
    pub fn set_context(&mut self, uri: &str, context: String) {
        if let Some(p) = self.current(uri) {
            p.context = Some(context);
        }
    }

    pub fn uri(&self) -> Option<&str> {
        self.play.as_ref().map(|p| p.uri.as_str())
    }

    /// The song reached its end.
    pub fn ended(&mut self, uri: &str, now: Instant, wall: SystemTime) -> Option<Report> {
        self.current(uri)?;
        self.finish(EndReason::TrackDone, now, wall)
    }

    /// The song cannot play: nothing to report.
    pub fn unavailable(&mut self, uri: &str) {
        if self.current(uri).is_some() {
            self.play = None;
        }
    }

    /// Ends the song in the player, if any: its report, if it played at all.
    pub fn finish(&mut self, reason: EndReason, now: Instant, wall: SystemTime) -> Option<Report> {
        let mut p = self.play.take()?;
        p.pause(now);
        let mut played = p.played.as_millis() as i64;
        if p.duration_ms > 0 {
            played = played.min(i64::from(p.duration_ms));
        }
        let (Some(started_at), Some(file_id), Some(audio_format)) = (p.started_at, p.file_id, p.audio_format) else {
            return None;
        };
        if played <= 0 {
            return None;
        }
        Some(Report {
            context: p.context.unwrap_or_else(|| p.uri.clone()),
            uri: p.uri,
            file_id,
            audio_format,
            started_at_ms: millis(started_at),
            ended_at_ms: millis(wall),
            played_ms: played,
            reason,
        })
    }
}

/// Who sends the reports: one per session, its numbers kept across the reports it sends.
struct Identity {
    session_id: Vec<u8>,
    sequence_id: Vec<u8>,
    sequence: i64,
    clock: Instant,
}

fn uuid() -> Vec<u8> {
    uuid::Uuid::new_v4().as_bytes().to_vec()
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn unhex(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(s.get(i..i + 2)?, 16).ok()).collect()
}

/// A message built field by field (the event's messages are not in librespot-protocol).
fn message(build: impl FnOnce(&mut CodedOutputStream) -> protobuf::Result<()>) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    {
        let mut os = CodedOutputStream::vec(&mut out);
        build(&mut os).map_err(|e| e.to_string())?;
        os.flush().map_err(|e| e.to_string())?;
    }
    Ok(out)
}

/// The RawCoreStream message for `r`.
fn stream_message(r: &Report, audio_id: &[u8], player_session: &str) -> Result<Vec<u8>, String> {
    message(|os| {
        os.write_bytes(1, &uuid())?; // playback_id
        os.write_bytes(2, &[0; 16])?; // parent_playback_id
        os.write_string(3, "")?; // video_session_id
        os.write_bytes(4, &r.file_id)?; // media_id
        os.write_string(5, "audio")?; // media_type
        os.write_string(9, "librespot")?; // source_start
        os.write_string(10, "playbtn")?; // reason_start
        os.write_string(11, "librespot")?; // source_end
        os.write_string(12, r.reason.name())?; // reason_end
        os.write_int64(13, r.started_at_ms)?; // playback_start_time
        let played = r.played_ms.min(i64::from(i32::MAX)) as i32;
        os.write_int32(14, played)?; // ms_played
        os.write_int32(15, played)?; // ms_played_nominal
        // ms_played_overlapping, _video, _fullscreen, _external, ms_narration_overlapping,
        // ms_trimmed, ms_nominal_trimmed, ms_played_nominal_overlapping
        for field in [16, 17, 19, 40, 46, 50, 51, 67] {
            os.write_int32(field, 0)?;
        }
        os.write_bool(20, false)?; // live
        os.write_string(22, r.audio_format)?;
        os.write_string(23, &r.context)?; // play_context
        os.write_string(24, &r.uri)?; // content_uri
        os.write_string(25, "")?; // displayed_content_uri
        os.write_bool(26, false)?; // content_is_downloaded
        os.write_bool(27, false)?; // incognito_mode
        os.write_string(28, "context")?; // provider
        os.write_string(29, "unknown")?; // referrer
        os.write_string(32, "none")?; // streaming_rule
        os.write_int64(37, CORE_VERSION)?;
        os.write_string(38, "full")?; // core_bundle
        os.write_bool(39, true)?; // is_assumed_premium
        os.write_bool(42, false)?; // client_offline_at_stream_start
        os.write_bool(43, false)?; // social_listening
        os.write_string(44, "local")?; // connect_controller_device_id_v2
        os.write_string(45, "boombox")?; // playback_stack
        os.write_bytes(53, &uuid())?; // stream_id
        os.write_int64(56, r.ended_at_ms)?; // end_timestamp
        os.write_string(59, player_session)?; // player_session_id
        os.write_bytes(63, hex(audio_id).as_bytes())?; // audio_id
        os.write_string(69, "boombox")?; // playback_stacks
        os.write_string(71, "context-player")?; // orchestration_stack
        os.write_string(78, "librespot")?; // controlling_device_brand
        os.write_string(79, "librespot")?; // controlling_device_model
        os.write_string(80, "computer") // controlling_device_type
    })
}

/// The gzipped PublishEventsRequest carrying `r`, as the receiver takes it.
fn request_body(
    r: &Report,
    audio_id: &[u8],
    identity: &Identity,
    sequence: i64,
    client_id: &str,
    device_id: &str,
) -> Result<Vec<u8>, String> {
    let player_session = hex(&identity.session_id);
    let fragments: Vec<(&str, Vec<u8>)> = vec![
        ("message", stream_message(r, audio_id, &player_session)?),
        ("context_client_id", message(|os| os.write_bytes(1, &unhex(client_id).unwrap_or_default()))?),
        ("context_installation_id", message(|os| os.write_bytes(1, &Sha1::digest(device_id.as_bytes())[..16]))?),
        (
            "context_application_desktop",
            message(|os| {
                os.write_string(1, VERSION)?;
                os.write_int64(2, VERSION_CODE)?;
                os.write_bytes(3, &identity.session_id)
            })?,
        ),
        (
            "context_device_desktop",
            message(|os| {
                os.write_string(1, librespot_core::config::OS)?;
                os.write_string(2, "librespot")?;
                os.write_string(3, "librespot")?;
                os.write_string(4, device_id)?;
                os.write_string(5, &librespot_core::config::os_version())
            })?,
        ),
        ("context_time", message(|os| os.write_int64(1, r.ended_at_ms))?),
        (
            "context_monotonic_clock",
            message(|os| {
                os.write_int64(1, 1)?;
                os.write_int64(2, identity.clock.elapsed().as_millis() as i64)
            })?,
        ),
        (
            "context_sdk",
            message(|os| {
                os.write_string(1, SDK)?;
                os.write_string(2, "cpp")
            })?,
        ),
        ("context_client_context_id", Vec::new()),
    ];
    let fragments = fragments
        .iter()
        .map(|(name, data)| {
            message(|f| {
                f.write_string(1, name)?;
                f.write_bytes(2, data)
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let envelope = message(|os| {
        os.write_string(2, "RawCoreStream")?;
        for fragment in &fragments {
            os.write_bytes(3, fragment)?;
        }
        os.write_bytes(4, &identity.sequence_id)?;
        os.write_int64(5, sequence)
    })?;
    let request = message(|os| os.write_bytes(1, &envelope))?;
    let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    gz.write_all(&request).map_err(|e| e.to_string())?;
    gz.finish().map_err(|e| e.to_string())
}

/// The audio id in an AUDIO_FILES extension response (AudioFilesExtensionResponse.audio_id = 4).
fn audio_id_of(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut is = CodedInputStream::from_bytes(bytes);
    let mut found = None;
    while let Some(tag) = is.read_raw_tag_or_eof().map_err(|e| e.to_string())? {
        if tag == (4 << 3) | 2 {
            found = Some(is.read_bytes().map_err(|e| e.to_string())?);
        } else {
            protobuf::rt::skip_field_for_tag(tag, &mut is).map_err(|e| e.to_string())?;
        }
    }
    found.filter(|id| !id.is_empty()).ok_or_else(|| "the song has no audio id".into())
}

/// What the receiver answered: Ok when it took the event, else whether trying again may help.
#[derive(Debug, PartialEq)]
enum Answer {
    Taken,
    Rejected { transient: bool, reason: i32 },
}

/// Reads a PublishEventsResponse: its first EventError (field 1: index 1, transient 2, reason 3).
fn read_answer(bytes: &[u8]) -> Result<Answer, String> {
    let mut is = CodedInputStream::from_bytes(bytes);
    while let Some(tag) = is.read_raw_tag_or_eof().map_err(|e| e.to_string())? {
        if tag != (1 << 3) | 2 {
            protobuf::rt::skip_field_for_tag(tag, &mut is).map_err(|e| e.to_string())?;
            continue;
        }
        let error = is.read_bytes().map_err(|e| e.to_string())?;
        let mut es = CodedInputStream::from_bytes(&error);
        let (mut transient, mut reason) = (false, 0);
        while let Some(tag) = es.read_raw_tag_or_eof().map_err(|e| e.to_string())? {
            match tag {
                t if t == 2 << 3 => transient = es.read_bool().map_err(|e| e.to_string())?,
                t if t == 3 << 3 => reason = es.read_int32().map_err(|e| e.to_string())?,
                t => protobuf::rt::skip_field_for_tag(t, &mut es).map_err(|e| e.to_string())?,
            }
        }
        return Ok(Answer::Rejected { transient, reason });
    }
    Ok(Answer::Taken)
}

enum Job {
    Report(Report),
    /// Answered once every job queued before it is done.
    Drained(tokio::sync::oneshot::Sender<()>),
}

/// Follows the player of one session and reports each song played, one at a time, in order.
pub struct Listening {
    hub: Arc<Hub>,
    bitrate: Bitrate,
    tracker: Mutex<Tracker>,
    queue: tokio::sync::mpsc::Sender<Job>,
}

impl Listening {
    pub fn new(app: AppHandle, session: Session, hub: Arc<Hub>, bitrate: Bitrate) -> Arc<Self> {
        let (queue, jobs) = tokio::sync::mpsc::channel(QUEUE);
        let publisher = Publisher {
            app,
            session,
            identity: Identity { session_id: uuid(), sequence_id: uuid(), sequence: 0, clock: Instant::now() },
        };
        tauri::async_runtime::spawn(publisher.run(jobs));
        Arc::new(Self { hub, bitrate, tracker: Mutex::new(Tracker::default()), queue })
    }

    /// Follows one player event; a song that is done goes into the queue.
    pub fn on_event(&self, event: &PlayerEvent) {
        let (now, wall) = (Instant::now(), SystemTime::now());
        {
            let mut t = self.tracker.lock().unwrap();
            let done = match event {
                PlayerEvent::TrackChanged { audio_item } => self.changed(&mut t, audio_item, now, wall),
                PlayerEvent::Playing { track_id, .. } => {
                    t.playing(&track_id.to_string(), now, wall);
                    None
                }
                PlayerEvent::Paused { track_id, .. } => {
                    t.paused(&track_id.to_string(), now);
                    None
                }
                PlayerEvent::Loading { track_id, .. } if t.uri().is_some_and(|u| u != track_id.to_string()) => {
                    t.finish(EndReason::EndPlay, now, wall)
                }
                PlayerEvent::Stopped { .. } => t.finish(EndReason::EndPlay, now, wall),
                PlayerEvent::EndOfTrack { track_id, .. } => {
                    self.note_context(&mut t);
                    t.ended(&track_id.to_string(), now, wall)
                }
                PlayerEvent::Unavailable { track_id, .. } => {
                    t.unavailable(&track_id.to_string());
                    None
                }
                _ => None,
            };
            self.note_context(&mut t);
            // Queued while the tracker is still held: a flush, which takes it too, always finds a
            // listen already finished in the queue ahead of its own.
            if let Some(report) = done {
                // A full queue means Spotify has not answered for a long while: that listen is dropped.
                if self.queue.try_send(Job::Report(report)).is_err() {
                    log::warn!("[listening] queue full, a listen was dropped");
                }
            }
        }
    }

    fn changed(&self, t: &mut Tracker, item: &AudioItem, now: Instant, wall: SystemTime) -> Option<Report> {
        // The song ending is still the one in the cluster: its context, before it goes.
        self.note_context(t);
        // Local files and anything that is not a Spotify song or episode are never reported.
        let spotify = matches!(item.track_id, SpotifyUri::Track { .. } | SpotifyUri::Episode { .. });
        let file = spotify.then(|| pick_file(&item.files, self.bitrate)).flatten();
        t.track_changed(&item.uri, item.duration_ms, file, now, wall)
    }

    /// Takes the context from the cluster while it still shows the song in the player.
    fn note_context(&self, t: &mut Tracker) {
        if let Some(uri) = t.uri().map(str::to_string) {
            if let Some(context) = self.hub.context_of(&uri) {
                t.set_context(&uri, context);
            }
        }
    }

    /// Before the session goes (quit, logout, reconnect): reports the song playing now and waits,
    /// up to FLUSH_WAIT, for everything queued to be sent.
    pub async fn flush(&self) {
        let drained = async {
            // A place in the queue first, then the song is ended and queued under the tracker, as
            // on_event does: nothing finished before it can land behind the drain below.
            let place = self.queue.reserve().await.ok()?;
            {
                let mut t = self.tracker.lock().unwrap();
                self.note_context(&mut t);
                if let Some(report) = t.finish(EndReason::EndPlay, Instant::now(), SystemTime::now()) {
                    place.send(Job::Report(report));
                }
            }
            let (tell, told) = tokio::sync::oneshot::channel();
            self.queue.send(Job::Drained(tell)).await.ok()?;
            told.await.ok()
        };
        if tokio::time::timeout(FLUSH_WAIT, drained).await.is_err() {
            log::warn!("[listening] the last listens were not reported in time");
        }
    }
}

/// Sends the queued reports of one session, one after the other.
struct Publisher {
    app: AppHandle,
    session: Session,
    identity: Identity,
}

impl Publisher {
    async fn run(mut self, mut jobs: tokio::sync::mpsc::Receiver<Job>) {
        while let Some(job) = jobs.recv().await {
            match job {
                Job::Report(report) => {
                    if let Err(e) = self.publish(&report).await {
                        log::warn!("[listening] {} not reported: {e}", report.uri);
                    }
                }
                Job::Drained(tell) => {
                    let _ = tell.send(());
                }
            }
        }
    }

    /// The Settings switch, read again before anything goes out.
    fn allowed(&self) -> bool {
        crate::settings::current(&self.app).report_listening
    }

    async fn publish(&mut self, report: &Report) -> Result<(), String> {
        if !self.allowed() {
            return Ok(());
        }
        let uri = SpotifyUri::from_uri(&report.uri).map_err(|e| e.to_string())?;
        let files = self
            .session
            .spclient()
            .get_metadata(ExtensionKind::AUDIO_FILES, &uri)
            .await
            .map_err(|e| format!("audio files: {e}"))?;
        let audio_id = audio_id_of(&files)?;
        // One number per listen, taken once: every try sends the same bytes.
        self.identity.sequence += 1;
        let body = request_body(
            report,
            &audio_id,
            &self.identity,
            self.identity.sequence,
            &self.session.client_id(),
            self.session.device_id(),
        )?;

        use http::{header, HeaderMap, HeaderValue, Method};
        let mut headers = HeaderMap::new();
        headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/x-protobuf"));
        headers.insert(header::CONTENT_ENCODING, HeaderValue::from_static("gzip"));
        headers.insert("app-platform", HeaderValue::from_static("Win32"));
        headers.insert("spotify-app-version", HeaderValue::from_static("129600518"));
        let mut last = String::new();
        for attempt in 0..ATTEMPTS {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_secs(1 << (attempt - 1))).await;
            }
            // Switched off meanwhile: nothing more goes out.
            if !self.allowed() {
                return Ok(());
            }
            match self.session.spclient().request(&Method::POST, ENDPOINT, Some(headers.clone()), Some(&body)).await {
                Ok(answer) => match read_answer(&answer)? {
                    Answer::Taken => return Ok(()),
                    Answer::Rejected { transient: true, reason } => last = format!("rejected for now ({reason})"),
                    Answer::Rejected { transient: false, reason } => return Err(format!("rejected ({reason})")),
                },
                Err(e) => last = e.to_string(),
            }
        }
        Err(last)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SONG: &str = "spotify:track:3WKh2YnHfpfPXhcSjM4mW2";
    const NEXT: &str = "spotify:track:72AZ3V52rs9NfgMNhALxln";

    fn file() -> Option<(AudioFileFormat, FileId)> {
        Some((AudioFileFormat::OGG_VORBIS_320, FileId([7; 20])))
    }

    fn at(base: SystemTime, ms: u64) -> SystemTime {
        base + Duration::from_millis(ms)
    }

    #[test]
    fn pauses_do_not_count_and_the_end_reports_once() {
        let (t0, w0) = (Instant::now(), SystemTime::UNIX_EPOCH + Duration::from_secs(1_800_000_000));
        let mut t = Tracker::default();
        assert_eq!(t.track_changed(SONG, 200_000, file(), t0, w0), None);
        t.playing(SONG, t0, w0);
        t.paused(SONG, t0 + Duration::from_secs(30));
        // Ten minutes paused, then 20 more seconds.
        t.playing(SONG, t0 + Duration::from_secs(630), at(w0, 630_000));
        let r = t.finish(EndReason::EndPlay, t0 + Duration::from_secs(650), at(w0, 650_000)).unwrap();
        assert_eq!(r.played_ms, 50_000);
        assert_eq!(r.started_at_ms, millis(w0));
        assert_eq!(r.ended_at_ms, millis(at(w0, 650_000)));
        assert_eq!(r.audio_format, "Vorbis 320 kbps");
        assert_eq!(r.file_id, [7; 20]);
        // Nothing left to report a second time.
        assert_eq!(t.finish(EndReason::EndPlay, t0 + Duration::from_secs(700), w0), None);
    }

    #[test]
    fn the_next_song_ends_the_one_before_and_plays_are_capped_at_the_duration() {
        let (t0, w0) = (Instant::now(), SystemTime::UNIX_EPOCH + Duration::from_secs(1_800_000_000));
        let mut t = Tracker::default();
        t.track_changed(SONG, 10_000, file(), t0, w0);
        t.playing(SONG, t0, w0);
        t.set_context(SONG, "spotify:album:7bucvNPtEChWJ98pTgppNO".into());
        let r = t.track_changed(NEXT, 90_000, file(), t0 + Duration::from_secs(15), at(w0, 15_000)).unwrap();
        assert_eq!(r.uri, SONG);
        assert_eq!(r.played_ms, 10_000);
        assert_eq!(r.reason, EndReason::EndPlay);
        assert_eq!(r.context, "spotify:album:7bucvNPtEChWJ98pTgppNO");
        // The new song is followed on its own, and events for the old one are ignored.
        t.paused(SONG, t0 + Duration::from_secs(16));
        assert_eq!(t.uri(), Some(NEXT));
    }

    #[test]
    fn a_song_played_to_the_end_is_trackdone_and_falls_back_to_its_own_uri_as_context() {
        let (t0, w0) = (Instant::now(), SystemTime::UNIX_EPOCH + Duration::from_secs(1_800_000_000));
        let mut t = Tracker::default();
        t.track_changed(NEXT, 90_000, file(), t0, w0);
        t.playing(NEXT, t0, w0);
        assert_eq!(t.ended(SONG, t0 + Duration::from_secs(90), w0), None, "another song's end is not this one's");
        let r = t.ended(NEXT, t0 + Duration::from_secs(90), at(w0, 90_000)).unwrap();
        assert_eq!(r.reason, EndReason::TrackDone);
        assert_eq!(r.context, NEXT);
        assert_eq!(r.played_ms, 90_000);
    }

    #[test]
    fn never_played_unavailable_or_without_a_known_format_is_not_reported() {
        let (t0, w0) = (Instant::now(), SystemTime::UNIX_EPOCH + Duration::from_secs(1_800_000_000));
        let mut t = Tracker::default();
        t.track_changed(SONG, 90_000, file(), t0, w0);
        assert_eq!(t.finish(EndReason::EndPlay, t0 + Duration::from_secs(5), w0), None, "loaded, never played");

        t.track_changed(SONG, 90_000, file(), t0, w0);
        t.playing(SONG, t0, w0);
        t.unavailable(SONG);
        assert_eq!(t.finish(EndReason::EndPlay, t0 + Duration::from_secs(5), w0), None, "unavailable");

        t.track_changed(SONG, 90_000, Some((AudioFileFormat::FLAC_FLAC, FileId([1; 20]))), t0, w0);
        t.playing(SONG, t0, w0);
        assert_eq!(t.finish(EndReason::EndPlay, t0 + Duration::from_secs(5), w0), None, "unknown format");
    }

    #[test]
    fn the_player_file_order_is_followed() {
        let mut files = AudioFiles(Default::default());
        files.insert(AudioFileFormat::OGG_VORBIS_160, FileId([1; 20]));
        files.insert(AudioFileFormat::MP3_320, FileId([2; 20]));
        assert_eq!(pick_file(&files, Bitrate::Bitrate320).unwrap().0, AudioFileFormat::MP3_320);
        assert_eq!(pick_file(&files, Bitrate::Bitrate160).unwrap().0, AudioFileFormat::OGG_VORBIS_160);
        assert_eq!(pick_file(&files, Bitrate::Bitrate96).unwrap().0, AudioFileFormat::OGG_VORBIS_160);
    }

    /// Top-level fields of a message: (field, varint value, bytes).
    fn fields(bytes: &[u8]) -> Vec<(u32, u64, Vec<u8>)> {
        let mut is = CodedInputStream::from_bytes(bytes);
        let mut out = vec![];
        while let Some(tag) = is.read_raw_tag_or_eof().unwrap() {
            match tag & 7 {
                0 => out.push((tag >> 3, is.read_uint64().unwrap(), vec![])),
                2 => out.push((tag >> 3, 0, is.read_bytes().unwrap())),
                _ => panic!("unexpected wire type"),
            }
        }
        out
    }

    fn report() -> Report {
        Report {
            uri: SONG.into(),
            file_id: [0x17; 20],
            audio_format: "Vorbis 320 kbps",
            context: "spotify:album:7bucvNPtEChWJ98pTgppNO".into(),
            started_at_ms: 1_792_720_525_000,
            ended_at_ms: 1_792_720_598_000,
            played_ms: 67_941,
            reason: EndReason::EndPlay,
        }
    }

    #[test]
    fn the_stream_message_carries_the_real_time_and_identity() {
        let m = fields(&stream_message(&report(), &[0xab; 16], "s").unwrap());
        let get = |f: u32| m.iter().find(|x| x.0 == f).unwrap().clone();
        assert_eq!(get(4).2, vec![0x17; 20]);
        assert_eq!(get(13).1, 1_792_720_525_000);
        assert_eq!(get(14).1, 67_941);
        assert_eq!(get(15).1, 67_941);
        assert_eq!(get(12).2, b"endplay");
        assert_eq!(get(23).2, b"spotify:album:7bucvNPtEChWJ98pTgppNO");
        assert_eq!(get(24).2, SONG.as_bytes());
        assert_eq!(get(56).1, 1_792_720_598_000);
        assert_eq!(get(63).2, "ab".repeat(16).as_bytes());
        assert_eq!(get(1).2.len(), 16);
    }

    #[test]
    fn the_request_is_one_gzipped_envelope_with_every_fragment() {
        use std::io::Read;
        let identity = Identity { session_id: vec![1; 16], sequence_id: vec![2; 16], sequence: 0, clock: Instant::now() };
        let body = request_body(&report(), &[0xab; 16], &identity, 4, "65b708073fc0480ea92a077233ca87bd", "dev").unwrap();
        let mut raw = vec![];
        flate2::read::GzDecoder::new(&body[..]).read_to_end(&mut raw).unwrap();
        let request = fields(&raw);
        assert_eq!(request.len(), 1);
        let envelope = fields(&request[0].2);
        assert_eq!(envelope.iter().find(|f| f.0 == 2).unwrap().2, b"RawCoreStream");
        assert_eq!(envelope.iter().find(|f| f.0 == 4).unwrap().2, vec![2; 16]);
        assert_eq!(envelope.iter().find(|f| f.0 == 5).unwrap().1, 4);
        let names: Vec<String> = envelope
            .iter()
            .filter(|f| f.0 == 3)
            .map(|f| String::from_utf8(fields(&f.2)[0].2.clone()).unwrap())
            .collect();
        assert_eq!(
            names,
            [
                "message",
                "context_client_id",
                "context_installation_id",
                "context_application_desktop",
                "context_device_desktop",
                "context_time",
                "context_monotonic_clock",
                "context_sdk",
                "context_client_context_id"
            ]
        );
        let client = envelope.iter().filter(|f| f.0 == 3).nth(1).unwrap();
        assert_eq!(fields(&fields(&client.2)[1].2)[0].2, unhex("65b708073fc0480ea92a077233ca87bd").unwrap());
    }

    #[test]
    fn answers_are_read_and_malformed_ones_are_errors() {
        assert_eq!(read_answer(&[]).unwrap(), Answer::Taken);
        // error[0] = { index 0, reason 2 }
        assert_eq!(read_answer(&[0x0a, 0x02, 0x18, 0x02]).unwrap(), Answer::Rejected { transient: false, reason: 2 });
        // error[0] = { index 0, transient true, reason 1 }
        assert_eq!(read_answer(&[0x0a, 0x04, 0x10, 0x01, 0x18, 0x01]).unwrap(), Answer::Rejected { transient: true, reason: 1 });
        // A length past the end, and an unterminated varint.
        assert!(read_answer(&[0x0a, 0x09, 0x18]).is_err());
        assert!(read_answer(&[0x0a, 0x02, 0x18, 0xff]).is_err());
    }

    #[test]
    fn the_audio_id_is_read_and_missing_or_malformed_is_an_error() {
        // files (1) = something to skip, audio_id (4) = 16 bytes
        let mut bytes = vec![0x0a, 0x02, 0x08, 0x01, 0x22, 0x10];
        bytes.extend([0xab; 16]);
        assert_eq!(audio_id_of(&bytes).unwrap(), vec![0xab; 16]);
        assert!(audio_id_of(&[0x0a, 0x02, 0x08, 0x01]).is_err());
        assert!(audio_id_of(&[0x22, 0x10, 0xab]).is_err());
    }

    #[test]
    fn hex_round_trips_and_rejects_odd_or_bad_input() {
        assert_eq!(unhex("65b7").unwrap(), vec![0x65, 0xb7]);
        assert_eq!(hex(&[0x65, 0xb7]), "65b7");
        assert_eq!(unhex("6"), None);
        assert_eq!(unhex("zz"), None);
    }
}
