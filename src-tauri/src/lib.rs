mod connect;
mod desktop;
mod links;
mod media;
mod pathfinder;
mod settings;
mod spotify;
mod variant;
mod webplayer;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // First, so a second launch only brings this window back instead of starting a second device.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            desktop::show_window(app);
            // A spotify: link clicked while Quackify runs.
            links::handle_args(app, &args);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(spotify::SpotifyState::default())
        .setup(|app| {
            let hashes = app
                .path()
                .app_data_dir()
                .ok()
                .map(|dir| dir.join("pathfinder-hashes.json"));
            app.manage(pathfinder::Pathfinder::new(hashes));
            // Before the tray and the player, which read it.
            app.manage(settings::Store::load(app.handle()));
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title(&variant::name(app.handle()));
            }
            desktop::setup(app)?;
            links::setup(app);
            match media::Media::start(app.handle()) {
                Ok(media) => {
                    app.manage(media);
                }
                Err(e) => eprintln!("media: Windows media controls unavailable: {e}"),
            }
            Ok(())
        })
        .on_window_event(desktop::on_window_event)
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
            spotify::spotify_edit_queue,
            spotify::spotify_song_radio,
            spotify::spotify_user_profile,
            spotify::spotify_create_playlist,
            spotify::spotify_edit_playlist,
            spotify::spotify_rootlist_change,
            spotify::spotify_rootlist_has,
            spotify::spotify_lyrics,
            settings::settings_get,
            settings::settings_set,
            settings::settings_set_start_with_windows,
            settings::settings_cache_size,
            settings::settings_clear_cache,
            settings::settings_cache_folder,
            settings::settings_pick_folder,
            settings::settings_set_cache_folder,
            links::links_take,
            links::links_status,
            links::links_choose,
            webplayer::web_player_open,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
