mod connect;
mod pathfinder;
mod spotify;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(spotify::SpotifyState::default())
        .setup(|app| {
            let hashes = app
                .path()
                .app_data_dir()
                .ok()
                .map(|dir| dir.join("pathfinder-hashes.json"));
            app.manage(pathfinder::Pathfinder::new(hashes));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            spotify::spotify_status,
            spotify::spotify_restore,
            spotify::spotify_login,
            spotify::spotify_cancel_login,
            spotify::spotify_logout,
            spotify::spotify_query,
            spotify::spotify_play_context,
            spotify::spotify_play_tracks,
            spotify::spotify_pause,
            spotify::spotify_resume,
            spotify::spotify_next,
            spotify::spotify_previous,
            spotify::spotify_seek,
            spotify::spotify_set_volume,
            spotify::spotify_set_shuffle,
            spotify::spotify_set_repeat,
            spotify::spotify_player_state,
            spotify::spotify_transfer,
            spotify::spotify_add_to_queue,
            spotify::spotify_tracks,
            spotify::spotify_skip_to,
            spotify::spotify_create_playlist,
            spotify::spotify_edit_playlist,
            spotify::spotify_rootlist_change,
            spotify::spotify_rootlist_has,
            spotify::spotify_lyrics,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
