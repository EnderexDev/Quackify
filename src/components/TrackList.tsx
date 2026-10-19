import type { Track } from "../api/types";
import { useNav } from "../state/nav";
import { usePlayer } from "../state/player";
import { formatDuration } from "../util/format";
import { Cover } from "./Cover";
import { ClockIcon, PauseIcon, PlayIcon } from "./icons";

/**
 * Track rows. Double-click a row, or click its number, to play it. `onPlay` gets the row
 * index; `contextUri` marks which row is the one playing now.
 */
export function TrackList({
  tracks,
  onPlay,
  contextUri,
  showAlbum = true,
  showCover = true,
  showHeader = true,
}: {
  tracks: Track[];
  onPlay: (index: number) => void;
  contextUri?: string | null;
  showAlbum?: boolean;
  showCover?: boolean;
  showHeader?: boolean;
}) {
  const nav = useNav();
  const player = usePlayer();
  const current = player.track;

  const isCurrent = (t: Track, i: number) =>
    !!current &&
    current.uri === t.uri &&
    (!contextUri || player.contextUri === contextUri) &&
    // In a context, the same song can be listed twice: only the playing copy lights up.
    (!contextUri || player.index === i || !tracks.some((x, j) => j !== i && x.uri === t.uri));

  return (
    <div className={`tracklist ${showAlbum ? "" : "no-album"}`}>
      {showHeader && (
        <div className="track-row track-head">
          <span className="track-num">#</span>
          <span>Title</span>
          {showAlbum && <span>Album</span>}
          <span className="track-time">
            <ClockIcon size={16} />
          </span>
        </div>
      )}
      {tracks.map((t, i) => {
        const on = isCurrent(t, i);
        return (
          <div
            key={`${t.uri}:${i}`}
            className={`track-row ${on ? "current" : ""} ${t.playable ? "" : "unplayable"}`}
            onDoubleClick={() => t.playable && onPlay(i)}
          >
            <span className="track-num">
              <span className="num">{on && player.playing ? <span className="eq" /> : i + 1}</span>
              <button
                className="row-play"
                aria-label="Play"
                disabled={!t.playable}
                onClick={() => (on ? player.toggle() : onPlay(i))}
              >
                {on && player.playing ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
              </button>
            </span>
            <span className="track-main">
              {showCover && <Cover src={t.image} className="track-cover" />}
              <span className="track-text">
                <span className="track-name">{t.name}</span>
                <span className="track-artists">
                  {t.artists.map((a, k) => (
                    <span key={a.uri || k}>
                      {k > 0 && ", "}
                      <a onClick={() => a.uri && nav.open(a.uri)}>{a.name}</a>
                    </span>
                  ))}
                </span>
              </span>
            </span>
            {showAlbum && (
              <span className="track-album">
                {t.album && <a onClick={() => nav.open(t.album!.uri)}>{t.album.name}</a>}
              </span>
            )}
            <span className="track-time">{formatDuration(t.durationMs)}</span>
          </div>
        );
      })}
    </div>
  );
}
