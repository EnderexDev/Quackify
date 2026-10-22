// The app's settings, kept in settings.json next to the login cache. The Settings page reads
// and writes them; the player and the tray read them.
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
#[serde(rename_all = "snake_case")]
pub enum Quality {
    /// 96 kbps.
    Normal,
    /// 160 kbps.
    High,
    /// 320 kbps, the best Spotify serves outside its own apps.
    #[default]
    VeryHigh,
}

/// Spotify's volume levels for normalization: about -19, -14 and -11 LUFS.
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
#[serde(rename_all = "snake_case")]
pub enum Loudness {
    Quiet,
    #[default]
    Normal,
    Loud,
}

impl Loudness {
    /// Gain over Spotify's normalized level (-14 LUFS), in dB.
    pub fn pregain_db(self) -> f64 {
        match self {
            Loudness::Quiet => -5.0,
            Loudness::Normal => 0.0,
            Loudness::Loud => 3.0,
        }
    }
}

/// How the player's progress bar looks. Wave and Live need Quackify's own audio output (meter.rs);
/// Simple keeps librespot's.
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
#[serde(rename_all = "snake_case")]
pub enum ProgressMode {
    /// The line.
    #[default]
    Simple,
    /// The song's waveform, drawn as it plays and kept per song.
    Wave,
    /// Bars that move with the sound, low notes in the middle.
    Live,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(default)]
pub struct Settings {
    /// The window's close button hides it to the tray, and the music keeps playing.
    pub close_to_tray: bool,
    pub quality: Quality,
    /// Every song at the same loudness.
    pub normalize: bool,
    pub loudness: Loudness,
    /// When what plays ends, keep playing similar songs.
    pub autoplay: bool,
    /// The next song starts with no gap after the one ending.
    pub gapless: bool,
    /// Songs played are kept on disk, so playing them again starts at once and saves data.
    pub audio_cache: bool,
    /// Most the audio cache may take, in GB; the oldest songs go first.
    pub cache_size_gb: u32,
    /// The name other Spotify apps show for this computer.
    pub device_name: String,
    /// Starting with Windows opens Quackify in the tray rather than in a window.
    pub start_minimized: bool,
    /// The folder the song cache goes in (its own subfolder is made there); none: the app's
    /// local data folder.
    pub cache_parent: Option<String>,
    pub progress_mode: ProgressMode,
}

/// The cache's own folder inside a folder the user picks: only it is ever cleared.
pub const CACHE_FOLDER_NAME: &str = "Quackify audio-cache";

pub const DEFAULT_DEVICE_NAME: &str = "Quackify";
/// The cache sizes the Settings page offers, in GB.
pub const CACHE_SIZES_GB: &[u32] = &[1, 2, 5, 10, 20];

impl Default for Settings {
    fn default() -> Self {
        Self {
            close_to_tray: true,
            quality: Quality::default(),
            normalize: true,
            loudness: Loudness::default(),
            autoplay: true,
            gapless: true,
            audio_cache: true,
            cache_size_gb: 2,
            device_name: DEFAULT_DEVICE_NAME.to_string(),
            start_minimized: true,
            cache_parent: None,
            progress_mode: ProgressMode::default(),
        }
    }
}

impl Settings {
    /// Whether going from `self` to `other` changes how the player is built.
    pub fn player_differs(&self, other: &Settings) -> bool {
        self.quality != other.quality
            || self.normalize != other.normalize
            || self.loudness != other.loudness
            || self.autoplay != other.autoplay
            || self.gapless != other.gapless
            || self.audio_cache != other.audio_cache
            || self.cache_size_gb != other.cache_size_gb
            || self.device_name() != other.device_name()
            || self.cache_parent != other.cache_parent
            // Simple and the other two use different audio outputs.
            || (self.progress_mode == ProgressMode::Simple) != (other.progress_mode == ProgressMode::Simple)
    }

    /// The device name to use: never empty, and short like Spotify's own.
    pub fn device_name(&self) -> String {
        let name: String = self.device_name.trim().chars().take(MAX_DEVICE_NAME).collect();
        if name.is_empty() { DEFAULT_DEVICE_NAME.to_string() } else { name }
    }

    /// The cache size limit in bytes, from one of the offered sizes.
    pub fn cache_limit_bytes(&self) -> u64 {
        let gb = if CACHE_SIZES_GB.contains(&self.cache_size_gb) { self.cache_size_gb } else { 2 };
        u64::from(gb) * 1024 * 1024 * 1024
    }
}

