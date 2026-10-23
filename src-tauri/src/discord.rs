// Discord presence: what plays, on the user's Discord profile as "Listening to", through the
// Discord app on this computer (its local IPC pipe). Only SET_ACTIVITY, which needs no OAuth, so
// any user's Discord takes it. With Discord closed nothing happens; it is picked up when Discord
// opens. One thread owns the pipe: the page sends what to show, the thread sends the latest.
//
// The app is "Quackify" in the Discord Developer Portal (made 23/10/26). Discord hides an
// activity's buttons from its own user: only friends see "Join the Jam".
use std::fs::{File, OpenOptions};
use std::io::{self, Read, Write};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

const CLIENT_ID: &str = "1562993572767072377";
/// How often a closed Discord is looked for again while there is something to show.
const RETRY: Duration = Duration::from_secs(15);
/// Changes this close together go out as one (Discord takes 5 updates per 20 seconds).
const SETTLE: Duration = Duration::from_millis(800);
/// Largest frame read from the pipe; Discord's answers are a few KB.
const MAX_FRAME: usize = 1 << 20;

#[derive(Deserialize, Clone, PartialEq, Debug)]
pub struct Button {
    label: String,
    url: String,
}

/// What the page wants shown: the song, its cover and times, and the buttons friends see.
#[derive(Deserialize, Clone, PartialEq, Debug)]
pub struct Presence {
    details: String,
    state: String,
    image: Option<String>,
    image_text: Option<String>,
    start_ms: i64,
    end_ms: Option<i64>,
    buttons: Vec<Button>,
}

/// Discord's limits: texts 2 to 128 characters, at most 2 buttons with 32-character labels.
fn clip(s: &str, max: usize) -> String {
    let s: String = s.trim().chars().take(max).collect();
    if s.chars().count() < 2 { format!("{s:<2}") } else { s }
}

fn activity(p: &Presence) -> Value {
    let mut assets = json!({});
    if let Some(image) = p.image.as_deref().filter(|u| u.starts_with("https://")) {
        assets["large_image"] = image.into();
        if let Some(text) = p.image_text.as_deref().filter(|t| !t.trim().is_empty()) {
            assets["large_text"] = clip(text, 128).into();
        }
    }
    let mut timestamps = json!({ "start": p.start_ms });
    if let Some(end) = p.end_ms.filter(|&e| e > p.start_ms) {
        timestamps["end"] = end.into();
    }
    let buttons: Vec<Value> = p
        .buttons
        .iter()
        .filter(|b| b.url.starts_with("https://") && b.url.len() <= 512 && !b.label.trim().is_empty())
        .take(2)
        .map(|b| json!({ "label": b.label.trim().chars().take(32).collect::<String>(), "url": b.url }))
        .collect();
    let mut a = json!({
        // Listening, with the song's name where the friends list would say "Quackify".
        "type": 2,
        "status_display_type": 2,
        "details": clip(&p.details, 128),
        "state": clip(&p.state, 128),
        "timestamps": timestamps,
        "assets": assets,
    });
    if !buttons.is_empty() {
        a["buttons"] = buttons.into();
    }
    a
}

struct Pipe(File);

impl Pipe {
    /// Discord listens on the first free one of discord-ipc-0 to 9.
    fn open() -> Option<Pipe> {
        (0..10).find_map(|i| {
            let file = OpenOptions::new().read(true).write(true).open(format!(r"\\.\pipe\discord-ipc-{i}")).ok()?;
            let mut pipe = Pipe(file);
            pipe.handshake().ok()?;
            Some(pipe)
        })
    }

    fn send(&mut self, op: i32, body: &Value) -> io::Result<()> {
        let body = serde_json::to_vec(body)?;
        let mut frame = Vec::with_capacity(8 + body.len());
        frame.extend_from_slice(&op.to_le_bytes());
        frame.extend_from_slice(&(body.len() as i32).to_le_bytes());
        frame.extend_from_slice(&body);
        self.0.write_all(&frame)?;
        self.0.flush()
    }

    /// The next message; pings are answered on the way, a close is an error.
    fn recv(&mut self) -> io::Result<Value> {
        loop {
            let mut head = [0u8; 8];
            self.0.read_exact(&mut head)?;
            let op = i32::from_le_bytes(head[..4].try_into().unwrap());
            let len = i32::from_le_bytes(head[4..].try_into().unwrap());
            let len = usize::try_from(len).ok().filter(|&l| l <= MAX_FRAME).ok_or_else(|| io::Error::other("bad frame"))?;
            let mut body = vec![0u8; len];
            self.0.read_exact(&mut body)?;
            match op {
                // Ping: the same bytes back as a pong.
                3 => {
                    let mut frame = 4i32.to_le_bytes().to_vec();
                    frame.extend_from_slice(&head[4..]);
                    frame.extend_from_slice(&body);
                    self.0.write_all(&frame)?;
                }
                2 => return Err(io::Error::other(format!("closed: {}", String::from_utf8_lossy(&body)))),
                _ => return serde_json::from_slice(&body).map_err(io::Error::other),
            }
        }
    }

