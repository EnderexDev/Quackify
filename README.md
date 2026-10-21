# Quackify

A yellow, duck-flavoured Spotify client for Windows, built from scratch to be fast, with our own features.

- UI: React + TypeScript (Vite)
- Shell and backend: Tauri 2 (Rust)
- Audio: librespot (Spotify Premium required)

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
