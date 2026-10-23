mod connect;
mod desktop;
mod discord;
mod jam;
mod links;
mod listening;
mod media;
mod meter;
mod mini;
mod pathfinder;
mod settings;
mod spotify;
#[cfg(windows)]
mod thumbbar;
mod variant;
mod waveform;
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
        .manage(discord::Discord::default())
        .setup(|app| {
            let hashes = app
                .path()
                .app_data_dir()
                .ok()
                .map(|dir| dir.join("pathfinder-hashes.json"));
            app.manage(pathfinder::Pathfinder::new(hashes));
            // Before the tray and the player, which read it.
            app.manage(settings::Store::load(app.handle()));
            // After the settings, which the player reads.
            spotify::restore_early(app.handle());
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title(&variant::name(app.handle()));
            }
            // Before the window first shows, so its taskbar button is heard being made.
            #[cfg(windows)]
            thumbbar::setup(app.handle());
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
        .on_window_event(|window, event| match window.label() {
            mini::LABEL => mini::on_window_event(window, event),
            _ => desktop::on_window_event(window, event),
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
            spotify::spotify_edit_queue,
            spotify::spotify_song_radio,
            spotify::spotify_user_profile,
            spotify::spotify_create_playlist,
            spotify::spotify_edit_playlist,
            spotify::spotify_rootlist_change,
            spotify::spotify_rootlist_has,
            spotify::spotify_lyrics,
            spotify::spotify_waveform,
            jam::jam_current,
            jam::jam_start,
            jam::jam_stop,
            discord::discord_presence,
            settings::settings_get,
            settings::settings_set,
            settings::settings_set_start_with_windows,
            settings::settings_set_language,
            settings::settings_cache_size,
            settings::settings_clear_cache,
            settings::settings_cache_folder,
            settings::settings_pick_folder,
            settings::settings_set_cache_folder,
            links::links_take,
            links::links_status,
            links::links_choose,
            webplayer::web_player_open,
            webplayer::web_player_close,
            mini::mini_player_toggle,
            mini::mini_player_open,
            mini::mini_player_close,
            mini::mini_player_is_open,
            mini::mini_player_on_top,
            mini::mini_player_show_main,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