const MAX_DEVICE_NAME: usize = 40;

pub struct Store {
    file: Option<PathBuf>,
    current: Mutex<Settings>,
    /// Why songs are not being cached right now (the folder could not be made), if so.
    cache_problem: Mutex<Option<String>>,
    /// One cache move at a time, from the check to the old cache's deletion.
    cache_move: tokio::sync::Mutex<()>,
}

impl Store {
    pub fn load(app: &AppHandle) -> Self {
        let file = app.path().app_data_dir().ok().map(|d| d.join("settings.json"));
        let current = file
            .as_ref()
            .and_then(|f| std::fs::read_to_string(f).ok())
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_else(|| Settings { device_name: crate::variant::name(app), ..Default::default() });
        Self { file, current: Mutex::new(current), cache_problem: Mutex::new(None), cache_move: tokio::sync::Mutex::new(()) }
    }

    pub fn get(&self) -> Settings {
        self.current.lock().unwrap().clone()
    }

    /// Puts `parent` back as the cache folder, only if the folder is still `expected` (nothing
    /// else changed it meanwhile); every other setting stays as it is now.
    fn restore_cache_parent(&self, expected: &Option<String>, parent: Option<String>) -> Result<bool, String> {
        let now = self.get();
        if &now.cache_parent != expected {
            return Ok(false);
        }
        self.set(Settings { cache_parent: parent, ..now })?;
        Ok(true)
    }

    /// Saves `settings`; the previous ones come back. One save at a time, and the file is
    /// replaced whole, so it always matches what is in memory.
    pub fn set(&self, settings: Settings) -> Result<Settings, String> {
        let mut current = self.current.lock().unwrap();
        if let Some(file) = &self.file {
            if let Some(dir) = file.parent() {
                std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
            }
            let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
            let tmp = file.with_extension("json.tmp");
            std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
            std::fs::rename(&tmp, file).map_err(|e| e.to_string())?;
        }
        Ok(std::mem::replace(&mut *current, settings))
    }
}

/// The settings now (defaults when the store is not up yet).
pub fn current(app: &AppHandle) -> Settings {
    app.try_state::<Store>().map(|s| s.get()).unwrap_or_default()
}

/// What the Settings page shows: the saved settings plus Windows' startup entry.
#[derive(Serialize)]
pub struct View {
    settings: Settings,
    start_with_windows: bool,
}

#[tauri::command]
pub fn settings_get(app: AppHandle) -> View {
    View { settings: current(&app), start_with_windows: crate::desktop::start_with_windows(&app) }
}

/// Saves the settings. Audio ones rebuild the player, which takes a moment; the tray follows.
#[tauri::command]
pub async fn settings_set(app: AppHandle, settings: Settings) -> Result<(), String> {
    let before = app.state::<Store>().set(settings.clone())?;
    crate::desktop::sync_tray(&app);
    // The startup entry carries "start minimized" in its command line: rewrite it.
    if before.start_minimized != settings.start_minimized && crate::desktop::start_with_windows(&app) {
        crate::desktop::set_start_with_windows(&app, true)?;
    }
    // Other windows' views (Your Library's layout) follow.
    let _ = app.emit("settings-changed", ());
    if before.player_differs(&settings) {
        crate::spotify::reconnect(&app).await?;
    }
    Ok(())
}

#[tauri::command]
pub fn settings_set_start_with_windows(app: AppHandle, on: bool) -> Result<bool, String> {
    crate::desktop::set_start_with_windows(&app, on)
}

/// Where songs are cached: a subfolder of the folder the user picked, or the local (not
/// roaming) app data, as it can grow to gigabytes.
pub fn audio_cache_dir(app: &AppHandle) -> Option<PathBuf> {
    cache_dir_for(app, current(app).cache_parent.as_deref())
}

fn cache_dir_for(app: &AppHandle, parent: Option<&str>) -> Option<PathBuf> {
    match parent {
        Some(p) => Some(PathBuf::from(p).join(CACHE_FOLDER_NAME)),
        None => app.path().app_local_data_dir().ok().map(|d| d.join("audio-cache")),
    }
}

