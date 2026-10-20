import { useEffect, useRef, useState } from "react";
import { play } from "../api/spotify";
import { useNav } from "../state/nav";
import { usePlayer } from "../state/player";
import { toast } from "../state/toast";
import { formatDuration } from "../util/format";
import { Cover } from "./Cover";
import { LikeButton } from "./LikeButton";
import { DevicePicker, RemoteBanner } from "./Devices";
import type { Panel } from "../App";
import { MicIcon, NextIcon, NowPlayingIcon, PauseIcon, PlayIcon, PrevIcon, QueueIcon, RepeatIcon, ShuffleIcon, VolumeIcon } from "./icons";
import { Slider } from "./Slider";

/** `onPanel` toggles a right-hand panel; `panel` is the one open. */
/** How much one mouse wheel notch over the volume changes it. */
const VOLUME_STEP = 0.05;

export function PlayerBar({ panel, onPanel }: { panel: Panel; onPanel: (p: Exclude<Panel, null>) => void }) {
  const p = usePlayer();
  const nav = useNav();
  const t = p.track;
  const [, tick] = useState(0);
  const [lastVolume, setLastVolume] = useState(0.5);
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

  const duration = t?.duration_ms ?? 0;
  const lyricsOpen = nav.route.page === "lyrics";

  return (
    <footer className={`playerbar ${p.remoteDevice ? "remote" : ""}`}>
      <RemoteBanner />
      <div className="pb-left">
        {t && (
          <>
            <Cover src={t.image} className="pb-cover" />
            <div className="pb-text">
              <a className="pb-title" onClick={() => (t.uri.startsWith("spotify:episode:") ? nav.open(t.uri) : t.album.uri && nav.open(t.album.uri))} title={t.name}>
                {t.name}
              </a>
              <div className="pb-artists">
                {t.artists.map((a, i) => (
                  <span key={a.uri || i}>
                    {i > 0 && ", "}
                    <a onClick={() => (a.uri ? nav.open(a.uri) : t.uri.startsWith("spotify:episode:") && nav.open(t.uri))}>{a.name}</a>
                  </span>
                ))}
              </div>
            </div>
            {t.uri.startsWith("spotify:track:") && <LikeButton uri={t.uri} className="pb-like" />}
          </>
        )}
      </div>

      <div className="pb-center">
        <div className="pb-buttons">
          <button
            className={`icon-btn ${p.shuffle ? "on" : ""}`}
            onClick={() => p.setShuffle(!p.shuffle)}
            disabled={!t}
            aria-label="Shuffle"
            title={p.shuffle ? "Shuffle on" : "Shuffle off"}
          >
            <ShuffleIcon size={18} />
          </button>
          <button className="icon-btn" onClick={() => play.previous().catch(toast)} disabled={!t} aria-label="Previous">
            <PrevIcon size={20} />
          </button>
          <button className="pb-play" onClick={p.toggle} disabled={!t} aria-label={p.playing ? "Pause" : "Play"}>
            {p.playing ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
          </button>
          <button className="icon-btn" onClick={() => play.next().catch(toast)} disabled={!t} aria-label="Next">
            <NextIcon size={20} />
          </button>
          <button
            className={`icon-btn ${p.repeat !== "off" ? "on" : ""}`}
            onClick={p.cycleRepeat}
            disabled={!t}
            aria-label="Repeat"
            title={`Repeat ${p.repeat}`}
          >
            <RepeatIcon size={18} one={p.repeat === "one"} />
          </button>
        </div>
        <div className="pb-progress">
          <span className="time">{formatDuration(p.position())}</span>
          <Slider value={duration ? p.position() / duration : 0} onCommit={(f) => p.seek(f * duration)} disabled={!t || !duration} />
          <span className="time">{formatDuration(duration)}</span>
        </div>
      </div>

      <div className="pb-right">
        <button
          className={`icon-btn ${panel === "nowplaying" ? "on" : ""}`}
          onClick={() => onPanel("nowplaying")}
          aria-label="Now playing view"
          title="Now playing view"
        >
          <NowPlayingIcon size={20} />
        </button>
        <button
          className={`icon-btn ${lyricsOpen ? "on" : ""}`}
          onClick={() => (lyricsOpen ? nav.back() : nav.go({ page: "lyrics" }))}
          disabled={!t && !lyricsOpen}
          aria-label="Lyrics"
          title="Lyrics"
        >
          <MicIcon size={20} />
        </button>
        <button className={`icon-btn ${panel === "queue" ? "on" : ""}`} onClick={() => onPanel("queue")} aria-label="Queue" title="Queue">
          <QueueIcon size={20} />
        </button>
        <DevicePicker />
        <button
          className="icon-btn"
          onWheel={onVolumeWheel}
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
        <Slider value={p.volume} onCommit={p.setVolume} live className="volume" onWheel={onVolumeWheel} />
      </div>
    </footer>
  );
}
