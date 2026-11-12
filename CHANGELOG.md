# Changelog

All notable changes to Quackify are listed here, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Each version is a tag and a GitHub
release of this repo; its section here is that release's notes. A change a user notices adds its
line under [Unreleased], and `npm run release` turns that section into the version.

## [Unreleased]

## [1.0.6] - 2026-11-12

### Changed
- Home: Spotify's one-card sections ("Made For You" four times, "Fans of X", "Similar to Y") are merged by title, and cards still short of three go into one "More for you" row that says why Spotify picked each card (31 rows to 12 on a real Home). Rows keep their place: a newer Home from Spotify replaces the one on screen only within 2 s of it showing, otherwise on the next visit.

## [1.0.5] - 2026-11-10

The app shows its own logo, the 3-bar equalizer, everywhere the duck used to stand in for it.

### Changed
- **logo:** the installer and update window, Settings > About, the connecting screen, the login screen, the Spotify Free web player bar and the top bar show the equalizer logo (gold, green in Quackify Dev). The icons are 256 px now, so the logo stays sharp on scaled screens.
- **empty pages and mini player:** empty pages show the logo on their two tilted cards, and the mini player puts it in the cover's place when a song has no cover. The duck is gone from the app.

## [1.0.4] - 2026-11-09

Songs without lyrics on Spotify get them from LRCLIB or NetEase, and the Home titles come in the app's language.

### Added
- **lyrics:** when Spotify has no lyrics for a song, or its lyrics call fails, the app looks the song up on LRCLIB and NetEase Cloud Music at the same time. Synced lyrics come first, then plain ones. A hit only counts when its length is within 3 s of the song's, the title matches once both are cleaned (accents, " - Remastered", "(feat. X)") and one artist matches as a whole name, so "Queen" does not match "Queen Latifah". The song page credits the source. Lyrics Spotify already has stay as they are (`spotify_lyrics`).

### Changed
- **Home:** the section titles and the greeting ("Tocados recentemente", "Boa tarde") come in the app's language. Before, they came in English with the app in Portuguese.
- **mini player:** with the lyrics on, a song with no lyrics (an instrumental, an episode) keeps the compact card with a line under the artists saying it has no lyrics. The window grows again when a song with lyrics comes. If the lyrics fail to load, the card stays tall to show Try again (`MiniPlayer.tsx`, `mini.rs`).

### Fixed
- **like button:** each unlike left one more heart in the button, which stacked them. The heart and its sparks shared the same React key (`LikeButton.tsx`).

### Internal
- **builds:** the Rust crate builds only as an rlib, and dev builds keep line tables only. A one-line dev rebuild went from 15.6 s to 6.5 s. Release builds keep LTO, so the shipped exe is built the same way as 1.0.3.

### Tested
- **lyrics:** `cargo test` (55 pass), a network test against both sources, and the real app on 46 searched songs. Spotify's lyrics came back as before; a Tim Maia and an Amália Rodrigues song came back synced from LRCLIB, two anime openings from NetEase, in about 1 s.
- **Home:** Quackify Dev's Home in Portuguese showed "Boa tarde", "Sextou!" and "Lançamentos de sexta só pra você".
- **like button:** a script with React 19 and jsdom, 6 clicks: the old code went from 1 to 4 hearts, the new one kept 1.
- **mini player:** `tsc`, `cargo check` and the release build pass. Not seen running: the window growing and shrinking between a song with lyrics and one without.

## [1.0.3] - 2026-11-03

After the connection to Spotify drops, play and skip pick the music back up instead of doing nothing.

### Fixed
- **player:** when the connection to Spotify dropped (the server closed it, an internet blip, the PC waking up), the app reconnected but came back with no device active. librespot then ignores every command but a load and still answers that it was sent, so play showed the song playing with no sound, and skip and pause did nothing, until you picked another song. Now play, skip and previous load the last playback on this device where it stopped, in its album or playlist. Seek, shuffle and repeat are kept for the next play (`connect.rs`).
- **reconnect:** if the music was playing here when the connection dropped, it comes back by itself after reconnecting, unless another device took it meanwhile (`spotify.rs`).
- **paused for a long time:** Spotify also lets a paused device go after a while, which leaves the same state, so the same fix should cover it. Not tested, since it cannot be forced on demand.

