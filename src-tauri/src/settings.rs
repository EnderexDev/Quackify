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
    /// Your Library as a compact list, without covers.
    pub compact_library: bool,
}

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
            compact_library: false,
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
}

impl Store {
    pub fn load(app: &AppHandle) -> Self {
        let file = app.path().app_data_dir().ok().map(|d| d.join("settings.json"));
        let current = file
            .as_ref()
            .and_then(|f| std::fs::read_to_string(f).ok())
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Self { file, current: Mutex::new(current) }
    }

    pub fn get(&self) -> Settings {
        self.current.lock().unwrap().clone()
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

/// Where songs are cached: the local (not roaming) app data, as it can grow to gigabytes.
pub fn audio_cache_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_local_data_dir().ok().map(|d| d.join("audio-cache"))
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
    fn new_fields_default_and_device_name_is_never_empty() {
        let s: Settings = serde_json::from_str(r#"{ "quality": "high" }"#).unwrap();
        assert!(s.gapless && s.audio_cache && s.start_minimized && !s.compact_library);
        assert_eq!(s.cache_size_gb, 2);
        assert_eq!(Settings { device_name: "   ".into(), ..s.clone() }.device_name(), "Quackify");
        assert_eq!(Settings { device_name: " Sala ".into(), ..s.clone() }.device_name(), "Sala");
        assert_eq!(Settings { cache_size_gb: 7, ..s.clone() }.cache_limit_bytes(), 2 * 1024 * 1024 * 1024);
        assert!(s.player_differs(&Settings { device_name: "Sala".into(), ..s.clone() }));
        assert!(!s.player_differs(&Settings { compact_library: true, start_minimized: false, ..s.clone() }));
    }

    #[test]
    fn only_audio_changes_rebuild_the_player() {
        let a = Settings::default();
        assert!(!a.player_differs(&Settings { close_to_tray: false, ..a.clone() }));
        assert!(a.player_differs(&Settings { quality: Quality::Normal, ..a.clone() }));
        assert!(a.player_differs(&Settings { autoplay: false, ..a.clone() }));
    }
}
