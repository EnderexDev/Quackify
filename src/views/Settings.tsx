// Settings (spec "Configurações"): an index of the sections on the left, each section a glass
// card: account, appearance, progress bar, audio, playback, storage, Connect, links, Discord,
// window, about.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { CheckIcon, DuckIcon } from "../components/icons";
import { Segmented } from "../components/Segmented";
import { Toggle } from "../components/Toggle";
import type { ProgressMode } from "../state/meter";
import { useNav } from "../state/nav";
import { cinemaAuto, liveFps, playerLyrics, type LiveFps } from "../state/prefs";
import { setTheme, useTheme } from "../state/theme";
import { setMotion, useMotion } from "../state/motion";
import { notify, toast  } from "../state/toast";
import { locale, setLang, t, useLangChoice } from "../i18n";
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
  progress_mode: ProgressMode;
  discord_presence: boolean;
};
type CacheFolder = { folder: string; custom: boolean; problem: string | null };
type View = { settings: Settings; start_with_windows: boolean };

// Lists of labels are functions: the text is picked when it is shown, in the language of the moment.
const qualities = (): { value: Quality; label: string }[] => [
  { value: "normal", label: t("Normal (96 kbps)") },
  { value: "high", label: t("High (160 kbps)") },
  { value: "very_high", label: t("Very high (320 kbps)") },
];

const CACHE_SIZES = [1, 2, 5, 10, 20];

/** "1.4 GB", "230 MB". */
function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  return n > 0 ? `${Math.max(1, Math.round(n / 1024))} KB` : t("Empty");
}

