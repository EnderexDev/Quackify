// The official app and the dev one (`npm run app:dev`) are two apps side by side: the dev build is
// made with tauri.dev.conf.json, another name and identifier, so it has its own data, login, device
// and startup entry, and can be run and broken without touching the music in the official one.
use tauri::{AppHandle, Runtime};

/// "Quackify", or "Quackify Dev": the name Windows, the tray and Spotify Connect show.
pub fn name<R: Runtime>(app: &AppHandle<R>) -> String {
    app.package_info().name.clone()
}

/// Whether this is the dev build.
pub fn is_dev<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.config().identifier.ends_with(".dev")
}
