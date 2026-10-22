// The cinema mode: the window in full screen over a strong aura, with the cover big and the
// lyrics big beside it (in the middle with no lyrics). A glass bar with every control shows while
// the mouse moves and goes after 3 s still, with the main shortcuts above it; in the corner, what
// plays next (in the last 20 s, and with the bar) and the way out. F11, Escape or the avatar menu.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { play } from "../api/spotify";
import { activeLine, useLyrics } from "../state/lyrics";
import { useProgressMode } from "../state/meter";
import { useNav } from "../state/nav";
import { usePlayer, type NowPlaying } from "../state/player";
import { cinemaAuto, cinemaLyrics, lyricsSize, type LyricsSize } from "../state/prefs";
import { toast } from "../state/toast";
import { setCinema, toggleMini, useMiniOpen } from "../state/windows";
import { formatDuration } from "../util/format";
import { useContextMenu } from "./ContextMenu";
import { Cover } from "./Cover";
import { DevicePicker } from "./Devices";
import {
  MicIcon,
  MiniPlayerIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PlaylistAddIcon,
  PrevIcon,
  QueueIcon,
  RepeatIcon,
  ShuffleIcon,
  VolumeIcon,
} from "./icons";
import { LikeButton } from "./LikeButton";
import { openPlaylistPicker } from "./menus";
import { VolumePercent } from "./PlayerBar";
import { ProgressBar } from "./ProgressBar";
import { Slider } from "./Slider";

/** The bar goes after this long without the mouse moving. */
const CALM_MS = 3000;
/** What plays next shows in the song's last this many ms. */
const UP_NEXT_MS = 20000;
/** Without touching the app for this long while music plays, the cinema mode opens by itself. */
const AUTO_MS = 5 * 60 * 1000;
/** The sung line, one before it and three after. */
const LINES_BEFORE = 1;
const LINES_SHOWN = 5;

const SIZE_ORDER: LyricsSize[] = ["s", "m", "l"];

const HINTS: [string, string][] = [
  ["Space", "play/pause"],
  ["Shift ← →", "5s"],
  ["Ctrl ↑ ↓", "volume"],
  ["Alt Shift B", "like"],
  ["Alt Shift J", "lyrics"],
  ["Alt Shift Q", "queue"],
  ["Esc", "exit"],
];