### Tested
- On Quackify Dev, with a firewall rule cutting only that app off the network for 15 s (its open connections closed too): while playing, the music came back by itself where it stopped; while paused, play resumed where it was and skip went to the next song.

## [1.0.2] - 2026-11-01

A new app icon with 3 thick bars, and the same icon in the app's top bar instead of the duck.

### Changed
- **icon:** the logo is now the equalizer with 3 thick bars at every size, instead of 5 bars at the large sizes. The app, the installer, the taskbar and the tray show it. Every size in `src-tauri/icons` is regenerated from the new 1024 master, with the same transparent rounded corners as 1.0.1.
- **top bar:** the mark beside "Quackify" is the app icon instead of the duck. The duck stays on the login, the empty screens and the mini player.

### Internal
- **Quackify Dev:** `npm run app:dev` builds Quackify Dev with a green icon (`src-tauri/icons-dev`, set in `tauri.dev.conf.json`), a green accent and the green icon in the top bar, so the two apps are easy to tell apart. The official app does not change.
- **release:** `package-lock.json` still reads 1.0.0. The release script does not bump it.

## [1.0.1] - 2026-11-01

A new app icon, and a dropped Spotify session reconnects by itself when the app opens.

### Added
- **icon:** the app, the installer and the taskbar show the new icon, a gold equalizer. Every size in `src-tauri/icons` is regenerated from the 1024 master. The 16 and 32 px layers of `icon.ico` and `32x32.png` use the simplified 3-bar drawing. The corners around the rounded square are transparent, so no dark box shows on a light taskbar, in Explorer or in Alt-Tab.
- **favicon:** the window page uses `public/favicon.png` (32 px) instead of the Vite logo (`public/vite.svg`, removed).

### Fixed
- **login:** when the app opened and found the saved Spotify session dead, it showed the login screen though the saved credentials still worked. It now connects again with them (`spotify.rs`). If that connect fails (no network yet), the old session stays in place so the next retry still runs.

### Internal
- **release:** `package-lock.json` carries 1.0.0 since `463e93f`. The release script does not bump it, so it still reads 1.0.0 inside this tag.
- **icons:** a stray sync-conflict copy of `icon.ico` came in with the icon commit and was removed in `2b27b1d`.

## [1.0.0] - 2026-10-28

The first official version number. The app is the same as 0.3.4: the only difference is the version string.

