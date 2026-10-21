import { useEffect, useRef, useState } from "react";
import { areSaved } from "../api/library";
import type { Track } from "../api/types";
import { useNav } from "../state/nav";
import { usePlayer } from "../state/player";
import { useSaved } from "../state/saved";
import { formatDuration } from "../util/format";
import { useContextMenu, type MenuItem } from "./ContextMenu";
import { Cover } from "./Cover";
import { ClockIcon, PauseIcon, PlayIcon } from "./icons";
import { LikeButton } from "./LikeButton";
import { TRACKS_MIME, trackMenu, tracksMenu } from "./menus";

/**
 * Track rows. Double-click a row, or click its number, to play it; `onPlay` gets the row index
 * and `contextUri` marks which row is the one playing now.
 *
 * Rows can be selected like in Spotify: click, Ctrl+click to add or take one out, Shift+click
 * for a range, Ctrl+A for all, Escape to clear. The right-click menu, Delete and dragging act
 * on every selected row; songs can also be dragged onto a playlist in Your Library.
 */
export function TrackList({
  tracks,
  onPlay,
  contextUri,
  showAlbum = true,
  showCover = true,
  showHeader = true,
  onRemove,
  onMove,
  playlistName,
  positions,
}: {
  tracks: Track[];
  onPlay: (index: number) => void;
  contextUri?: string | null;
  showAlbum?: boolean;
  showCover?: boolean;
  showHeader?: boolean;
  /** For the user's own playlists: remove rows, or move rows to just before row `to`. */
  onRemove?: (indices: number[]) => void;
  onMove?: (from: number[], to: number) => void;
  playlistName?: string;
  /** Where each row sits in the list's own order, when the rows are sorted or filtered. */
  positions?: number[];
}) {
  const player = usePlayer();
  const nav = useNav();
  const openMenu = useContextMenu();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const anchor = useRef<number | null>(null);
  const [dragFrom, setDragFrom] = useState<number[] | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const current = player.track;

  // The rows change (removed, moved, sorted, filtered): the selection would point elsewhere.
  // More rows loaded at the end keep it.
  const rowsKey = tracks.map((t) => t.uid ?? t.uri).join(",");
  const lastKey = useRef(rowsKey);
  useEffect(() => {
    const appended = rowsKey.startsWith(lastKey.current);
    lastKey.current = rowsKey;
    if (appended) return;
    setSelected(new Set());
    anchor.current = null;
  }, [rowsKey]);

  const isCurrent = (t: Track, i: number) =>
    !!current &&
    current.uri === t.uri &&
    (!contextUri || player.contextUri === contextUri) &&
    // In a context, the same song can be listed twice: only the playing copy lights up.
    (!contextUri || player.index === (positions?.[i] ?? i) || !tracks.some((x, j) => j !== i && x.uri === t.uri));

  const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);
  const removable = (indices: number[]) => !!onRemove && indices.every((i) => tracks[i]?.uid);

  const select = (i: number, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    const from = anchor.current;
    if (e.shiftKey && from !== null) {
      const [a, b] = [Math.min(from, i), Math.max(from, i)];
      setSelected((prev) => {
        const range = new Set<number>(e.ctrlKey || e.metaKey ? prev : []);
        for (let k = a; k <= b; k++) range.add(k);
        return range;
      });
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(i)) next.delete(i);
        else next.add(i);
        return next;
      });
    } else {
      setSelected(new Set([i]));
    }
    anchor.current = i;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input, textarea")) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setSelected(new Set(tracks.map((_, i) => i)));
    } else if (e.key === "Escape") {
      setSelected(new Set());
    } else if (e.key === "Delete" && selected.size && removable(sorted(selected))) {
      e.preventDefault();
      onRemove!(sorted(selected));
    }
  };

  // Several rows: one menu for all of them, once Spotify says which are liked.
  const openMultiMenu = (e: React.MouseEvent, indices: number[]) => {
    e.preventDefault();
    const at = { clientX: e.clientX, clientY: e.clientY, preventDefault: () => {} };
    const rows = indices.map((i) => tracks[i]);
    const extra: MenuItem[] = removable(indices)
      ? ["separator", { label: `Remove from ${playlistName ?? "this playlist"}`, onClick: () => onRemove!(indices) }]
      : [];
    areSaved(rows.map((t) => t.uri)).then(
      (saved) => openMenu(at, [...tracksMenu(rows, saved.every(Boolean), nav), ...extra]),
      () => openMenu(at, [...tracksMenu(rows, undefined, nav), ...extra]),
    );
  };

  return (
    <div className={`tracklist ${showAlbum ? "" : "no-album"}`} tabIndex={-1} onKeyDown={onKeyDown}>
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
      {tracks.map((t, i) => (
        <TrackRow
          key={`${t.uri}:${i}`}
          track={t}
          index={i}
          current={isCurrent(t, i)}
          selected={selected.has(i)}
          showAlbum={showAlbum}
          showCover={showCover}
          onPlay={() => onPlay(i)}
          onSelect={(e) => select(i, e)}
          onMenu={(e, single) => {
            if (selected.has(i) && selected.size > 1) return openMultiMenu(e, sorted(selected));
            setSelected(new Set([i]));
            anchor.current = i;
            single();
          }}
          onRemove={removable([i]) ? () => onRemove!([i]) : undefined}
          playlistName={playlistName}
          drag={{
            // Dragging a selected row takes the whole selection along.
            rows: () => (selected.has(i) ? sorted(selected) : [i]).map((k) => tracks[k]),
            start: () => {
              if (!selected.has(i)) setSelected(new Set([i]));
              setDragFrom(selected.has(i) ? sorted(selected) : [i]);
            },
            over: onMove && t.uid && dragFrom ? (after) => setDropAt(after ? i + 1 : i) : undefined,
            // The move happens on the drop itself; a drag let go elsewhere (on a playlist in Your
            // Library, outside) or cancelled with Escape does not reorder anything.
            drop: () => {
              if (onMove && dragFrom && dropAt !== null && dragFrom.every((k) => tracks[k]?.uid)) onMove(dragFrom, dropAt);
              setDragFrom(null);
              setDropAt(null);
            },
            end: () => {
              setDragFrom(null);
              setDropAt(null);
            },
            marker: dragFrom && dropAt === i ? "before" : dragFrom && dropAt === i + 1 && i === tracks.length - 1 ? "after" : null,
            dragging: !!dragFrom?.includes(i),
          }}
        />
      ))}
    </div>
  );
}

