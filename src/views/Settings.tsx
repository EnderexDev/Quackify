// Settings: audio (quality, normalization), playback (autoplay) and the desktop (tray, startup).
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { toast } from "../state/toast";
import { Loading } from "./common";

type Quality = "normal" | "high" | "very_high";
type Loudness = "quiet" | "normal" | "loud";
type Settings = {
  close_to_tray: boolean;
  quality: Quality;
  normalize: boolean;
  loudness: Loudness;
  autoplay: boolean;
  gapless: boolean;
  audio_cache: boolean;
  cache_size_gb: number;
  device_name: string;
  start_minimized: boolean;
  cache_parent: string | null;
};
type CacheFolder = { folder: string; custom: boolean; problem: string | null };
type View = { settings: Settings; start_with_windows: boolean };

const QUALITIES: { value: Quality; label: string }[] = [
  { value: "normal", label: "Normal (96 kbps)" },
  { value: "high", label: "High (160 kbps)" },
  { value: "very_high", label: "Very high (320 kbps)" },
];

const CACHE_SIZES = [1, 2, 5, 10, 20];

/** "1.4 GB", "230 MB". */
function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  return n > 0 ? `${Math.max(1, Math.round(n / 1024))} KB` : "Empty";
}

const LOUDNESS: { value: Loudness; label: string }[] = [
  { value: "loud", label: "Loud" },
  { value: "normal", label: "Normal" },
  { value: "quiet", label: "Quiet" },
];

type Account = { name: string; image: string | null; onLogout: () => void };