/// Makes the cache folder ready, or says why it cannot be (a disk that is not there, no rights).
/// Without it the player runs with no cache rather than failing the login.
pub fn prepare_cache_dir(app: &AppHandle) -> Option<PathBuf> {
    let dir = audio_cache_dir(app)?;
    let problem = match std::fs::create_dir_all(&dir) {
        Ok(()) if real_dir(dir.clone()).is_none() => Some(format!("{} is not a plain folder", dir.display())),
        // A folder that exists may still refuse writes.
        Ok(()) => probe_write(&dir).err().map(|e| format!("{} cannot be written to: {e}", dir.display())),
        Err(e) => Some(format!("{} cannot be used: {e}", dir.display())),
    };
    let ok = problem.is_none();
    if let Some(store) = app.try_state::<Store>() {
        *store.cache_problem.lock().unwrap() = problem;
    }
    ok.then_some(dir)
}

/// Writes and deletes a new file in `dir`. The name is new each time and the file must not
/// exist yet, so nothing already there (or a link) is ever written over or removed.
fn probe_write(dir: &std::path::Path) -> std::io::Result<()> {
    use std::io::Write;
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    let probe = dir.join(format!(".quackify-write-test-{}-{nanos}", std::process::id()));
    let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&probe)?;
    let written = file.write_all(b"ok");
    drop(file);
    let removed = std::fs::remove_file(&probe);
    written.and(removed)
}

/// Checks that songs can be written in `parent`'s cache subfolder.
fn check_writable(parent: &std::path::Path) -> Result<(), String> {
    if !parent.is_dir() {
        return Err(format!("{} is not a folder that exists.", parent.display()));
    }
    let dir = parent.join(CACHE_FOLDER_NAME);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Cannot make a folder in {}: {e}", parent.display()))?;
    if real_dir(dir.clone()).is_none() {
        return Err(format!("{} is not a plain folder.", dir.display()));
    }
    probe_write(&dir).map_err(|e| format!("Cannot write in {}: {e}", dir.display()))
}

/// Whether one folder is the other or inside it (after following them to their real place).
fn nested(a: &std::path::Path, b: &std::path::Path) -> bool {
    let real = |p: &std::path::Path| std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    let (a, b) = (real(a), real(b));
    a.starts_with(&b) || b.starts_with(&a)
}

#[derive(Serialize)]
pub struct CacheFolder {
    /// The folder songs go in.
    folder: String,
    custom: bool,
    problem: Option<String>,
}

#[tauri::command]
pub fn settings_cache_folder(app: AppHandle) -> CacheFolder {
    CacheFolder {
        folder: audio_cache_dir(&app).map(|d| d.display().to_string()).unwrap_or_default(),
        custom: current(&app).cache_parent.is_some(),
        problem: app.try_state::<Store>().and_then(|s| s.cache_problem.lock().unwrap().clone()),
    }
}

/// Opens Windows' folder picker; the chosen folder, if any.
#[tauri::command]
pub async fn settings_pick_folder(app: AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let dialog = app.dialog().clone();
    tauri::async_runtime::spawn_blocking(move || dialog.file().set_title("Folder for the song cache").blocking_pick_folder())
        .await
        .ok()
        .flatten()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.display().to_string())
}

/// Moves the song cache to `parent` (None: back to the default). The player is rebuilt on the
/// new folder and the old cache is deleted: songs are fetched again as they play.
#[tauri::command]
pub async fn settings_set_cache_folder(app: AppHandle, parent: Option<String>) -> Result<CacheFolder, String> {
    if let Some(p) = &parent {
        let p = PathBuf::from(p);
        tauri::async_runtime::spawn_blocking(move || check_writable(&p)).await.map_err(|e| e.to_string())??;
    }
    let store = app.state::<Store>();
    let _one_at_a_time = store.cache_move.lock().await;
    let before = store.get();
    if before.cache_parent == parent {
        return Ok(settings_cache_folder(app.clone()));
    }
    let old = cache_dir_for(&app, before.cache_parent.as_deref()).and_then(real_dir);
    // The old cache is deleted after the move: the new one must not be inside it, or the other
    // way round.
    let new = cache_dir_for(&app, parent.as_deref());
    if let (Some(old), Some(new)) = (&old, &new) {
        if nested(old, new) {
            return Err("Pick a folder outside the current song cache.".into());
        }
    }
    store.set(Settings { cache_parent: parent.clone(), ..before.clone() })?;
    let _ = app.emit("settings-changed", ());
    if let Err(e) = crate::spotify::reconnect(&app).await {
        // Back to the folder that was working, which still has its songs. Only the folder goes
        // back: settings changed meanwhile are kept.
        if store.restore_cache_parent(&parent, before.cache_parent)? {
            let _ = app.emit("settings-changed", ());
            let _ = crate::spotify::reconnect(&app).await;
        }
        return Err(e);
    }
    if let Some(old) = old.filter(|o| Some(o) != audio_cache_dir(&app).as_ref()) {
        let _ = tauri::async_runtime::spawn_blocking(move || {
            clear_dir(&old);
            let _ = std::fs::remove_dir(&old);
        })
        .await;
    }
    Ok(settings_cache_folder(app.clone()))
}

