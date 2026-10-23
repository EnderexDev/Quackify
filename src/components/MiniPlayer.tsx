// The mini player: the whole of its own small window (mini.rs), always on top. The cover, the
// song, the line being sung, the progress bar in the player's mode, and like, previous, play,
// next and lyrics. Dragged from anywhere that is not a button; the pin lets it go behind other
// windows, the × hides it.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { play } from "../api/spotify";
import { useProgressMode } from "../state/meter";
import { t } from "../i18n";
import { usePlayer } from "../state/player";
import { toast } from "../state/toast";
import { coverColors, type CoverColors } from "../util/coverColors";
import { Cover } from "./Cover";
import { CloseIcon, DuckIcon, MicIcon, NextIcon, PauseIcon, PinIcon, PlayIcon, PrevIcon } from "./icons";
import { LikeButton } from "./LikeButton";
import { LyricLine } from "./PlayerBar";
import { ProgressBar } from "./ProgressBar";

/** Before anything plays: the aura's quiet violet and amber. */
const IDLE: CoverColors = { base: "hsl(258 45% 26%)", glow: "hsl(24 55% 40%)" };

export function MiniPlayer() {
  const p = usePlayer();
  const song = p.track;
  const mode = useProgressMode();
  const [, tick] = useState(0);
  const [onTop, setOnTop] = useState(true);
  const [colors, setColors] = useState<CoverColors>(IDLE);
  const image = song?.image ?? null;

  useEffect(() => {
    if (!image) return setColors(IDLE);
    let alive = true;
    coverColors(image).then((c) => alive && setColors(c));
    return () => {
      alive = false;
    };
  }, [image]);

  // Re-render a few times a second while playing, so the bar and the sung line move.
  useEffect(() => {
    if (!p.playing) return;
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [p.playing]);

  // Pressing anywhere but a control moves the window.
  const onDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || (e.target as Element).closest("button, a, input, .progress")) return;
    getCurrentWindow()
      .startDragging()
      .catch(() => {});
  };

  const pin = () => {
    const next = !onTop;
    setOnTop(next);
    invoke("mini_player_on_top", { on: next }).catch((e) => {
      setOnTop(!next);
      toast(e);
    });
  };

  const isTrack = !!song?.uri.startsWith("spotify:track:");
  const duration = song?.duration_ms ?? 0;
  const style = { "--aura": colors.base, "--aura-2": colors.glow } as React.CSSProperties;

  return (
    <div className={`mini ${song && !p.playing ? "paused" : ""} ${song ? "" : "idle"}`} style={style} onMouseDown={onDown}>
      <div className="mini-top">
        {song ? <Cover src={song.image} className="mini-cover" /> : <DuckIcon size={44} className="mini-cover mini-duck" />}
        <div className="mini-text">
          <div className="mini-title" title={song?.name}>
            {song?.name ?? t("Nothing playing")}
          </div>
          <div className="mini-artists">{song ? song.artists.map((a) => a.name).join(", ") : t("Play something in Quackify")}</div>
          {song && isTrack && <LyricLine track={song} />}
        </div>
        <div className="mini-window-buttons">
          <button className="icon-btn" onClick={() => invoke("mini_player_close")} aria-label={t("Close the mini player")} title={t("Close")}>
            <CloseIcon size={16} />
          </button>
          <button
            className={`icon-btn mini-pin ${onTop ? "on" : ""}`}
            onClick={pin}
            aria-pressed={onTop}
            aria-label={t("Keep on top")}
            title={onTop ? t("On top of other windows") : t("Behind other windows")}
          >
            <PinIcon size={14} />
          </button>
        </div>
      </div>

      <ProgressBar
        uri={song?.uri ?? null}
        duration={duration}
        position={p.position}
        playing={p.playing}
        mode={p.remoteDevice ? "simple" : mode}
        disabled={!song || !duration}
        onSeek={p.seek}
      />

      <div className="mini-buttons">
        {isTrack ? <LikeButton uri={song!.uri} size={18} /> : <span className="mini-space" />}
        <button className="icon-btn" onClick={() => play.previous().catch(toast)} disabled={!song} aria-label={t("Previous")}>
          <PrevIcon size={18} />
        </button>
        <button className="mini-play" onClick={p.toggle} disabled={!song} aria-label={p.playing ? t("Pause") : t("Play")}>
          {p.playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
        </button>
        <button className="icon-btn" onClick={() => play.next().catch(toast)} disabled={!song} aria-label={t("Next")}>
          <NextIcon size={18} />
        </button>
        <button
          className="icon-btn"
          onClick={() => invoke("mini_player_show_main", { what: "song" })}
          disabled={!song}
          aria-label={t("Lyrics")}
          title={t("Lyrics, in Quackify")}
        >
          <MicIcon size={18} />
        </button>
      </div>
    </div>
  );
}
