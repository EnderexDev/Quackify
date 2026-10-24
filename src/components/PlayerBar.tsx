// The player: a glass pill in the colours of the cover playing (greyed while paused). On the
// left the song, in the middle the controls and the progress, on the right lyrics, queue,
// the Jam, devices and volume. An episode swaps shuffle and repeat for 15 seconds back and forward and
// the sleep timer.
import { useEffect, useRef, useState } from "react";
import { play } from "../api/spotify";
import { useDiscordPresence } from "../state/discord";
import { useJam } from "../state/jam";
import { activeLine, useLyrics } from "../state/lyrics";
import { useProgressMode } from "../state/meter";
import { useNav } from "../state/nav";
import { t } from "../i18n";
import { currentQueue, repeatLabel, usePlayer, type NowPlaying } from "../state/player";
import { playerLyrics } from "../state/prefs";
import { carriesSongs, droppedSongs, queueSongs, readDrop, useDrag } from "../state/drag";
import { useSaved } from "../state/saved";
import { sleepLabel, sleepMenu, useSleep, useSleepTimer } from "../state/sleep";
import { notify, toast  } from "../state/toast";
import { toggleMini, useMiniOpen } from "../state/windows";
import { formatDuration } from "../util/format";
import type { Panel } from "../App";
import { useContextMenu, type MenuItem } from "./ContextMenu";
import { Cover } from "./Cover";
import { DevicePicker, RemotePill } from "./Devices";
import { JamButton } from "./Jam";
import {
  Back15Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClockIcon,
  Forward15Icon,
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
import { openPlaylistPicker, trackMenu } from "./menus";
import { ProgressBar } from "./ProgressBar";
import { Slider } from "./Slider";

/** How much one mouse wheel notch over the volume changes it. */
const VOLUME_STEP = 0.05;
/** How far the episode buttons jump. */
const EPISODE_JUMP_MS = 15000;
/**
 * Playback speed for episodes. librespot 0.8 has no speed control: it would take resampling in
 * our own audio output (which shifts the pitch) or a time-stretch. Off until that is decided.
 */
const EPISODE_SPEED = false;

/** `onPanel` toggles the queue; `panel` is the one open. */
export function PlayerBar({ panel, onPanel }: { panel: Panel; onPanel: (p: Exclude<Panel, null>) => void }) {
  const p = usePlayer();
  const nav = useNav();
  const openMenu = useContextMenu();
  const song = p.track;
  const episode = !!song?.uri.startsWith("spotify:episode:");
  const [, tick] = useState(0);
  const [lastVolume, setLastVolume] = useState(0.5);
  const [lyricsPop, setLyricsPop] = useState(false);
  const lyricsPref = playerLyrics.use();
  const progressMode = useProgressMode();
  const miniOpen = useMiniOpen();
  const sleep = useSleep();
  useSleepTimer(p);
  useDiscordPresence(p, useJam());
  const [saved] = useSaved(song?.uri.startsWith("spotify:track:") ? song.uri : null);
  // The volume as last set here, so several wheel notches between renders add up.
  const volume = useRef(p.volume);
  volume.current = p.volume;
  const onVolumeWheel = (e: React.WheelEvent) => {
    if (e.deltaY === 0) return;
    const next = Math.min(1, Math.max(0, volume.current - Math.sign(e.deltaY) * VOLUME_STEP));
    volume.current = next;
    p.setVolume(next);
  };

  // Re-render a few times a second while playing, so the progress bar moves.
  useEffect(() => {
    if (!p.playing) return;
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [p.playing]);

  const duration = song?.duration_ms ?? 0;
  const songOpen = nav.route.page === "song";
  const toggleSong = () => (songOpen ? nav.back() : nav.go({ page: "song" }));
  const withPopup = lyricsPref === "popup" || lyricsPref === "both";
  const withLine = lyricsPref === "line" || lyricsPref === "both";
  const jump = (ms: number) => p.seek(Math.min(Math.max(0, p.position() + ms), Math.max(0, duration - 1000)));

  const sleepAt = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    openMenu({ clientX: r.left, clientY: r.top, preventDefault: () => {} }, sleepMenu(song?.uri ?? null, episode));
  };
  // Right click on the song: its menu, with the sleep timer at the end.
  const songMenu = (e: React.MouseEvent) => {
    if (!song) return;
    const sleepItem: MenuItem = { label: t("Sleep timer"), submenu: () => sleepMenu(song.uri, episode) };
    const items: MenuItem[] = episode
      ? [{ label: t("Go to episode"), onClick: () => nav.open(song.uri) }, "separator", sleepItem]
      : [...trackMenu(song, saved, nav), "separator", sleepItem];
    openMenu(e, items);
  };

  return (
    <footer className={`playerbar ${p.remoteDevice ? "remote" : ""} ${song && !p.playing ? "paused" : ""} ${song ? "" : "idle"} ${episode ? "episode" : ""}`}>
      <RemotePill />
      <QueueDrop />
      <div className="pb-left" onContextMenu={songMenu}>
        {song && (
          <>
            <button className="pb-cover-btn" onClick={toggleSong} aria-label={songOpen ? t("Close the song page") : t("Open the song page")}>
              <Cover src={song.image} className="pb-cover" />
              <span className="pb-cover-hover">{songOpen ? <ChevronDownIcon size={22} /> : <ChevronUpIcon size={22} />}</span>
            </button>
            <div className="pb-text">
              <a className="pb-title" onClick={() => (episode ? nav.open(song.uri) : song.album.uri && nav.open(song.album.uri))} title={song.name}>
                {song.name}
              </a>
              <div className="pb-artists">
                {song.artists.map((a, i) => (
                  <span key={a.uri || i}>
                    {i > 0 && ", "}
                    <a onClick={() => (a.uri ? nav.open(a.uri) : episode && nav.open(song.uri))}>{a.name}</a>
                  </span>
                ))}
              </div>
              {withLine && !episode && <LyricLine track={song} />}
            </div>
            {song.uri.startsWith("spotify:track:") && (
              <>
                <LikeButton uri={song.uri} className="pb-like" />
                <button
                  className="icon-btn pb-add"
                  aria-label={t("Add to playlist")}
                  title={t("Add to playlist")}
                  onClick={(e) => openPlaylistPicker(e.currentTarget, song, nav, openMenu)}
                >
                  <PlaylistAddIcon size={18} />
                </button>
              </>
            )}
          </>
        )}
      </div>

      <div className="pb-center">
        <div className="pb-buttons">
          {episode ? (
            <>
              <button className={`pb-chip pb-sleep ${sleep ? "on" : ""}`} onClick={sleepAt} title={t("Sleep timer")}>
                <ClockIcon size={14} />
                {sleep ? sleepLabel(sleep) : t("Sleep")}
              </button>
              <button className="icon-btn" onClick={() => jump(-EPISODE_JUMP_MS)} aria-label={t("Back 15 seconds")} title={t("Back 15 seconds")}>
                <Back15Icon size={20} />
              </button>
            </>
          ) : (
            <>
              <button
                className={`icon-btn pb-shuffle ${p.shuffle ? "on" : ""}`}
                onClick={() => p.setShuffle(!p.shuffle)}
                disabled={!song}
                aria-label={t("Shuffle")}
                title={p.shuffle ? t("Shuffle on") : t("Shuffle off")}
              >
                <ShuffleIcon size={18} />
              </button>
              <button className="icon-btn" onClick={() => play.previous().catch(toast)} disabled={!song} aria-label={t("Previous")}>
                <PrevIcon size={20} />
              </button>
            </>
          )}
          <button className="pb-play" onClick={p.toggle} disabled={!song} aria-label={p.playing ? t("Pause") : t("Play")}>
            {p.playing ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
          </button>
          {episode ? (
            <>
              <button className="icon-btn" onClick={() => jump(EPISODE_JUMP_MS)} aria-label={t("Forward 15 seconds")} title={t("Forward 15 seconds")}>
                <Forward15Icon size={20} />
              </button>
              {EPISODE_SPEED ? <button className="pb-chip">1×</button> : <span className="pb-chip-space" />}
            </>
          ) : (
            <>
              <button className="icon-btn" onClick={() => play.next().catch(toast)} disabled={!song} aria-label={t("Next")}>
                <NextIcon size={20} />
              </button>
              <button
                className={`icon-btn pb-repeat ${p.repeat !== "off" ? "on" : ""}`}
                onClick={p.cycleRepeat}
                disabled={!song}
                aria-label={t("Repeat")}
                title={repeatLabel(p.repeat)}
              >
                <RepeatIcon size={18} one={p.repeat === "one"} />
              </button>
            </>
          )}
        </div>
        <div className="pb-progress">
          <span className="time">{formatDuration(p.position())}</span>
          <ProgressBar
            uri={song?.uri ?? null}
            duration={duration}
            position={p.position}
            playing={p.playing}
            mode={p.remoteDevice ? "simple" : progressMode}
            disabled={!song || !duration}
            onSeek={p.seek}
          />
          <span className="time">{formatDuration(duration)}</span>
        </div>
      </div>

      <div className="pb-right">
        <div className="pb-lyrics">
          <button
            className={`icon-btn ${(withPopup ? lyricsPop : songOpen) ? "on" : ""}`}
            onClick={() => (withPopup ? setLyricsPop(!lyricsPop) : toggleSong())}
            disabled={!song && !songOpen}
            aria-label={t("Lyrics")}
            title={t("Lyrics")}
          >
            <MicIcon size={20} />
          </button>
          {withPopup && lyricsPop && song && (
            <LyricsPopup
              track={song}
              onClose={() => setLyricsPop(false)}
              onOpenPage={() => {
                setLyricsPop(false);
                if (!songOpen) nav.go({ page: "song" });
              }}
            />
          )}
        </div>
        <button className={`icon-btn ${panel === "queue" ? "on" : ""}`} onClick={() => onPanel("queue")} aria-label={t("Queue")} title={t("Queue")}>
          <QueueIcon size={20} />
        </button>
        <JamButton />
        <DevicePicker />
        <button
          className="icon-btn"
          onWheel={onVolumeWheel}
          aria-label={p.volume === 0 ? t("Unmute") : t("Mute")}
          onClick={() => {
            if (p.volume > 0) {
              setLastVolume(p.volume);
              p.setVolume(0);
            } else p.setVolume(lastVolume || 0.5);
          }}
        >
          <VolumeIcon size={20} level={p.volume} />
        </button>
        <Slider value={p.volume} onCommit={p.setVolume} live className="volume" onWheel={onVolumeWheel} />
        <VolumePercent value={p.volume} onCommit={p.setVolume} onWheel={onVolumeWheel} />
        <button
          className={`icon-btn pb-mini ${miniOpen ? "on" : ""}`}
          onClick={toggleMini}
          aria-label={t("Mini player")}
          aria-pressed={miniOpen}
          title={t("Mini player (Ctrl M)")}
        >
          <MiniPlayerIcon size={20} />
        </button>
      </div>
    </footer>
  );
}

/** The line being sung, under the song's name; nothing when the song has no synced lyrics. */
export function LyricLine({ track }: { track: NowPlaying }) {
  const p = usePlayer();
  const state = useLyrics(track.uri);
  const l = state.status === "ready" ? state.lyrics : null;
  const i = activeLine(l, p.position());
  const words = i >= 0 ? l!.lines[i].words : "";
  if (!words) return null;
  return (
    <div className="pb-lyric" key={i} title={words}>
      {words === "♪" ? words : `♪ ${words}`}
    </div>
  );
}

/** The mic's popup: four lines of the lyrics with the sung one lit, and a way to the song page. */
function LyricsPopup({ track, onClose, onOpenPage }: { track: NowPlaying; onClose: () => void; onOpenPage: () => void }) {
  const p = usePlayer();
  const state = useLyrics(track.uri);
  const box = useRef<HTMLDivElement>(null);
  const l = state.status === "ready" ? state.lyrics : null;
  const active = activeLine(l, p.position());

  // Close on a click outside (the mic button toggles it itself) or Escape.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element;
      if (!box.current?.parentElement?.contains(target)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // One line before the sung one and two after; unsynced lyrics show their first four.
  const start = l?.synced ? Math.max(0, Math.min(active - 1, l.lines.length - 4)) : 0;
  const shown = l ? l.lines.slice(start, start + 4) : [];

  return (
    <div className="lyrics-pop" ref={box} role="dialog" aria-label={t("Lyrics")}>
      <div className="lyrics-pop-head">
        <span>{l?.synced ? t("Lyrics · synced") : t("Lyrics")}</span>
        <button className="link" onClick={onOpenPage}>
          {t("Open page")}
        </button>
      </div>
      {state.status === "loading" && <div className="spinner small" />}
      {state.status === "failed" && (
        <p className="lyrics-pop-msg">
          {t("Couldn't load the lyrics.")}{" "}
          <button className="link" onClick={state.retry}>
            {t("Try again")}
          </button>
        </p>
      )}
      {state.status === "ready" && !l && (
        <p className="lyrics-pop-msg">{track.uri.startsWith("spotify:track:") ? t("This song has no lyrics on Spotify.") : t("Episodes have no lyrics.")}</p>
      )}
      {shown.map((line, k) => (
        <div
          key={start + k}
          className={`lyrics-pop-line ${l!.synced && start + k === active ? "active" : ""}`}
          onClick={() => l!.synced && p.seek(line.start_ms)}
        >
          {line.words || "♪"}
        </div>
      ))}
    </div>
  );
}

/** The volume as a percentage; click it to type one. Enter or leaving sets it, Escape cancels. */
export function VolumePercent({
  value,
  onCommit,
  onWheel,
}: {
  value: number;
  onCommit: (v: number) => void;
  onWheel: (e: React.WheelEvent) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const shown = String(Math.round(value * 100));

  const commit = () => {
    if (text === null) return;
    // Without the % first: a lone "%" would be Number("") = 0 and mute.
    const typed = text.replace("%", "").replace(",", ".").trim();
    const n = Number(typed);
    setText(null);
    if (typed !== "" && Number.isFinite(n)) onCommit(Math.min(100, Math.max(0, n)) / 100);
  };

  return (
    <label className={`volume-pct ${text === null ? "" : "editing"}`} onWheel={text === null ? onWheel : undefined} title={t("Volume")}>
      <input
        value={text ?? shown}
        inputMode="numeric"
        maxLength={4}
        aria-label={t("Volume percent")}
        onFocus={(e) => {
          setText(shown);
          e.currentTarget.select();
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          // Keep keys here from reaching the app's shortcuts.
          e.stopPropagation();
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            const input = e.currentTarget;
            setText(null);
            // Cancelled: blur without committing, once the cleared text has rendered.
            setTimeout(() => input.blur());
          }
        }}
      />
      {/* While typing the box holds only the number, as in the Figma "volume % (editando)". */}
      {text === null && "%"}
    </label>
  );
}

/**
 * While songs, an album or a playlist are dragged, the bar turns into two drop zones: play them
 * right after the song playing, or add them at the end of the queue.
 */
function QueueDrop() {
  const drag = useDrag();
  const p = usePlayer();
  const [over, setOver] = useState<"next" | "end" | null>(null);
  useEffect(() => setOver(null), [drag]);
  if (!drag) return null;
  const queued = p.queue.filter((q) => q.provider === "queue").length;
  const drop = async (where: "next" | "end", e: React.DragEvent) => {
    if (!carriesSongs(e)) return;
    e.preventDefault();
    setOver(null);
    const data = readDrop(e);
    try {
      const uris = await droppedSongs(data);
      if (!uris.length) return notify(t("Nothing there to add to the queue"), { kind: "info" });
      const went = await queueSongs(uris, where === "next", currentQueue);
      const one = uris.length === 1;
      notify(
        went === "next"
          ? one ? t("1 song will play next") : t("{n} songs will play next", { n: uris.length })
          : one ? t("Added 1 song to the queue") : t("Added {n} songs to the queue", { n: uris.length }),
      );
    } catch (err) {
      toast(err);
    }
  };
  const zone = (where: "next" | "end", icon: React.ReactNode, title: string, note: string) => (
    <div
      className={`pb-drop-zone ${over === where ? "on" : ""}`}
      onDragOver={(e) => {
        if (!carriesSongs(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setOver(where);
      }}
      onDragLeave={() => setOver((o) => (o === where ? null : o))}
      onDrop={(e) => drop(where, e)}
    >
      {icon}
      <span>
        <strong>{title}</strong>
        <small>{note}</small>
      </span>
    </div>
  );
  return (
    <div className="pb-drop">
      {zone("next", <NextIcon size={20} />, t("Play next"), p.track ? t("Right after {name}", { name: p.track.name }) : t("Before the rest of the queue"))}
      {zone(
        "end",
        <QueueIcon size={20} />,
        t("Add to the end of the queue"),
        queued ? (queued === 1 ? t("After the song already there") : t("After the {n} songs already there", { n: queued })) : t("Your queue is empty"),
      )}
    </div>
  );
}