/// The cache directory if it is a real directory: a link put in its place is never walked.
fn real_dir(dir: PathBuf) -> Option<PathBuf> {
    std::fs::symlink_metadata(&dir).ok().filter(|m| m.file_type().is_dir()).map(|_| dir)
}

// Links (symlinks, junctions) are never followed: only what is really inside the cache counts
// or gets deleted.
fn dir_size(dir: &std::path::Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else { return 0 };
    entries
        .flatten()
        .map(|e| match e.file_type() {
            Ok(t) if t.is_dir() => dir_size(&e.path()),
            Ok(t) if t.is_file() => e.metadata().map(|m| m.len()).unwrap_or(0),
            _ => 0,
        })
        .sum()
}

/// The cache's size, measured off the main thread (it walks every file).
async fn cache_size(app: &AppHandle) -> u64 {
    let Some(dir) = audio_cache_dir(app).and_then(real_dir) else { return 0 };
    tauri::async_runtime::spawn_blocking(move || dir_size(&dir)).await.unwrap_or(0)
}

/// How many bytes the audio cache takes now.
#[tauri::command]
pub async fn settings_cache_size(app: AppHandle) -> u64 {
    cache_size(&app).await
}

/// Empties the audio cache. Files the player has open stay; the player is rebuilt afterwards
/// so its count of the cache's size starts over. Returns the size left.
#[tauri::command]
pub async fn settings_clear_cache(app: AppHandle) -> Result<u64, String> {
    if let Some(dir) = audio_cache_dir(&app) {
        match real_dir(dir.clone()) {
            Some(dir) => tauri::async_runtime::spawn_blocking(move || clear_dir(&dir)).await.map_err(|e| e.to_string())?,
            // Something other than the cache's own folder is there: it is not ours to empty.
            None if dir.exists() => return Err("The cache folder is not a plain folder; it was left alone.".into()),
            None => {}
        }
        crate::spotify::reconnect(&app).await?;
    }
    Ok(cache_size(&app).await)
}