export function SettingsView({ account }: { account: Account }) {
  const [view, setView] = useState<View | null>(null);
  const [cacheBytes, setCacheBytes] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState("");
  const [folder, setFolder] = useState<CacheFolder | null>(null);
  const [moving, setMoving] = useState(false);
  const readCache = () => {
    invoke<number>("settings_cache_size").then(setCacheBytes, () => {});
    invoke<CacheFolder>("settings_cache_folder").then(setFolder, () => {});
  };
  useEffect(() => {
    readCache();
    getVersion().then(setAppVersion, () => {});
  }, []);
  // An audio change rebuilds the player; the controls wait for it.
  const [applying, setApplying] = useState(false);
  // Bumped by every save and read: an answer to an older read is dropped, so a read that was
  // already on its way cannot put back what a save just changed.
  const version = useRef(0);
  const load = () => {
    const asked = ++version.current;
    return invoke<View>("settings_get").then((v) => asked === version.current && setView(v), toast);
  };

  useEffect(() => {
    load();
    // The tray menu changes some of these too.
    const off = listen("settings-changed", load);
    return () => {
      off.then((f) => f());
    };
  }, []);

  if (!view) return <Loading />;
  const s = view.settings;

  const save = async (next: Partial<Settings>) => {
    version.current++;
    setView({ ...view, settings: { ...s, ...next } });
    setApplying(true);
    try {
      await invoke("settings_set", { settings: { ...s, ...next } });
    } catch (e) {
      toast(e);
    } finally {
      setApplying(false);
      // Show what is saved (also when applying failed after saving).
      await load();
    }
  };

  const setStartup = async (on: boolean) => {
    try {
      const now = await invoke<boolean>("settings_set_start_with_windows", { on });
      setView((v) => v && { ...v, start_with_windows: now });
    } catch (e) {
      toast(e);
    }
  };

  const clearCache = async () => {
    setClearing(true);
    try {
      setCacheBytes(await invoke<number>("settings_clear_cache"));
      toast("Cache cleared");
    } catch (e) {
      toast(e);
      readCache();
    } finally {
      setClearing(false);
    }
  };
  // Moving the cache rebuilds the player on the new folder and deletes the old cache.
  const moveCache = async (pick: boolean) => {
    const parent = pick ? await invoke<string | null>("settings_pick_folder") : null;
    if (pick && !parent) return;
    setMoving(true);
    try {
      setFolder(await invoke<CacheFolder>("settings_set_cache_folder", { parent }));
      toast(pick ? "Song cache moved" : "Song cache back in its default folder");
    } catch (e) {
      toast(e);
    } finally {
      setMoving(false);
      readCache();
      await load();
    }
  };
  const nameDraft = deviceName ?? s.device_name;
  const saveName = () => {
    const name = nameDraft.trim();
    setDeviceName(null);
    if (name && name !== s.device_name) save({ device_name: name });
  };

  return (
    <div className="page settings">
      <h1 className="page-title">Settings</h1>

      <section className="settings-group">
        <h2>Account</h2>
        <div className="settings-row">
          <div className="settings-account">
            {account.image ? <img className="avatar" src={account.image} alt="" /> : <span className="avatar">{account.name.slice(0, 1)}</span>}
            <div>
              <div className="settings-title">{account.name}</div>
              <div className="muted small">Logged in with Spotify Premium</div>
            </div>
          </div>
          <button className="secondary" onClick={account.onLogout}>
            Log out
          </button>
        </div>
      </section>


      <section className="settings-group">
        <h2>Audio quality</h2>
        <Row title="Streaming quality" note="Lossless is only played by Spotify's own apps: 320 kbps is the best Quackify can get.">
          <select value={s.quality} disabled={applying} onChange={(e) => save({ quality: e.currentTarget.value as Quality })}>
            {QUALITIES.map((q) => (
              <option key={q.value} value={q.value}>
                {q.label}
              </option>
            ))}
          </select>
        </Row>
        <Row title="Normalize volume" note="Set the same volume level for all songs.">
          <Toggle on={s.normalize} disabled={applying} onChange={(on) => save({ normalize: on })} />
        </Row>
        <Row title="Volume level" note="Adjust the volume for your environment. Loud may lower the dynamics.">
          <select
            value={s.loudness}
            disabled={applying || !s.normalize}
            onChange={(e) => save({ loudness: e.currentTarget.value as Loudness })}
          >
            {LOUDNESS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </Row>
      </section>

      <section className="settings-group">
        <h2>Playback</h2>
        <Row title="Autoplay" note="When your music ends, keep playing similar songs.">
          <Toggle on={s.autoplay} disabled={applying} onChange={(on) => save({ autoplay: on })} />
        </Row>
        <Row title="Gapless playback" note="Start the next song with no silence after the one ending, as albums are meant to be heard.">
          <Toggle on={s.gapless} disabled={applying} onChange={(on) => save({ gapless: on })} />
        </Row>
        <p className="muted small settings-note">
          {applying
            ? "Applying… Quackify reconnects to Spotify for this."
            : "Changing these reconnects Quackify for a moment. Music playing here picks up again by itself."}
        </p>
      </section>

      <section className="settings-group">
        <h2>Storage</h2>
        <Row
          title="Cache songs"
          note="Songs you play are kept on this computer, so playing them again starts at once and uses no data. The oldest go first when the cache is full."
        >
          <Toggle on={s.audio_cache} disabled={applying} onChange={(on) => save({ audio_cache: on })} />
        </Row>
        <Row title="Cache size" note="The most the cache may take on disk.">
          <select
            value={s.cache_size_gb}
            disabled={applying || !s.audio_cache}
            onChange={(e) => save({ cache_size_gb: Number(e.currentTarget.value) })}
          >
            {CACHE_SIZES.map((gb) => (
              <option key={gb} value={gb}>
                {gb} GB
              </option>
            ))}
          </select>
        </Row>
        <Row
          title="Cache folder"
          note={
            folder
              ? `${folder.folder}${folder.custom ? "" : " (default)"}. Changing it deletes the cache in the old folder.`
              : "…"
          }
        >
          <div className="settings-buttons">
            {folder?.custom && (
              <button className="secondary" disabled={moving || applying} onClick={() => moveCache(false)}>
                Use default
              </button>
            )}
            <button className="secondary" disabled={moving || applying || !s.audio_cache} onClick={() => moveCache(true)}>
              {moving ? "Moving…" : "Change folder…"}
            </button>
          </div>
        </Row>
        {folder?.problem && s.audio_cache && (
          <p className="settings-warning">Songs are not being cached: {folder.problem}. Pick another folder or use the default.</p>
        )}
        <Row title="Cache in use" note={cacheBytes === null ? "Measuring…" : formatBytes(cacheBytes)}>
          <button className="secondary" disabled={clearing || applying || !cacheBytes} onClick={clearCache}>
            {clearing ? "Clearing…" : "Clear cache"}
          </button>
        </Row>
      </section>

      <section className="settings-group">
        <h2>Spotify Connect</h2>
        <Row title="Device name" note="How this computer shows up in your other Spotify apps.">
          <input
            className="settings-input"
            value={nameDraft}
            maxLength={40}
            disabled={applying}
            onChange={(e) => setDeviceName(e.currentTarget.value)}
            onBlur={saveName}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </Row>
      </section>

      <section className="settings-group">
        <h2>Startup and window</h2>
        <Row title="Close button keeps Quackify in the tray" note="The music keeps playing; quit from the tray icon.">
          <Toggle on={s.close_to_tray} disabled={applying} onChange={(on) => save({ close_to_tray: on })} />
        </Row>
        <Row title="Start with Windows" note="Open Quackify when you log in to the computer.">
          <Toggle on={view.start_with_windows} onChange={setStartup} />
        </Row>
        <Row title="Start minimized" note="When it starts with Windows, Quackify waits in the tray instead of opening its window.">
          <Toggle on={s.start_minimized} disabled={applying} onChange={(on) => save({ start_minimized: on })} />
        </Row>
      </section>

      <section className="settings-group">
        <h2>About</h2>
        <p className="muted">
          Quackify {appVersion}. Not in Quackify yet: crossfade, the equalizer and mono audio (its player has none of
          them). Lossless audio and downloads for offline listening are only allowed in Spotify&apos;s own apps.
        </p>
      </section>
    </div>
  );
}

function Row({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <div>
        <div className="settings-title">{title}</div>
        <div className="muted small">{note}</div>
      </div>
      {children}
    </div>
  );
}

function Toggle({ on, onChange, disabled = false }: { on: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      className={`toggle ${on ? "on" : ""}`}
      disabled={disabled}
      onClick={() => onChange(!on)}
    >
      <span className="toggle-knob" />
    </button>
  );
}