### Changed
- **version:** the version reported by the app, the installer and the updater goes from 0.3.4 to 1.0.0. `git diff v0.3.4 v1.0.0` touches exactly four lines, one each in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` and `src-tauri/tauri.conf.json`. No source, style, config or dependency changed.

### Internal
- **release:** `package-lock.json` was not bumped and still reads 0.3.1 inside this tag. It was set to 1.0.0 afterwards, in `463e93f`, which is not part of the tag.

## [0.3.4] - 2026-10-28

The sung lyric line is no longer cut off in the mini player and on the song page.

### Fixed
- **lyrics:** the sung line is scaled up from the left, so a sentence that filled the box's width overflowed it and was cut. Every line now wraps at the width that still fits once scaled, in the mini player (`mini.css`) and on the song page (`song.css`).

## [0.3.3] - 2026-10-28

Discord presence starts on again for new installs, undoing the default change from 0.3.2.

### Changed
- **discord:** the "show what is playing on Discord" setting starts on for new installs again. `discord_presence` defaults to `true` in `settings.rs`, as it did up to 0.3.1; 0.3.2 had made it `false`.

## [0.3.2] - 2026-10-28

Getting ready to share the app: a log file, a crash screen, a way to report a problem, and a clearer login error.

### Added
- **logs:** warnings, panics and webview errors go to a log file in `%LOCALAPPDATA%\<identifier>\logs` (1 MB per file, the last 3 kept, local time). A panic hook writes to the file before the process aborts, and the webview's `error` and `unhandledrejection` events go to the same file (`src-tauri/src/logs.rs`, `src/state/problems.ts`). The Rust side's `eprintln!` calls became `log::warn!` and `log::info!`.
- **crash screen:** a render error in any window now shows "Something broke in Quackify" with `Reload`, `Report a problem`, `Open log folder` and `Copy details`, instead of a blank window. The installer window shows only `Reload` and `Copy details`.
- **settings:** Settings > About has "Something wrong?" with `Open log folder` and `Report a problem`. `Report a problem` opens a new GitHub issue with the version and Windows version filled in, plus the crash detail when it comes from the crash screen.
- **login:** when port 8898 is taken by another program, the login says so ("Close other Spotify apps like spotifyd or ncspot and try again") instead of showing the raw bind error.
- **repo:** MIT license, and a GitHub Actions `Check` workflow on every push to `main` and every pull request (Windows: `npm run build`, `npm run i18n:check`, `cargo test --locked`). The README now covers Windows Defender holding or quarantining a new unsigned download, the Premium requirement and that Quackify is unofficial.

### Changed
- **discord:** the presence switch starts off on new installs.

### Fixed
- **logout:** logout failed silently when the saved credentials could not be deleted but `exists()` said no. Only a file that is really not there counts as deleted now; any other error fails the logout and keeps the session.
- **report a problem:** the issue's detail is cut to its first 3000 code points and then until the encoded URL fits 6000 characters, so GitHub no longer turns the link away and an emoji is never split in half (half an emoji made `encodeURIComponent` throw).

## [0.3.1] - 2026-10-28

Version bump only, no code change. It is the first update an installed 0.3.0 can take through the new update window.

### Internal
- **release:** `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` and `src-tauri/tauri.conf.json` go from 0.3.0 to 0.3.1. Nothing else differs between the two tags.

## [0.3.0] - 2026-10-28

Quackify gets its own installer and its own update window, replacing the plain NSIS wizard and the in-app download.

### Added
- **installer:** `Quackify-Setup.exe` is now `quackify.exe` with the NSIS installer appended (plus a trailer with the installer's length and the marker `QKSETUP1`). Finding that trailer in its own file, the exe opens a 560x440 frameless window in Quackify's look with the install folder, a desktop shortcut option, `Install` and `Open Quackify`, and runs the NSIS installer silently underneath (`src-tauri/src/setup.rs`, `src/components/Setup.tsx`). The default folder is the one of the last install, else `%LOCALAPPDATA%\Quackify`. The release script packs and uploads it (`scripts/pack-setup.mjs`).
- **updater:** an update copies the app to the temp folder as `Quackify-Updater.exe`, which shows the download in a Quackify window, checks the signature against the key in `tauri.conf.json` and runs NSIS with `/UPDATE /R`, then NSIS opens the new Quackify. The copy runs from the temp folder because NSIS overwrites the install folder, and under another name because NSIS closes every `quackify.exe` before it starts.

### Changed
- **updater:** `Update to {version}` in Settings > About no longer downloads inside the app. It closes Quackify and hands over to the update window ("Opening the update window…" while it starts). The in-app percent display is gone.
- **download:** the README links `Quackify-Setup.exe` directly and tells users that Windows may warn about an unknown publisher, because Quackify is not code-signed (More info, then Run anyway).

### Fixed
- **installer:** after a failed install, the folder and shortcut options stay on screen, so a folder that could not be written to can be changed before trying again.
- **installer:** the installer file NSIS runs is reopened sharing only reads and compared with the bytes the updater verified, so nothing can swap it between the signature check and the run.

### Internal
- **updater:** the `process` plugin and its `process:allow-restart` permission are removed; `src-tauri/capabilities/setup.json` gives the setup window `core:default` and window dragging only.
- **setup:** the setup window keeps its own WebView2 data in the temp folder (`Quackify-Setup-WebView`), so a first install can run while Quackify is open.
- **release:** `scripts/release.mjs` packs and uploads `Quackify-Setup.exe` next to the NSIS installer, its `.sig` and `latest.json`.

## [0.2.1] - 2026-10-28

Two fixes in the in-app updater and a safer release script.

### Fixed
- **updater:** a check that landed while an update was downloading could close the `Update` being downloaded. Each check now closes the `Update` it replaces, and `installUpdate` only runs from the "available" state, so a check still in flight can no longer pull the download out from under it (`src/state/update.ts`).
- **updater:** a check that failed threw away the version found earlier, so the `Update` button in the notice stopped working. A failed check now keeps the version found and stays on "available"; the error toast still shows.

### Changed
- **updater:** during a download, Settings re-renders only when the shown percent changes, instead of on every chunk.

### Internal
- **release:** when the build, the missing artifacts or the commit fail, `scripts/release.mjs` puts `package.json`, `tauri.conf.json`, `Cargo.toml` and `Cargo.lock` back (`git checkout`), so the next try does not stop at "the tree has changes".
- **release:** a second run after a failed push or release finds the version already committed and skips the commit instead of failing on an empty one.

## [0.2.0] - 2026-10-28

First tagged release: a Tauri 2 desktop client for Spotify (librespot playback, Spotify Connect device, Figma-based redesign) that updates itself from GitHub releases.

### Added
- **login:** OAuth login in the browser through librespot (redirect `127.0.0.1:8898`, scope streaming). Credentials are cached in the app data dir and restored on start. A pending login can be cancelled and times out after 5 minutes. Logout deletes the cached credentials before dropping the session.
- **free accounts:** Spotify turns Free accounts away at the login ("Travel restriction"). The login screen says so and offers Spotify's web player inside Quackify's own window, under a Quackify bar with `Log in with Premium`. The choice is kept for the next start.
- **connect:** Quackify is a Spotify Connect device ("Quackify", type Computer) through `librespot-connect`. Commands go to whichever device is active (Spirc when it is this app, connect-state commands otherwise); playback can be pulled to or pushed from this computer. The picker always lists "This computer", and a "Playing on X" pill with `Play here` shows when another device plays. The pill can be closed and then waits as a dot on the devices button.
- **connect:** each install keeps its Connect device id in `librespot/device_id`, so a restart comes back as the same device. A remote command that gets a 404 re-reads the cluster and is sent once more to the device playing now (changing the volume of a restarted Quackify used to fail with "Requested entity was not found").
- **connect:** a dropped Spotify connection (network blip, PC sleep, server closing it) logs back in by itself with the saved login, retrying at 2, 5, 15, 30 and 60 s. Before this the device stayed missing from the account until the app was reopened.
- **playback:** now-playing follows this device's own player for 10 s after a local song change, so a lagging Connect cluster read no longer leaves the bar one song behind (3:13/3:13 with the old name). When the last song of a context ends, the bar shows paused at 0:00 and `Play` starts it again.
- **playback:** `Play` on a list with shuffle on starts on a random song and keeps shuffle and repeat (librespot's load used to reset them).
- **library:** hearts on the player and track rows save to Liked Songs; albums and playlists get Save, artists and profiles get Follow. Changes are optimistic with rollback, read in batches of 50.
- **playlists:** create from `+` (default name "My Playlist #N" with the next free N), edit details, delete, add songs, remove a row, reorder by drag and drop. One New playlist dialog serves every entry point (Ctrl N, the `+` buttons, the library page, the palette, the songs' menus) with a name, a description and "Also add" for the songs it came from. A retry after a failure never creates a second playlist.
- **menus:** right-click menus on songs, cards, Home shortcuts and Continue tiles: add to queue, add to playlist, like, go to artist or album, copy link, Pin or Unpin, Go to song radio, Show credits (grouped like Spotify's, with the label), Share (copy link, embed track). Every item has an icon. The browser's own right-click menu is cancelled everywhere except in text fields.
- **queue:** queue panel with a Queue / History segment. Groups: Now playing, "From your queue" (with Shuffle and Clear), "From <album or playlist>" (with "track 2 of 9" and Skip), and "After" for autoplay. Remove a song (hover `×` or menu), drag to reorder, `Clear queue`. History keeps the last 50 songs played for 3 s or more, across restarts.
- **queue:** edits are serialized and carry the song as well as its uid, since librespot hands out new uids on every queue change. A song added while an edit is running is no longer lost, and songs added in a row show up in the panel.
- **selection:** Click, Ctrl+click, Shift+click, Ctrl+A and Escape select songs in any list. The context menu, Delete and dragging act on every selected song. A bar floats over the list with the count, Play, Queue, Add to playlist and Like or Unlike.
- **drag and drop:** while songs, cards or library items are dragged, the player bar turns into two drop zones: "Play next, right after <song>" and "Add to the end of the queue". Albums, playlists, Liked Songs and artists can be dragged as a whole (100 songs at most for the queue). Songs dropped on a playlist or Liked Songs in Your Library are added.
- **peek:** holding a card, pinned cover, tree item or library row still for 400 ms (or Space on a focused card) opens a preview with Play, Save or Follow, Queue, More and the first 6 songs.
- **search:** tabs All, Songs, Artists, Albums, Playlists, Podcasts, Episodes and Profiles (40 results at a time on scroll). Opening a result saves a recent search. A command palette (Ctrl K, Ctrl L or Ctrl T) shows recent searches and up to 5 results, with `>` for app commands and Ctrl Enter for every result.
- **explore:** Explore page with mood chips (Focus, Workout, Sleep, Party, Chill, Travel) and Browse all grouped into Genres, Mood and moment, and Discover. Genre pages open with a band in the tile's color. "Show all" loads a whole row as you scroll and says where the row came from.
- **home:** every shelf scrolls sideways (arrows, mouse drag, trackpad, snapping to whole cards). `Customize home` hides, pins, reorders and adds rows, saved on this computer. The greeting carries your first name. The last session's Home is kept on disk and shows at once on the next start.
- **home:** `Continue` lists episodes, albums, playlists and Liked Songs left halfway ("Track 5 of 9" with a bar, "Shuffling" when shuffled). `For now` shows what you usually play around this hour on this kind of day, built from a local listening history. Until the history spans 7 days it stays out and Spotify's grid stays on top, then the grid moves to a "Your shortcuts" row.
- **artists:** artist page with Overview (Popular with play counts, Artist's pick, About), Discography (cards or a list whose albums open into their songs, newest first) and About (photo, world rank, monthly listeners, followers, biography, top cities). Also "Fans also like" and "Appears On".
- **podcasts:** show page (cover, publisher, rating, topics, Follow, episodes 50 at a time with date, time left and a progress line) with All, Unplayed and In progress filters and a search over the episodes. Episode page with the full description. Library gets a Podcasts filter and search shows Podcasts and Episodes. Episodes show in the player bar, queue, song page and Windows media flyout. NEW stays for a week until played.
- **profiles:** profile pages with public playlists, followers, following and recent artists. Yours adds top artists and top tracks of the month, marked "only you see this".
- **library:** Your Library as a sidebar tree (pinned items as covers, one row per kind with its count, "See all N", folders as sub-levels) and as a full page per kind and per folder, in List, Compact or Grid, with sort (Recents, Recently added, Alphabetical, Creator), grouping and search. Sort, view and pins are kept. Artists have no Creator sort because Spotify answers nothing for it.
- **lists:** playlists and Liked Songs can be searched and sorted (custom order, date added, title, artist, album, duration) after the rest of the list loads; Liked Songs of 1711 took about 7 s. A Date added column ("Today", "2 days ago", "1 week ago"), a shuffle button and a ••• menu on playlists, albums, artists and podcasts.
- **lyrics:** synced lyrics light up the sung line and keep it in view; clicking a line seeks to it. Songs without lyrics say so. The song page has the big cover over a strong aura, Like, Add to playlist, Credits, Follow and the lyrics in S / M / L. Settings > Appearance picks the sung line under the song name, a popup, both (default) or off.
- **player:** glass player bar in the two colors of the cover playing, greyed while paused. Volume wheel moves 5%, the percent is typeable (Enter sets, Escape cancels), and the curve is librespot's default one, as in Spotify's own apps.
- **episodes:** back and forward 15 s and a sleep timer (15, 30, 60 minutes, end of episode) replace shuffle and repeat. The timer is also in the song menu for music. Speed is behind `EPISODE_SPEED=false` because librespot 0.8 has no playback speed.
- **progress bar:** Settings > Progress bar picks Simple (default), Wave or Live. Wave fetches the song's smallest Ogg file (96 kbps, about 2 MB), decodes it and draws 120 bars of loudness up front, lighting up as it plays (`waveform.rs`; songs only, an episode's bar learns while it plays). Live draws mirrored bars from the sound as it leaves the speakers, with a frame rate setting of 30, 60 (default), 120 or the screen's rate. Both need Quackify's own audio output (`meter.rs`, a librespot sink on cpal).
- **mini player:** a 330x162 frameless, always-on-top window out of the taskbar, with cover, song, sung line, progress bar, like, previous, play, next, lyrics, pin and close. It snaps to the work area's edges, remembers where it was, and opens from the player bar, the avatar menu, Ctrl M, the palette and the tray. The mic switches to a taller 220 px version with three lyric lines.
- **cinema mode:** full screen over the strong aura with the cover as a disc and five lines of synced lyrics, "Up next" in the last 20 s. F11, the avatar menu or the palette enter it; Esc leaves. Optionally it opens by itself after 5 minutes idle while music plays (Settings > Appearance).
- **windows:** media flyout and media keys drive whichever device plays. Tray icon (tooltip: the song) with play/pause, next, previous, close to tray, start with Windows and quit. Closing hides to the tray and the music keeps playing. A second launch brings the running window back. Taskbar thumbnail buttons for previous, play/pause and next (`thumbbar.rs`).
- **links:** Quackify registers for `spotify:` links for the current user at every start. Settings has a Spotify links section that opens Windows' default apps page. A link clicked while Quackify runs opens the page; a song opens on its album. `spotify://`, `spotify:user:NAME:playlist:ID`, `?si=` codes and `open.spotify.com` links are understood.
- **settings:** a page with an index and glass cards: Account, Appearance (theme System / Dark / Light, lyrics in the player, cinema, Reduce animations, Language), Progress bar, Audio, Playback, Storage, Spotify Connect, Spotify links, Window and About. Streaming quality 96/160/320 kbps (default 320), volume normalization with quiet/normal/loud (on by default), autoplay, gapless (on by default), device name, close to tray, start with Windows in the tray or with the window open, compact library.
- **cache:** songs played are cached on disk (on by default, 1 to 20 GB, 2 GB by default), with a measured size and `Clear cache`. `Change folder…` uses a "Quackify audio-cache" subfolder. The folder is checked for writes, nested folders and links are refused, and a failed move puts the previous folder back.
- **language:** the whole app in English or Portuguese (533 entries at the time), set in Settings > Appearance as System, English or Portuguese. Dates, numbers, the tray menu and the browser page after login follow it.
- **motion and states:** pages rise in 300 ms, a like springs with six sparks, toasts come as success, info and error with an optional action (`Open`, `Try again`). Loading is a page-sized skeleton; a failed page read is retried twice (after 1 s and 2 s) before "Couldn't load this page" with `Try again` and `Copy details`. Empty states, and an amber notice while Windows has no network. `Reduce animations` turns every animation into a 150 ms fade.
- **aura:** blurred blobs in the two colors of the cover playing, still when the window is hidden or unfocused or another device plays. Cover colors are capped at luminance 0.12, which raised white text on a bright yellow cover from 3.3 to 10.4 contrast.
- **jam:** start a Spotify Jam, copy the invite link, see members and leave or end it from the player (`jam.rs`). Friends' faces replace the icon while someone listens along.
- **discord:** "Listening to" presence through the local Discord IPC, with song, cover, time and `Listen on Spotify` and `Join the Jam` buttons (`discord.rs`). Resent every 15 s while playing, so a restarted Discord gets it back. Toggle in Settings, on by default.
- **listening history:** a switch, `Count plays on Spotify` in Settings > Spotify Connect, off by default. On, each song played is reported the way Spotify's own apps do (`listening.rs`), so Quackify's plays reach the account's recently played. The note says Spotify does not say whether unofficial apps may do this.
- **updater:** the main window asks `releases/latest/download/latest.json` 10 s after start and every 6 hours; Settings > About shows the state and checks on demand. Updates are signed and installed by NSIS in passive mode. Quackify Dev never checks.
- **dev app:** `npm run app:dev` starts Quackify Dev with its own name, identifier, login, settings, cache, Connect device and startup entry, so it runs beside the installed app and leaves `spotify:` links to it.
- **performance:** React re-renders only what changed. On a 2000-song playlist a cluster update went from 85 to 0.2 ms, a like from 84 to 1.6 ms and 10 volume steps from 835 to 2.1 ms (React profiling build, `bench/`). Idle CPU with nothing playing went from 9-12% to 0.1%, and the all-night state (song page, music elsewhere, unfocused, 165 Hz) from about 100% of a core to 6-7%. Home is on screen at 0.59-0.63 s against 2.2 s without the kept copies.
- **shortcuts:** Ctrl+arrows for next, previous and volume, Shift+arrows to seek 5 s, Ctrl+S shuffle, Ctrl+R repeat, Alt+Shift+B like, Ctrl+N new playlist, Ctrl+P settings, Alt+Shift+H home, Alt+Shift+Q queue, Alt+Shift+R now playing, Alt+Shift+J lyrics, Ctrl+B collapses Your Library, Ctrl+/ lists them all.