fn clear_dir(dir: &std::path::Path) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let path = e.path();
        let Ok(kind) = e.file_type() else { continue };
        if kind.is_dir() {
            clear_dir(&path);
            let _ = std::fs::remove_dir(&path);
        } else if kind.is_symlink() {
            // The link goes, not what it points to (a directory link is removed as a directory).
            if std::fs::remove_file(&path).is_err() {
                let _ = std::fs::remove_dir(&path);
            }
        } else {
            let _ = std::fs::remove_file(&path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_files_keep_their_value_and_get_defaults_for_the_rest() {
        // settings.json from before the Settings page only had this.
        let s: Settings = serde_json::from_str(r#"{ "close_to_tray": false }"#).unwrap();
        assert!(!s.close_to_tray);
        assert_eq!(s.quality, Quality::VeryHigh);
        assert!(s.normalize && s.autoplay);
        let back: Settings = serde_json::from_str(&serde_json::to_string(&s).unwrap()).unwrap();
        assert_eq!(back, s);
    }

    /// A directory junction (no special rights needed, unlike symlinks).
    #[cfg(windows)]
    fn junction(target: &std::path::Path, link: &std::path::Path) -> bool {
        std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .output()
            .is_ok_and(|o| o.status.success())
    }

    #[test]
    fn clearing_the_cache_does_not_follow_links() {
        let base = std::env::temp_dir().join(format!("quackify-cache-test-{}", std::process::id()));
        let (cache, outside) = (base.join("cache"), base.join("outside"));
        std::fs::create_dir_all(cache.join("ab")).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(cache.join("ab").join("song"), vec![0u8; 1000]).unwrap();
        std::fs::write(outside.join("keep"), b"precious").unwrap();
        // A directory link inside the cache pointing out of it (may need rights on Windows).
        #[cfg(windows)]
        let linked = junction(&outside, &cache.join("link"));
        #[cfg(not(windows))]
        let linked = std::os::unix::fs::symlink(&outside, cache.join("link")).is_ok();
        assert_eq!(dir_size(&cache), 1000);
        clear_dir(&cache);
        assert_eq!(dir_size(&cache), 0);
        assert!(outside.join("keep").exists(), "a file outside the cache was deleted");
        assert!(linked, "could not make a link to test with");
        if linked {
            assert!(!cache.join("link").exists());
            // A link standing in for the cache folder itself is not walked either.
            #[cfg(windows)]
            let root_linked = junction(&outside, &base.join("rootlink"));
            #[cfg(not(windows))]
            let root_linked = std::os::unix::fs::symlink(&outside, base.join("rootlink")).is_ok();
            assert!(root_linked);
            assert_eq!(real_dir(base.join("rootlink")), None);
        }
        assert_eq!(real_dir(cache.clone()), Some(cache.clone()));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn the_write_check_never_touches_existing_files_and_nesting_is_seen() {
        let base = std::env::temp_dir().join(format!("quackify-probe-{}", std::process::id()));
        std::fs::create_dir_all(base.join("a").join("b")).unwrap();
        std::fs::write(base.join("keep"), b"precious").unwrap();
        probe_write(&base).unwrap();
        assert_eq!(std::fs::read(base.join("keep")).unwrap(), b"precious");
        assert_eq!(std::fs::read_dir(&base).unwrap().count(), 2, "the probe file was left behind");
        assert!(nested(&base.join("a"), &base.join("a").join("b")));
        assert!(nested(&base.join("a").join("b"), &base.join("a")));
        assert!(!nested(&base.join("a"), &base.join("keep")));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn restoring_the_cache_folder_keeps_other_changes() {
        let store = Store {
            file: None,
            current: Mutex::new(Settings { cache_parent: Some("E:\\New".into()), ..Settings::default() }),
            cache_problem: Mutex::new(None),
            cache_move: tokio::sync::Mutex::new(()),
        };
        // Changed meanwhile: kept.
        store.set(Settings { device_name: "Sala".into(), ..store.get() }).unwrap();
        assert!(store.restore_cache_parent(&Some("E:\\New".into()), None).unwrap());
        assert_eq!(store.get().cache_parent, None);
        assert_eq!(store.get().device_name, "Sala");
        // Another move got there first: left alone.
        store.set(Settings { cache_parent: Some("F:\\Other".into()), ..store.get() }).unwrap();
        assert!(!store.restore_cache_parent(&Some("E:\\New".into()), None).unwrap());
        assert_eq!(store.get().cache_parent.as_deref(), Some("F:\\Other"));
    }

    #[test]
    fn a_folder_that_is_not_there_is_refused() {
        let missing = std::env::temp_dir().join("quackify-no-such-folder").join("deeper");
        assert!(check_writable(&missing).is_err());
        let ok = std::env::temp_dir().join(format!("quackify-cache-pick-{}", std::process::id()));
        std::fs::create_dir_all(&ok).unwrap();
        assert!(check_writable(&ok).is_ok());
        assert!(ok.join(CACHE_FOLDER_NAME).is_dir());
        let _ = std::fs::remove_dir_all(&ok);
    }

    #[test]
    fn new_fields_default_and_device_name_is_never_empty() {
        let s: Settings = serde_json::from_str(r#"{ "quality": "high" }"#).unwrap();
        assert!(s.gapless && s.audio_cache && s.start_minimized);
        assert_eq!(s.cache_size_gb, 2);
        assert_eq!(Settings { device_name: "   ".into(), ..s.clone() }.device_name(), "Quackify");
        assert_eq!(Settings { device_name: " Sala ".into(), ..s.clone() }.device_name(), "Sala");
        assert_eq!(Settings { cache_size_gb: 7, ..s.clone() }.cache_limit_bytes(), 2 * 1024 * 1024 * 1024);
        assert!(s.player_differs(&Settings { device_name: "Sala".into(), ..s.clone() }));
        assert!(!s.player_differs(&Settings { start_minimized: false, close_to_tray: false, ..s.clone() }));
        assert!(s.cache_parent.is_none());
        assert!(s.player_differs(&Settings { cache_parent: Some("E:\\Cache".into()), ..s.clone() }));
    }

    #[test]
    fn only_audio_changes_rebuild_the_player() {
        let a = Settings::default();
        assert!(!a.player_differs(&Settings { close_to_tray: false, ..a.clone() }));
        assert!(a.player_differs(&Settings { quality: Quality::Normal, ..a.clone() }));
        assert!(a.player_differs(&Settings { autoplay: false, ..a.clone() }));
    }
}