const loudness = (): { value: Loudness; label: string }[] => [
  { value: "loud", label: t("Loud") },
  { value: "normal", label: t("Normal") },
  { value: "quiet", label: t("Quiet") },
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
  const [linksHere, setLinksHere] = useState<boolean | null>(null);
  const theme = useTheme();
  const nav = useNav();
  const lyricsInPlayer = playerLyrics.use();
  const cinemaOn = cinemaAuto.use() === "on";
  const fps = liveFps.use();
  const motion = useMotion();
  const language = useLangChoice();
  const readCache = () => {
    invoke<number>("settings_cache_size").then(setCacheBytes, () => {});
    invoke<CacheFolder>("settings_cache_folder").then(setFolder, () => {});
  };
  useEffect(() => {
    readCache();
    getVersion().then(setAppVersion, () => {});
    // The choice is made in Windows' Settings: read it again on coming back to the window.
    const readLinks = () => invoke<boolean>("links_status").then(setLinksHere, () => {});
    readLinks();
    window.addEventListener("focus", readLinks);
    return () => window.removeEventListener("focus", readLinks);
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
      notify(t("Cache cleared"));
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
      notify(pick ? t("Song cache moved") : t("Song cache back in its default folder"));
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

  const linksNote =
    linksHere === null
      ? "…"
      : linksHere
        ? t("Quackify opens spotify: links, like the Open Spotify buttons on web pages. To give them back, pick Spotify under SPOTIFY in Windows' Settings.")
        : t("Windows asks you to choose the app yourself: pick Quackify under SPOTIFY on the page this opens.");

  return (
    <div className="page settings">
      <h1 className="page-title">{t("Settings")}</h1>
      <div className="settings-layout">
        <SettingsIndex />
        <div className="settings-cards">
          <Group id="account" title={t("Account")}>
            <div className="settings-row">
              <div className="settings-account">
                {account.image ? <img className="avatar" src={account.image} alt="" /> : <span className="avatar">{account.name.slice(0, 1)}</span>}
                <div>
                  <div className="settings-title">{account.name}</div>
                  <div className="muted small">{t("Connected with Spotify Premium")}</div>
                </div>
              </div>
              <div className="settings-buttons">
                <button className="pill-button" onClick={() => nav.go({ page: "user", uri: "me" })}>
                  {t("View profile")}
                </button>
                <button className="pill-button" onClick={account.onLogout}>
                  {t("Log out")}
                </button>
              </div>
            </div>
          </Group>

          <Group id="appearance" title={t("Appearance")}>
            <Row title={t("Theme")} note={t("System follows Windows' light or dark mode.")}>
              <Segmented
                label={t("Theme")}
                options={[
                  { id: "system", label: t("System") },
                  { id: "dark", label: t("Dark") },
                  { id: "light", label: t("Light") },
                ]}
                value={theme}
                onChange={setTheme}
              />
            </Row>
            <Row title={t("Language")} note={t("System follows Windows' language. Names from Spotify come in your account's language.")}>
              <Segmented
                label={t("Language")}
                options={[
                  { id: "system", label: t("System") },
                  // Each language in its own name, so it can be found from the other one.
                  { id: "en", label: "English" },
                  { id: "pt", label: "Português" },
                ]}
                value={language}
                onChange={setLang}
              />
            </Row>
            <Row title={t("Lyrics in the player")} note={t("The sung line under the song's name, a popup on the mic button, or both. Off, the mic opens the song page.")}>
              <Segmented
                label={t("Lyrics in the player")}
                options={[
                  { id: "off", label: t("Off") },
                  { id: "line", label: t("Line") },
                  { id: "popup", label: t("Popup") },
                  { id: "both", label: t("Both") },
                ]}
                value={lyricsInPlayer}
                onChange={playerLyrics.set}
              />
            </Row>
            <Row title={t("Reduce animations")} note={t("System follows Windows' animation effects. On, nothing loops and moves become a quick fade.")}>
              <Segmented
                label={t("Reduce animations")}
                options={[
                  { id: "system", label: t("System") },
                  { id: "on", label: t("On") },
                ]}
                value={motion}
                onChange={setMotion}
              />
            </Row>
            <Row title={t("Cinema mode by itself")} note={t("After 5 minutes without touching Quackify while music plays, go full screen with the cover and the lyrics. F11 opens it any time.")}>
              <Toggle on={cinemaOn} onChange={(on) => cinemaAuto.set(on ? "on" : "off")} />
            </Row>
          </Group>

          <Group id="progress" title={t("Progress bar")} note={t("How the player's bar shows the song. Wave and Live play through Quackify's own audio output, so going between Simple and them reconnects for a moment.")}>
            <div className="progress-choices" role="group" aria-label={t("Progress bar")}>
              {progressModes().map((m) => {
                const on = (s.progress_mode ?? "simple") === m.id;
                return (
                  <button
                    key={m.id}
                    aria-pressed={on}
                    className={`progress-choice ${on ? "on" : ""}`}
                    disabled={applying}
                    onClick={() => !on && save({ progress_mode: m.id })}
                  >
                    <span className={`progress-preview ${m.id}`} aria-hidden>
                      {m.id !== "simple" &&
                        PREVIEW_BARS.map((h, i) => <i key={i} style={{ height: `${m.id === "live" ? Math.min(100, h * 1.3) : h}%` }} />)}
                    </span>
                    <span className="progress-choice-title">
                      {m.label}
                      {on && (
                        <span className="progress-check">
                          <CheckIcon size={11} />
                        </span>
                      )}
                    </span>
                    <span className="muted small">{m.note}</span>
                  </button>
                );
              })}
            </div>
            {s.progress_mode === "live" && (
              <Row title={t("Live bars smoothness")} note={t("How many times a second the bars move. More is smoother and uses more of the processor; Screen follows your monitor.")}>
                <Segmented
                  label={t("Live bars smoothness")}
                  options={[
                    { id: "30", label: "30 fps" },
                    { id: "60", label: "60 fps" },
                    { id: "120", label: "120 fps" },
                    { id: "screen", label: t("Screen") },
                  ]}
                  value={fps}
                  onChange={(v: LiveFps) => liveFps.set(v)}
                />
              </Row>
            )}
          </Group>

          <Group id="audio" title={t("Audio")}>
            <Row title={t("Streaming quality")} note={t("Lossless is only played by Spotify's own apps: 320 kbps is the best Quackify can get.")}>
              <select aria-label={t("Streaming quality")} value={s.quality} disabled={applying} onChange={(e) => save({ quality: e.currentTarget.value as Quality })}>
                {qualities().map((q) => (
                  <option key={q.value} value={q.value}>
                    {q.label}
                  </option>
                ))}
              </select>
            </Row>
            <Row title={t("Normalize volume")} note={t("Set the same volume level for all songs.")}>
              <Toggle on={s.normalize} disabled={applying} onChange={(on) => save({ normalize: on })} />
            </Row>
            <Row title={t("Volume level")} note={t("Adjust the volume for your environment. Loud may lower the dynamics. Only with Normalize volume on.")} off={!s.normalize}>
              <Segmented
                label={t("Volume level")}
                className={applying || !s.normalize ? "disabled" : ""}
                options={loudness().map((l) => ({ id: l.value, label: l.label }))}
                value={s.loudness}
                onChange={(l) => !applying && s.normalize && save({ loudness: l })}
              />
            </Row>
          </Group>

          <Group id="playback" title={t("Playback")}>
            <Row title={t("Autoplay")} note={t("When your music ends, keep playing similar songs.")}>
              <Toggle on={s.autoplay} disabled={applying} onChange={(on) => save({ autoplay: on })} />
            </Row>
            <Row title={t("Gapless playback")} note={t("Start the next song with no silence after the one ending, as albums are meant to be heard.")}>
              <Toggle on={s.gapless} disabled={applying} onChange={(on) => save({ gapless: on })} />
            </Row>
            <p className="muted small settings-note">
              {applying
                ? t("Applying… Quackify reconnects to Spotify for this.")
                : t("Changing these reconnects Quackify for a moment. Music playing here picks up again by itself.")}
            </p>
          </Group>

          <Group id="storage" title={t("Storage")}>
            <Row
              title={t("Cache songs")}
              note={t("Songs you play are kept on this computer, so playing them again starts at once and uses no data. The oldest go first when the cache is full.")}
            >
              <Toggle on={s.audio_cache} disabled={applying} onChange={(on) => save({ audio_cache: on })} />
            </Row>
            <Row title={t("Cache size")} note={t("The most the cache may take on disk.")} off={!s.audio_cache}>
              <select
                aria-label={t("Cache size")}
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
              title={t("Cache folder")}
              note={
                folder
                  ? folder.custom
                    ? t("{folder}. Changing it deletes the cache in the old folder.", { folder: folder.folder })
                    : t("{folder} (default). Changing it deletes the cache in the old folder.", { folder: folder.folder })
                  : "…"
              }
            >
              <div className="settings-buttons">
                {folder?.custom && (
                  <button className="pill-button" disabled={moving || applying} onClick={() => moveCache(false)}>
                    {t("Use default")}
                  </button>
                )}
                <button className="pill-button" disabled={moving || applying || !s.audio_cache} onClick={() => moveCache(true)}>
                  {moving ? t("Moving…") : t("Change folder…")}
                </button>
              </div>
            </Row>
            {folder?.problem && s.audio_cache && (
              <p className="settings-warning">{t("Songs are not being cached: {problem}. Pick another folder or use the default.", { problem: folder.problem })}</p>
            )}
            <Row title={t("Cache in use")} note={cacheBytes === null ? t("Measuring…") : formatBytes(cacheBytes)}>
              <button className="pill-button" disabled={clearing || applying || !cacheBytes} onClick={clearCache}>
                {clearing ? t("Clearing…") : t("Clear cache")}
              </button>
            </Row>
          </Group>

          <Group id="connect" title={t("Spotify Connect")}>
            <Row title={t("Device name")} note={t("How this computer shows up in your other Spotify apps.")}>
              <input
                className="settings-input"
                aria-label={t("Device name")}
                value={nameDraft}
                maxLength={40}
                disabled={applying}
                onChange={(e) => setDeviceName(e.currentTarget.value)}
                onBlur={saveName}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              />
            </Row>
          </Group>

          <Group id="links" title={t("Spotify links")}>
            <Row title={t("Open Spotify links in Quackify")} note={linksNote}>
              <div className="settings-buttons">
                {linksHere && <span className="status-pill">{t("Active")}</span>}
                <button className="pill-button" onClick={() => invoke("links_choose").catch(toast)}>
                  {linksHere ? t("Change in Windows…") : t("Choose in Windows…")}
                </button>
              </div>
            </Row>
          </Group>

          <Group id="discord" title={t("Discord")}>
            <Row title={t("Show what you're playing on Discord")} note={t("Your profile shows the song. Friends get a button to listen on Spotify and, during a Jam, one to join it.")}>
              <Toggle on={s.discord_presence} disabled={applying} onChange={(on) => save({ discord_presence: on })} />
            </Row>
          </Group>

          <Group id="window" title={t("Window")}>
            <Row title={t("Close button keeps Quackify in the tray")} note={t("The music keeps playing; quit from the tray icon.")}>
              <Toggle on={s.close_to_tray} disabled={applying} onChange={(on) => save({ close_to_tray: on })} />
            </Row>
            <Row title={t("Start with Windows")} note={t("Open Quackify when you log in to the computer.")}>
              <Toggle on={view.start_with_windows} onChange={setStartup} />
            </Row>
            <Row
              title={t("Start minimized")}
              note={t("When it starts with Windows, Quackify waits in the tray instead of opening its window.")}
              off={!view.start_with_windows}
            >
              <Toggle on={s.start_minimized} disabled={applying || !view.start_with_windows} onChange={(on) => save({ start_minimized: on })} />
            </Row>
          </Group>

          <Group id="about" title={t("About")}>
            <div className="settings-about">
              <DuckIcon size={40} />
              <div>
                <div className="settings-title">Quackify {appVersion}</div>
                <div className="muted small">{t("A Spotify player, yellow, with a duck's taste.")}</div>
              </div>
            </div>
            <p className="muted small settings-note">
              {t("Not in Quackify yet: crossfade, the equalizer and mono audio (its player has none of them). Lossless audio and downloads for offline listening are only allowed in Spotify's own apps.")}
            </p>
          </Group>
        </div>
      </div>
    </div>
  );
}

/** The sections, in order, for the index and for scrolling to them. */
const sections = () => [
  { id: "account", label: t("Account") },
  { id: "appearance", label: t("Appearance") },
  { id: "progress", label: t("Progress bar") },
  { id: "audio", label: t("Audio") },
  { id: "playback", label: t("Playback") },
  { id: "storage", label: t("Storage") },
  { id: "connect", label: t("Spotify Connect") },
  { id: "links", label: t("Spotify links") },
  { id: "discord", label: t("Discord") },
  { id: "window", label: t("Window") },
  { id: "about", label: t("About") },
];

const progressModes = (): { id: ProgressMode; label: string; note: string }[] => [
  { id: "simple", label: t("Simple"), note: t("The plain line.") },
  { id: "wave", label: t("Wave"), note: t("The song's real waveform: you can see and skip the silence.") },
  { id: "live", label: t("Live"), note: t("Bars that grow from the middle and move with the sound.") },
];

/** Heights of the little bars in the Wave and Live previews. */
const PREVIEW_BARS = [30, 45, 60, 40, 70, 85, 55, 65, 90, 70, 50, 75, 60, 40, 55, 80, 65, 45, 35, 50, 70, 60, 40, 30];

/**
 * The list of sections on the left: a click scrolls to one, and the one in view lights up as
 * the page scrolls.
 */
function SettingsIndex() {
  const [active, setActive] = useState("account");
  // The section clicked stays lit while it is on screen: in a tall window the page cannot
  // scroll far enough to bring a short section at the end to the top.
  const picked = useRef<string | null>(null);
  useEffect(() => {
    const main = document.querySelector<HTMLElement>(".main");
    if (!main) return;
    const update = () => {
      // The last section whose top has come within 120px of the panel's top.
      const line = main.getBoundingClientRect().top + 120;
      let at = "account";
      for (const s of sections()) {
        const el = document.getElementById(`settings-${s.id}`);
        if (el && el.getBoundingClientRect().top <= line) at = s.id;
      }
      const box = main.getBoundingClientRect();
      const pickedEl = picked.current ? document.getElementById(`settings-${picked.current}`) : null;
      const pickedTop = pickedEl?.getBoundingClientRect().top;
      if (pickedTop !== undefined && pickedTop >= box.top - 4 && pickedTop < box.bottom - 40) at = picked.current!;
      else picked.current = null;
      setActive(at);
    };
    update();
    main.addEventListener("scroll", update, { passive: true });
    return () => main.removeEventListener("scroll", update);
  }, []);
  return (
    <nav className="settings-index" aria-label={t("Settings sections")}>
      {sections().map((s) => (
        <button
          key={s.id}
          className={active === s.id ? "on" : ""}
          aria-current={active === s.id ? "true" : undefined}
          onClick={() => {
            picked.current = s.id;
            setActive(s.id);
            document.getElementById(`settings-${s.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        >
          {s.label}
        </button>
      ))}
    </nav>
  );
}

/** One group of settings: a glass card with its title. */
function Group({ id, title, note, children }: { id: string; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="settings-group" id={`settings-${id}`}>
      <h2>{title}</h2>
      {note && <p className="muted small settings-group-note">{note}</p>}
      {children}
    </section>
  );
}

function Row({ title, note, off = false, children }: { title: string; note: string; off?: boolean; children: React.ReactNode }) {
  return (
    <div className={`settings-row ${off ? "off" : ""}`}>
      <div>
        <div className="settings-title">{title}</div>
        <div className="muted small">{note}</div>
      </div>
      {children}
    </div>
  );
}