function TrackRow({
  track: t,
  index,
  current,
  selected,
  showAlbum,
  showCover,
  onPlay,
  onSelect,
  onMenu,
  onRemove,
  playlistName,
  drag,
}: {
  track: Track;
  index: number;
  current: boolean;
  selected: boolean;
  showAlbum: boolean;
  showCover: boolean;
  onPlay: () => void;
  onSelect: (e: React.MouseEvent) => void;
  onMenu: (e: React.MouseEvent, single: () => void) => void;
  onRemove?: () => void;
  playlistName?: string;
  drag: {
    rows: () => Track[];
    start: () => void;
    over?: (after: boolean) => void;
    drop: () => void;
    end: () => void;
    marker: "before" | "after" | null;
    dragging: boolean;
  };
}) {
  const nav = useNav();
  const player = usePlayer();
  const openMenu = useContextMenu();
  const [saved] = useSaved(t.uri);

  return (
    <div
      className={`track-row ${current ? "current" : ""} ${selected ? "selected" : ""} ${t.playable ? "" : "unplayable"} ${saved ? "liked" : ""} ${drag.marker ? "drop-" + drag.marker : ""} ${drag.dragging ? "dragging" : ""}`}
      onClick={(e) => {
        // Links (artist, album) and buttons do their own thing.
        if (!(e.target as HTMLElement).closest("a, button")) onSelect(e);
      }}
      onDoubleClick={() => t.playable && onPlay()}
      onContextMenu={(e) =>
        onMenu(e, () =>
          openMenu(e, [
            ...trackMenu(t, saved, nav),
            ...(onRemove ? (["separator", { label: `Remove from ${playlistName ?? "this playlist"}`, onClick: onRemove }] as const) : []),
          ]),
        )
      }
      draggable
      onDragStart={(e) => {
        const rows = drag.rows();
        e.dataTransfer.effectAllowed = "copyMove";
        e.dataTransfer.setData(TRACKS_MIME, JSON.stringify(rows.map((r) => r.uri)));
        e.dataTransfer.setData("text/plain", rows.map((r) => r.name).join(", "));
        drag.start();
      }}
      onDragOver={(e) => {
        if (!drag.over) return;
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        drag.over(e.clientY > r.top + r.height / 2);
      }}
      onDrop={(e) => {
        if (!drag.over) return;
        e.preventDefault();
        drag.drop();
      }}
      onDragEnd={() => drag.end()}
    >
      <span className="track-num">
        <span className="num">{current && player.playing ? <span className="eq" /> : index + 1}</span>
        <button
          className="row-play"
          aria-label="Play"
          disabled={!t.playable}
          onClick={() => (current ? player.toggle() : onPlay())}
        >
          {current && player.playing ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
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
      <span className="track-time">
        <LikeButton uri={t.uri} size={16} className="row-like" />
        <span>{formatDuration(t.durationMs)}</span>
      </span>
    </div>
  );
}
