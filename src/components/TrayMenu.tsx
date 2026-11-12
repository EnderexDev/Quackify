// The tray icon's menu (tray_menu.rs): the whole of its own small transparent window, in the same
// glass card as the app's right-click menus. On top, the song playing; then play controls, the
// mini player, the two desktop switches and Quit. Every click hides the window first.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { t, useLang } from "../i18n";
import { Cover } from "./Cover";
import { AppLogo, CheckIcon, CloseIcon, MiniPlayerIcon, NextIcon, OpenIcon, PauseIcon, PlayIcon, PrevIcon } from "./icons";

type View = { name: string; close_to_tray: boolean; start_with_windows: boolean };
type Song = { name: string; artists: { name: string }[]; image: string | null };
type PlayerState = { connect: { playback: { is_playing: boolean } | null }; now_playing: Song | null };

export function TrayMenu() {
  // The words follow a language change made in the main window.
  useLang();
  const [view, setView] = useState<View | null>(null);
  const [song, setSong] = useState<Song | null>(null);
  const [playing, setPlaying] = useState(false);
  /** Bumped by every opening, so the card comes in again. */
  const [opened, setOpened] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const read = () => {
      invoke<View>("tray_menu_state").then(setView, () => {});
      invoke<PlayerState>("spotify_player_state").then(
        (s) => {
          setSong(s.now_playing);
          setPlaying(!!s.connect.playback?.is_playing);
        },
        // No session (logged out, still connecting): no song to show.
        () => {
          setSong(null);
          setPlaying(false);
        },
      );
    };
    read();
    const offs = [
      listen("tray-menu-open", () => {
        read();
        setOpened((n) => n + 1);
        (document.activeElement as HTMLElement | null)?.blur();
      }),
      listen("tray-menu-sync", read),
      listen("settings-changed", read),
      listen<Song>("now-playing", ({ payload }) => setSong(payload)),
      listen<PlayerState["connect"]>("connect", ({ payload }) => setPlaying(!!payload.playback?.is_playing)),
    ];
    // Like a Windows menu: the arrows go through the items (the first press takes the first or
    // the last), Enter or Space runs the one in focus, Escape closes.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return void invoke("tray_menu_hide");
      const items = [...(root.current?.querySelectorAll<HTMLElement>("[data-nav]") ?? [])];
      const at = items.indexOf(document.activeElement as HTMLElement);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        const next = at < 0 ? (step > 0 ? 0 : items.length - 1) : (at + step + items.length) % items.length;
        items[next]?.focus();
      } else if ((e.key === "Enter" || e.key === " ") && at >= 0) {
        e.preventDefault();
        items[at].click();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      offs.forEach((off) => off.then((f) => f()));
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // The window takes the card's size (with the room its shadow needs).
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      invoke("tray_menu_resize", { width: r.width, height: r.height }).catch(() => {});
    };
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const name = view?.name ?? "Quackify";
  const run = (id: string) => () => invoke("tray_menu_action", { id });
  const item = (id: string, label: string, icon: ReactNode, checked?: boolean) => (
    <div className="menu-item" data-nav tabIndex={-1} onClick={run(id)}>
      <span className={`menu-check ${checked ? "on" : ""}`}>{checked ? <CheckIcon size={14} /> : icon}</span>
      <span className="menu-label">{label}</span>
    </div>
  );

  return (
    <div className="tray-root" ref={root}>
      <div className="menu tray-menu" key={opened}>
        <div className="tray-head" data-nav tabIndex={-1} onClick={run("show")} title={t("Show {name}", { name })}>
          {song ? (
            <>
              <Cover src={song.image} className="tray-cover" />
              <span className="tray-song">
                <span className="tray-title">{song.name}</span>
                <span className="tray-artists">{song.artists.map((a) => a.name).join(", ")}</span>
              </span>
            </>
          ) : (
            <>
              <AppLogo size={28} className="tray-logo" />
              <span className="tray-song">
                <span className="tray-title">{name}</span>
                <span className="tray-artists">{t("Nothing playing")}</span>
              </span>
            </>
          )}
        </div>
        <div className="tray-controls">
          <button className="icon-btn" data-nav tabIndex={-1} onClick={run("previous")} title={t("Previous")}>
            <PrevIcon size={16} />
          </button>
          <button className="tray-play" data-nav tabIndex={-1} onClick={run("toggle")} title={playing ? t("Pause") : t("Play")}>
            {playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
          </button>
          <button className="icon-btn" data-nav tabIndex={-1} onClick={run("next")} title={t("Next")}>
            <NextIcon size={16} />
          </button>
        </div>
        <div className="menu-sep" />
        {item("show", t("Show {name}", { name }), <OpenIcon size={16} />)}
        {item("mini", t("Mini player"), <MiniPlayerIcon size={16} />)}
        <div className="menu-sep" />
        {item("close_to_tray", t("Close to tray"), null, view?.close_to_tray)}
        {item("autostart", t("Start with Windows"), null, view?.start_with_windows)}
        <div className="menu-sep" />
        <div className="menu-item danger" data-nav tabIndex={-1} onClick={run("quit")}>
          <span className="menu-check">
            <CloseIcon size={16} />
          </span>
          <span className="menu-label">{t("Quit {name}", { name })}</span>
        </div>
      </div>
    </div>
  );
}
