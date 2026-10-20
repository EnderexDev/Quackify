// Settings: audio (quality, normalization), playback (autoplay) and the desktop (tray, startup).
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toast } from "../state/toast";
import { Loading } from "./common";

type Quality = "normal" | "high" | "very_high";
type Loudness = "quiet" | "normal" | "loud";
type Settings = { close_to_tray: boolean; quality: Quality; normalize: boolean; loudness: Loudness; autoplay: boolean };
type View = { settings: Settings; start_with_windows: boolean };

const QUALITIES: { value: Quality; label: string }[] = [
  { value: "normal", label: "Normal (96 kbps)" },
  { value: "high", label: "High (160 kbps)" },
  { value: "very_high", label: "Very high (320 kbps)" },
];

const LOUDNESS: { value: Loudness; label: string }[] = [
  { value: "loud", label: "Loud" },
  { value: "normal", label: "Normal" },
  { value: "quiet", label: "Quiet" },
];

export function SettingsView() {
  const [view, setView] = useState<View | null>(null);
  // An audio change rebuilds the player; the controls wait for it.
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    const load = () => invoke<View>("settings_get").then(setView, toast);
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
    setView({ ...view, settings: { ...s, ...next } });
    setApplying(true);
    try {
      await invoke("settings_set", { settings: { ...s, ...next } });
    } catch (e) {
      toast(e);
      // The settings may be saved even if applying them failed: show what is saved.
      await invoke<View>("settings_get").then(setView, () => {});
    } finally {
      setApplying(false);
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

  return (
    <div className="page settings">
      <h1 className="page-title">Settings</h1>

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
        <p className="muted small settings-note">
          {applying
            ? "Applying… Quackify reconnects to Spotify for this."
            : "Changing these reconnects Quackify for a moment. Music playing here picks up again by itself."}
        </p>
      </section>

      <section className="settings-group">
        <h2>Desktop</h2>
        <Row title="Close button keeps Quackify in the tray" note="The music keeps playing; quit from the tray icon.">
          <Toggle on={s.close_to_tray} disabled={applying} onChange={(on) => save({ close_to_tray: on })} />
        </Row>
        <Row title="Start with Windows" note="Opens Quackify in the tray when you log in to the computer.">
          <Toggle on={view.start_with_windows} onChange={setStartup} />
        </Row>
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
