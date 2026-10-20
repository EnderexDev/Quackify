// The app's settings, kept in settings.json next to the login cache. The Settings page reads
// and writes them; the player and the tray read them.
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

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
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            close_to_tray: true,
            quality: Quality::default(),
            normalize: true,
            loudness: Loudness::default(),
            autoplay: true,
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
    }
}

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

    /// Saves `settings`; the previous ones come back.
    pub fn set(&self, settings: Settings) -> Result<Settings, String> {
        if let Some(file) = &self.file {
            if let Some(dir) = file.parent() {
                std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
            }
            let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
            std::fs::write(file, json).map_err(|e| e.to_string())?;
        }
        Ok(std::mem::replace(&mut *self.current.lock().unwrap(), settings))
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
    if before.player_differs(&settings) {
        crate::spotify::reconnect(&app).await?;
    }
    Ok(())
}

#[tauri::command]
pub fn settings_set_start_with_windows(app: AppHandle, on: bool) -> Result<bool, String> {
    crate::desktop::set_start_with_windows(&app, on)
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

    #[test]
    fn only_audio_changes_rebuild_the_player() {
        let a = Settings::default();
        assert!(!a.player_differs(&Settings { close_to_tray: false, ..a.clone() }));
        assert!(a.player_differs(&Settings { quality: Quality::Normal, ..a.clone() }));
        assert!(a.player_differs(&Settings { autoplay: false, ..a.clone() }));
    }
}
