# Quackify

A yellow, duck-flavoured Spotify client for Windows, built from scratch to be fast, with our own features.

- UI: React + TypeScript (Vite)
- Shell and backend: Tauri 2 (Rust)
- Audio: librespot (Spotify Premium required)

## Install

Download [Quackify-Setup.exe](https://github.com/EnderexDev/Quackify/releases/latest/download/Quackify-Setup.exe)
and run it. After that Quackify updates itself: it looks for a new version when it starts and
every 6 hours, and Settings > About has a button to look now.

Windows may warn that the app is from an unknown publisher (Quackify is not code-signed):
More info, then Run anyway.

## Develop

```bash
npm install
npm run app:dev     # Quackify Dev
npm run app:build   # the official Quackify installer
```

Quackify Dev runs next to the installed Quackify without touching it: its own name and
identifier (`src-tauri/tauri.dev.conf.json`), so its own login, settings, cache, Connect device
and startup entry. It leaves spotify: links to the official app.

Requires Rust (rustup) and the MSVC Build Tools on Windows.

## Release

```bash
npm run release -- 0.2.0 "What changed"
```

Sets the version, builds the installer signed with `~/.tauri/quackify.key`, packs
`Quackify-Setup.exe` (Quackify's own installer window, `src-tauri/src/setup.rs`), pushes the
version to `main` and publishes the GitHub release with `latest.json`, which the installed apps read. The
key never goes in the repo; losing it means the apps out there can no longer be updated.