    fn handshake(&mut self) -> io::Result<()> {
        self.send(0, &json!({ "v": 1, "client_id": CLIENT_ID }))?;
        loop {
            if self.recv()?["evt"] == "READY" {
                return Ok(());
            }
        }
    }

    /// Shows `activity`, or clears it. A refusal is logged, not an error: the pipe still works.
    fn set(&mut self, activity: Option<Value>) -> io::Result<()> {
        let mut args = json!({ "pid": std::process::id() });
        if let Some(a) = activity {
            args["activity"] = a;
        }
        self.send(1, &json!({ "cmd": "SET_ACTIVITY", "args": args, "nonce": "presence" }))?;
        loop {
            let msg = self.recv()?;
            if msg["nonce"] == "presence" {
                if msg["evt"] == "ERROR" {
                    eprintln!("discord: presence refused: {}", msg["data"]);
                }
                return Ok(());
            }
        }
    }
}

fn run(rx: Receiver<Option<Presence>>) {
    let mut want: Option<Presence> = None;
    // What Discord shows now, as far as this thread knows; None while not connected.
    let mut shown: Option<Option<Presence>> = None;
    let mut pipe: Option<Pipe> = None;
    loop {
        match rx.recv_timeout(RETRY) {
            Ok(p) => {
                want = p;
                while let Ok(p) = rx.recv_timeout(SETTLE) {
                    want = p;
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
        if pipe.is_none() {
            // Discord clears a closed app's presence by itself: nothing to clear then.
            if want.is_none() {
                continue;
            }
            pipe = Pipe::open();
            shown = None;
        }
        let Some(p) = pipe.as_mut() else { continue };
        if shown.as_ref() == Some(&want) {
            continue;
        }
        match p.set(want.as_ref().map(activity)) {
            Ok(()) => shown = Some(want.clone()),
            // Discord quit or restarted: open it again on the next round.
            Err(e) => {
                eprintln!("discord: {e}");
                pipe = None;
                shown = None;
            }
        }
    }
}

/// The thread's inbox, made on first use, and the last presence the page asked for (shown again
/// when the setting comes back on).
#[derive(Default)]
pub struct Discord {
    tx: Mutex<Option<Sender<Option<Presence>>>>,
    last: Mutex<Option<Presence>>,
}

impl Discord {
    fn push(&self, presence: Option<Presence>) {
        let mut tx = self.tx.lock().unwrap();
        let sender = tx.get_or_insert_with(|| {
            let (tx, rx) = channel();
            std::thread::spawn(move || run(rx));
            tx
        });
        if sender.send(presence.clone()).is_err() {
            // The thread is gone: a new one next time.
            *tx = None;
        }
    }
}

/// Shows the last presence asked for, or nothing, as the setting says now.
pub fn refresh(app: &AppHandle) {
    let discord = app.state::<Discord>();
    let presence = crate::settings::current(app).discord_presence.then(|| discord.last.lock().unwrap().clone()).flatten();
    discord.push(presence);
}

/// What plays now, for Discord; nothing when paused or idle.
#[tauri::command]
pub fn discord_presence(app: AppHandle, presence: Option<Presence>) {
    let discord = app.state::<Discord>();
    let mut last = discord.last.lock().unwrap();
    if *last == presence {
        return;
    }
    *last = presence;
    drop(last);
    refresh(&app);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn presence() -> Presence {
        Presence {
            details: "X".into(),
            state: "Queen".into(),
            image: Some("https://i.scdn.co/image/abc".into()),
            image_text: Some("A Night At The Opera".into()),
            start_ms: 1000,
            end_ms: Some(500),
            buttons: vec![
                Button { label: "Entrar na Jam com um nome comprido demais".into(), url: "https://open.spotify.com/socialsession/t".into() },
                Button { label: "Local".into(), url: "spotify:track:1".into() },
                Button { label: "Ouvir no Spotify".into(), url: "https://open.spotify.com/track/1".into() },
            ],
        }
    }

    #[test]
    fn keeps_to_discords_limits() {
        let a = activity(&presence());
        assert_eq!(a["type"], 2);
        // A one-letter song is padded to Discord's two.
        assert_eq!(a["details"], "X ");
        assert_eq!(a["assets"]["large_image"], "https://i.scdn.co/image/abc");
        // An end before the start is dropped.
        assert_eq!(a["timestamps"], json!({ "start": 1000 }));
        // Only https buttons, labels cut to 32.
        let b = a["buttons"].as_array().unwrap();
        assert_eq!(b.len(), 2);
        assert_eq!(b[0]["label"].as_str().unwrap().chars().count(), 32);
        assert_eq!(b[1]["url"], "https://open.spotify.com/track/1");
    }

    #[test]
    fn no_image_no_buttons() {
        let p = Presence { image: Some("http://insecure".into()), buttons: vec![], ..presence() };
        let a = activity(&p);
        assert_eq!(a["assets"], json!({}));
        assert!(a.get("buttons").is_none());
    }
}