export function Cinema({ onQueue }: { onQueue: () => void }) {
  const p = usePlayer();
  const nav = useNav();
  const openMenu = useContextMenu();
  const t = p.track;
  const mode = useProgressMode();
  const lyricsOn = cinemaLyrics.use() === "on";
  const size = lyricsSize.use();
  const miniOpen = useMiniOpen();
  const [, tick] = useState(0);
  const [calm, setCalm] = useState(false);
  const [lastVolume, setLastVolume] = useState(0.5);
  const calmTimer = useRef(0);

  const isTrack = !!t?.uri.startsWith("spotify:track:");
  const episode = !!t?.uri.startsWith("spotify:episode:");
  const lyrics = useLyrics(lyricsOn && isTrack ? t!.uri : null);
  const l = lyrics.status === "ready" ? lyrics.lyrics : null;
  const synced = !!l?.synced;
  // Lyrics only when they follow the song: unsynced ones would sit still beside it.
  const withLyrics = lyricsOn && synced;

  // Re-render a few times a second while playing, so the bar and the lyrics move.
  useEffect(() => {
    if (!p.playing) return;
    const id = setInterval(() => tick((n) => n + 1), 200);
    return () => clearInterval(id);
  }, [p.playing]);

  // The bar shows while the mouse moves, and while it is over the bar or a popup is open.
  useEffect(() => {
    const wake = () => {
      setCalm(false);
      clearTimeout(calmTimer.current);
      calmTimer.current = window.setTimeout(() => {
        const busy = document.querySelector(".cinema-controls:hover, .cinema .devices-pop, .menu");
        if (!busy) setCalm(true);
        else wake();
      }, CALM_MS);
    };
    wake();
    window.addEventListener("mousemove", wake);
    window.addEventListener("mousedown", wake);
    return () => {
      clearTimeout(calmTimer.current);
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("mousedown", wake);
    };
  }, []);

  // Escape leaves, unless something open over the cinema takes it first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector(".cinema .devices-pop, .menu")) return;
      e.preventDefault();
      setCinema(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const duration = t?.duration_ms ?? 0;
  const position = p.position();
  const ending = !!t && duration > 0 && duration - position <= UP_NEXT_MS;
  const active = activeLine(l, position);
  const start = Math.max(0, Math.min(active - LINES_BEFORE, (l?.lines.length ?? 0) - LINES_SHOWN));
  const shown = withLyrics ? l!.lines.slice(start, start + LINES_SHOWN) : [];
  const meta = t ? [t.artists.map((a) => a.name).join(", "), !episode && t.album.name].filter(Boolean).join(" · ") : "";
  const noLyricsNote = !t
    ? ""
    : episode
      ? "Episode"
      : !lyricsOn
        ? "Lyrics off"
        : lyrics.status === "loading"
          ? ""
          : l && !synced
            ? "Lyrics not synced"
            : "Instrumental, no lyrics";
  const sizeIndex = SIZE_ORDER.indexOf(size);

  return (
    <div className={`cinema ${withLyrics ? "with-lyrics" : "centered"} ${calm ? "calm" : ""} size-${size}`} role="dialog" aria-label="Cinema mode">
      <div className="cinema-corner">
        <UpNext show={ending || !calm} />
        <button className="cinema-exit" onClick={() => setCinema(false)}>
          <kbd>Esc</kbd> Exit
        </button>
      </div>

      <div className="cinema-stage">
        <section className="cinema-song">
          {withLyrics && <SongName t={t!} meta={meta} />}
          {t ? (
            <Cover src={t.image} kind={episode ? "show" : "album"} shaped className="cinema-cover" />
          ) : (
            <div className="cinema-cover cinema-nothing">Play something to see it here.</div>
          )}
          {!withLyrics && t && (
            <>
              <SongName t={t} meta={meta} />
              {noLyricsNote && <span className="cinema-pill">{noLyricsNote}</span>}
            </>
          )}
        </section>
        {withLyrics && (
          <section className="cinema-lyrics" aria-live="off">
            {shown.map((line, k) => {
              const i = start + k;
              return (
                <div key={i} className={`cinema-line ${i === active ? "active" : i < active ? "past" : ""}`} onClick={() => p.seek(line.start_ms)}>
                  {line.words || "♪"}
                </div>
              );
            })}
          </section>
        )}
      </div>

      <div className="cinema-bottom">
        <div className="cinema-hints">
          {HINTS.map(([k, what]) => (
            <span key={k}>
              <b>{k}</b> {what}
            </span>
          ))}
        </div>
        <div className="cinema-controls">
          <div className="cinema-progress">
            <span className="time">{formatDuration(position)}</span>
            <ProgressBar
              uri={t?.uri ?? null}
              duration={duration}
              position={p.position}
              playing={p.playing}
              mode={p.remoteDevice ? "simple" : mode}
              disabled={!t || !duration}
              onSeek={p.seek}
            />
            <span className="time">{formatDuration(duration)}</span>
          </div>
          <div className="cinema-row">
            <div className="cinema-left">
              {isTrack && (
                <>
                  <LikeButton uri={t!.uri} size={20} />
                  <button
                    className="icon-btn"
                    aria-label="Add to playlist"
                    title="Add to playlist"
                    onClick={(e) => openPlaylistPicker(e.currentTarget, t!, nav, openMenu)}
                  >
                    <PlaylistAddIcon size={20} />
                  </button>
                </>
              )}
              {withLyrics && <span className="cinema-pill">Synced lyrics</span>}
            </div>
            <div className="cinema-center">
              {!episode && (
                <button
                  className={`icon-btn cinema-toggle ${p.shuffle ? "on" : ""}`}
                  onClick={() => p.setShuffle(!p.shuffle)}
                  disabled={!t}
                  aria-label="Shuffle"
                  aria-pressed={p.shuffle}
                >
                  <ShuffleIcon size={20} />
                </button>
              )}
              <button className="icon-btn" onClick={() => play.previous().catch(toast)} disabled={!t} aria-label="Previous">
                <PrevIcon size={22} />
              </button>
              <button className="cinema-play" onClick={p.toggle} disabled={!t} aria-label={p.playing ? "Pause" : "Play"}>
                {p.playing ? <PauseIcon size={24} /> : <PlayIcon size={24} />}
              </button>
              <button className="icon-btn" onClick={() => play.next().catch(toast)} disabled={!t} aria-label="Next">
                <NextIcon size={22} />
              </button>
              {!episode && (
                <button
                  className={`icon-btn cinema-toggle ${p.repeat !== "off" ? "on" : ""}`}
                  onClick={p.cycleRepeat}
                  disabled={!t}
                  aria-label="Repeat"
                  title={`Repeat ${p.repeat}`}
                >
                  <RepeatIcon size={20} one={p.repeat === "one"} />
                </button>
              )}
            </div>
            <div className="cinema-right">
              <button
                className={`icon-btn cinema-mic ${lyricsOn ? "on" : ""}`}
                onClick={() => cinemaLyrics.set(lyricsOn ? "off" : "on")}
                disabled={!isTrack}
                aria-pressed={lyricsOn}
                aria-label="Lyrics"
                title={lyricsOn ? "Hide the lyrics" : "Show the lyrics"}
              >
                <MicIcon size={20} />
              </button>
              {withLyrics && (
                <span className="cinema-sizes">
                  <button
                    className="cinema-size small"
                    onClick={() => lyricsSize.set(SIZE_ORDER[Math.max(0, sizeIndex - 1)])}
                    disabled={sizeIndex === 0}
                    aria-label="Smaller lyrics"
                  >
                    A
                  </button>
                  <button
                    className="cinema-size big"
                    onClick={() => lyricsSize.set(SIZE_ORDER[Math.min(SIZE_ORDER.length - 1, sizeIndex + 1)])}
                    disabled={sizeIndex === SIZE_ORDER.length - 1}
                    aria-label="Bigger lyrics"
                  >
                    A
                  </button>
                </span>
              )}
              <button className="icon-btn" onClick={onQueue} aria-label="Queue" title="Queue">
                <QueueIcon size={20} />
              </button>
              <DevicePicker />
              <button
                className="icon-btn"
                aria-label={p.volume === 0 ? "Unmute" : "Mute"}
                onClick={() => {
                  if (p.volume > 0) {
                    setLastVolume(p.volume);
                    p.setVolume(0);
                  } else p.setVolume(lastVolume || 0.5);
                }}
              >
                <VolumeIcon size={20} level={p.volume} />
              </button>
              <Slider value={p.volume} onCommit={p.setVolume} live className="volume" />
              <VolumePercent value={p.volume} onCommit={p.setVolume} onWheel={() => {}} />
              <button
                className={`icon-btn ${miniOpen ? "on" : ""}`}
                onClick={() => {
                  setCinema(false);
                  if (!miniOpen) toggleMini();
                }}
                aria-label="Mini player"
                title="Mini player"
              >
                <MiniPlayerIcon size={20} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SongName({ t, meta }: { t: NowPlaying; meta: string }) {
  return (
    <div className="cinema-name">
      <h1 title={t.name}>{t.name}</h1>
      <div className="cinema-meta">{meta}</div>
    </div>
  );
}

/** The next song in the queue, with its cover. */
function UpNext({ show }: { show: boolean }) {
  const p = usePlayer();
  const uri = p.queue[0]?.uri ?? null;
  const [next, setNext] = useState<NowPlaying | null>(null);
  useEffect(() => {
    setNext(null);
    if (!uri) return;
    let alive = true;
    invoke<NowPlaying[]>("spotify_tracks", { uris: [uri] }).then(
      ([n]) => alive && setNext(n ?? null),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [uri]);
  if (!next) return null;
  return (
    <div className={`cinema-next ${show ? "" : "hidden"}`}>
      <Cover src={next.image} className="cinema-next-cover" />
      <div>
        <div className="cinema-next-label">Up next</div>
        <div className="cinema-next-name">{next.name}</div>
        <div className="cinema-next-artist">{next.artists.map((a) => a.name).join(", ")}</div>
      </div>
    </div>
  );
}

/**
 * With the setting on, the cinema mode opens by itself after 5 minutes without touching the
 * app while music plays here in front of you (the window shown and focused).
 */
export function useCinemaAuto(open: boolean) {
  const p = usePlayer();
  const auto = cinemaAuto.use() === "on";
  const armed = auto && p.playing && !open;
  useEffect(() => {
    if (!armed) return;
    let timer = 0;
    const arm = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (document.visibilityState === "visible" && document.hasFocus()) setCinema(true);
        else arm();
      }, AUTO_MS);
    };
    arm();
    const events = ["mousemove", "mousedown", "keydown", "wheel"] as const;
    events.forEach((e) => window.addEventListener(e, arm, { passive: true }));
    window.addEventListener("focus", arm);
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, arm));
      window.removeEventListener("focus", arm);
    };
  }, [armed]);
}