### Internal
- **runtime:** the Electron + electron-vite scaffold was replaced by Tauri 2 (Rust + React/TypeScript on Vite) before any feature landed. Identifier `dev.enderex.quackify`.
- **data:** pages read Spotify's internal GraphQL (pathfinder) with the session's login5 token, because the public Web API answers 429 for librespot's shared client id. A stale persisted-query hash (412) re-reads all hashes from the live web player bundle, saves them to `pathfinder-hashes.json` and retries once. `vergen` is pinned to 9.0.6 because librespot-core 0.8.0 does not build against 9.1.0.
- **styles:** `App.css` split into `styles/tokens.css`, `base.css`, `components/*.css` and `views/*.css`, with design tokens from the redesign spec.
- **i18n:** `npm run i18n:check` fails when a `t()` text lacks its Portuguese, placeholders differ or an entry is unused.
- **release:** `npm run release` builds, signs and publishes a version (`scripts/release.mjs`). `npm run app:build` makes the official installer (NSIS only).
- **tests:** `bench/` runs the app in a browser with Tauri mocked for React profiling. Rust tests cover the cluster parser, the meter, the waveform decoder, the Jam and Discord limits and the listening reports.

[Unreleased]: https://github.com/EnderexDev/Quackify/compare/v1.0.6...HEAD
[1.0.6]: https://github.com/EnderexDev/Quackify/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/EnderexDev/Quackify/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/EnderexDev/Quackify/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/EnderexDev/Quackify/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/EnderexDev/Quackify/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/EnderexDev/Quackify/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/EnderexDev/Quackify/compare/v0.3.4...v1.0.0
[0.3.4]: https://github.com/EnderexDev/Quackify/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/EnderexDev/Quackify/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/EnderexDev/Quackify/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/EnderexDev/Quackify/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/EnderexDev/Quackify/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/EnderexDev/Quackify/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/EnderexDev/Quackify/releases/tag/v0.2.0
