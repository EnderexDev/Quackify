import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { areSaved } from "../api/library";
import type { Track } from "../api/types";
import { t } from "../i18n";
import { useNav } from "../state/nav";
import { usePlayerNow, usePlayerSelect } from "../state/player";
import { knownSaved, useSaved } from "../state/saved";
import { toast } from "../state/toast";
import { play } from "../api/spotify";
import { formatAgo, formatCount, formatDuration } from "../util/format";
import { useContextMenu, type MenuItem } from "./ContextMenu";
import { Cover } from "./Cover";
import { CheckIcon, ClockIcon, CloseIcon, HeartIcon, HeartOutlineIcon, MoreIcon, PauseIcon, PlayIcon, PlaylistAddIcon, QueueIcon } from "./icons";
import { LikeButton } from "./LikeButton";
import { TRACKS_MIME, trackMenu, tracksMenu } from "./menus";
import { beginDrag } from "../state/drag";
import { Eq } from "./Eq";

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
  showPlays = false,
  showAdded = false,
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
  /** An artist's popular songs: how many times each was played, where the album would be. */
  showPlays?: boolean;
  /** Playlists and Liked Songs: when each song was added. */
  showAdded?: boolean;
  /** For the user's own playlists: remove rows, or move rows to just before row `to`. */
  onRemove?: (indices: number[]) => void;
  onMove?: (from: number[], to: number) => void;
  playlistName?: string;
  /** Where each row sits in the list's own order, when the rows are sorted or filtered. */
  positions?: number[];
}) {
  // Only what the rows show is read, so a volume change or a cluster update re-renders nothing here.
  const currentUri = usePlayerSelect((p) => p.track?.uri ?? null);
  const playerContext = usePlayerSelect((p) => p.contextUri);
  const playerIndex = usePlayerSelect((p) => p.index);
  const playing = usePlayerSelect((p) => p.playing);
  const getPlayer = usePlayerNow();
  const nav = useNav();
  const openMenu = useContextMenu();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const anchor = useRef<number | null>(null);
  const [dragFrom, setDragFrom] = useState<number[] | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  // The rows change (removed, moved, sorted, filtered): the selection would point elsewhere.
  // More rows loaded at the end keep it.
  const rowsKey = useMemo(() => tracks.map((t) => t.uid ?? t.uri).join(","), [tracks]);
  const lastKey = useRef(rowsKey);
  useEffect(() => {
    const appended = rowsKey.startsWith(lastKey.current);
    lastKey.current = rowsKey;
    if (appended) return;
    setSelected(new Set());
    anchor.current = null;
  }, [rowsKey]);

  const isCurrent = (t: Track, i: number) =>
    currentUri === t.uri &&
    (!contextUri || playerContext === contextUri) &&
    // In a context, the same song can be listed twice: only the playing copy lights up.
    (!contextUri || playerIndex === (positions?.[i] ?? i) || !tracks.some((x, j) => j !== i && x.uri === t.uri));

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
      // A plain click on the only selected row takes it out again.
      setSelected((prev) => (prev.size === 1 && prev.has(i) ? new Set() : new Set([i])));
    }
    anchor.current = i;
  };

  // A click anywhere off the rows (the page, the sidebar) clears the selection; menus and the
  // selection bar act on it, so they keep it.
  const list = useRef<HTMLDivElement>(null);
  const anySelected = selected.size > 0;
  useEffect(() => {
    if (!anySelected) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest(".menu, .selection-bar, .dialog") || list.current?.contains(t)) return;
      setSelected(new Set());
      anchor.current = null;
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [anySelected]);

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
      ? ["separator", { label: t("Remove from {name}", { name: playlistName ?? t("this playlist") }), danger: true, onClick: () => onRemove!(indices) }]
      : [];
    areSaved(rows.map((t) => t.uri)).then(
      (saved) => openMenu(at, [...tracksMenu(rows, saved.every(Boolean), nav), ...extra]),
      () => openMenu(at, [...tracksMenu(rows, undefined, nav), ...extra]),
    );
  };

  // What the rows do, read at the moment they do it: every row gets this one ref, which never
  // changes, so a row re-renders only when what it shows changes. It takes this render's
  // handlers once the render is committed, so a row never acts on rows it does not show.
  const handlers = useRef<RowHandlers>(null!);
  const latest: RowHandlers = {
    play: (i) => onPlay(i),
    toggle: () => getPlayer().toggle(),
    open: (uri) => nav.open(uri),
    select,
    menu: (i, e) => {
      if (selected.has(i) && selected.size > 1) return openMultiMenu(e, sorted(selected));
      setSelected(new Set([i]));
      anchor.current = i;
      const remove = removable([i]) ? () => onRemove!([i]) : undefined;
      openMenu(e, [
        ...trackMenu(tracks[i], knownSaved(tracks[i].uri), nav),
        ...(remove ? (["separator", { label: t("Remove from {name}", { name: playlistName ?? t("this playlist") }), danger: true, onClick: remove }] as const) : []),
      ]);
    },
    // Dragging a selected row takes the whole selection along.
    dragRows: (i) => (selected.has(i) ? sorted(selected) : [i]).map((k) => tracks[k]),
    dragStart: (i) => {
      if (!selected.has(i)) setSelected(new Set([i]));
      setDragFrom(selected.has(i) ? sorted(selected) : [i]);
    },
    canDropOn: (i) => !!(onMove && tracks[i]?.uid && dragFrom),
    dragOver: (i, after) => setDropAt(after ? i + 1 : i),
    // The move happens on the drop itself; a drag let go elsewhere (on a playlist in Your
    // Library, outside) or cancelled with Escape does not reorder anything.
    drop: () => {
      if (onMove && dragFrom && dropAt !== null && dragFrom.every((k) => tracks[k]?.uid)) onMove(dragFrom, dropAt);
      setDragFrom(null);
      setDropAt(null);
    },
    dragEnd: () => {
      setDragFrom(null);
      setDropAt(null);
    },
  };
  useLayoutEffect(() => {
    handlers.current = latest;
  });

  return (
    <div
      ref={list}
      className={`tracklist ${showPlays ? "with-plays" : showAlbum ? (showAdded ? "with-added" : "") : "no-album"}`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      {showHeader && (
        <div className="track-row track-head">
          <span className="track-num">#</span>
          <span>{t("Title")}</span>
          {showAlbum && <span className="track-album">{t("Album")}</span>}
          {showAlbum && showAdded && <span className="track-added">{t("Date added")}</span>}
          <span className="track-time">
            <ClockIcon size={16} />
          </span>
        </div>
      )}
      {tracks.map((t, i) => {
        const current = isCurrent(t, i);
        return (
          <TrackRow
            key={`${t.uri}:${i}`}
            track={t}
            index={i}
            current={current}
            playing={current && playing}
            selected={selected.has(i)}
            showAlbum={showAlbum}
            showPlays={showPlays}
            showAdded={showAdded}
            showCover={showCover}
            marker={dragFrom && dropAt === i ? "before" : dragFrom && dropAt === i + 1 && i === tracks.length - 1 ? "after" : null}
            dragging={!!dragFrom?.includes(i)}
            h={handlers}
          />
        );
      })}
      {selected.size > 1 && (
        <SelectionBar
          rows={sorted(selected).map((k) => tracks[k])}
          onClear={() => {
            setSelected(new Set());
            anchor.current = null;
          }}
        />
      )}
    </div>
  );
}

/**
 * Over the list while several songs are selected: play them, queue them, add them to a
 * playlist or like them, or clear the selection. The actions are the right-click menu's.
 */
function SelectionBar({ rows, onClear }: { rows: Track[]; onClear: () => void }) {
  const nav = useNav();
  const openMenu = useContextMenu();
  // tracksMenu's items by their id: the labels change with the language.
  const item = (items: MenuItem[], id: "queue" | "playlist" | "liked") => {
    const m = items.find((x) => x !== "separator" && x.id === id);
    return m && m !== "separator" ? m : undefined;
  };
  const playable = rows.filter((t) => t.playable).map((t) => t.uri);
  // Whether they are all liked already: then the heart takes them out.
  const key = rows.map((t) => t.uri).join(",");
  const [allSaved, setAllSaved] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setAllSaved(undefined);
    areSaved(rows.map((t) => t.uri)).then((s) => live && setAllSaved(s.every(Boolean)), () => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const at = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { clientX: r.left, clientY: r.top - 8, preventDefault: () => {} };
  };

  return (
    <div className="selection-bar" role="toolbar" aria-label={t("{n} selected", { n: rows.length })}>
      <span className="selection-count">{t("{n} selected", { n: rows.length })}</span>
      <button className="selection-btn" disabled={!playable.length} onClick={() => play.tracks(playable, 0).catch(toast)}>
        <PlayIcon size={14} />
        {t("Play")}
      </button>
      <button className="selection-btn" onClick={() => item(tracksMenu(rows, undefined, nav), "queue")?.onClick?.()}>
        <QueueIcon size={14} />
        {t("Queue")}
      </button>
      <button
        className="selection-btn"
        onClick={async (e) => {
          const where = at(e);
          const add = item(tracksMenu(rows, undefined, nav), "playlist");
          if (!add) return;
          const mine = add.submenu ? await Promise.resolve(add.submenu()).catch((): MenuItem[] => []) : [];
          openMenu(where, [...(add.submenuHead ?? []), ...mine]);
        }}
      >
        <PlaylistAddIcon size={14} />
        {t("Add to playlist")}
      </button>
      <button
        className="selection-btn"
        disabled={allSaved === undefined}
        onClick={() => {
          item(tracksMenu(rows, allSaved, nav), "liked")?.onClick?.();
          setAllSaved(!allSaved);
        }}
      >
        {allSaved ? <HeartIcon size={14} className="accent" /> : <HeartOutlineIcon size={14} />}
        {allSaved ? t("Unlike") : t("Like")}
      </button>
      <button className="selection-close" aria-label={t("Clear selection")} title={t("Clear selection (Esc)")} onClick={onClear}>
        <CloseIcon size={14} />
      </button>
    </div>
  );
}

type RowHandlers = {
  play: (i: number) => void;
  toggle: () => void;
  open: (uri: string) => void;
  select: (i: number, e: React.MouseEvent) => void;
  menu: (i: number, e: React.MouseEvent) => void;
  dragRows: (i: number) => Track[];
  dragStart: (i: number) => void;
  canDropOn: (i: number) => boolean;
  dragOver: (i: number, after: boolean) => void;
  drop: () => void;
  dragEnd: () => void;
};

const TrackRow = memo(function TrackRow({
  track,
  index,
  current,
  playing,
  selected,
  showAlbum,
  showPlays,
  showAdded,
  showCover,
  marker,
  dragging,
  h,
}: {
  track: Track;
  index: number;
  current: boolean;
  /** This row is the one playing, and it is not paused. */
  playing: boolean;
  selected: boolean;
  showAlbum: boolean;
  showPlays: boolean;
  showAdded: boolean;
  showCover: boolean;
  marker: "before" | "after" | null;
  dragging: boolean;
  h: MutableRefObject<RowHandlers>;
}) {
  const [saved] = useSaved(track.uri);

  return (
    <div
      className={`track-row ${current ? "current" : ""} ${selected ? "selected" : ""} ${track.playable ? "" : "unplayable"} ${saved ? "liked" : ""} ${marker ? "drop-" + marker : ""} ${dragging ? "dragging" : ""}`}
      onClick={(e) => {
        // Links (artist, album) and buttons do their own thing.
        if (!(e.target as HTMLElement).closest("a, button")) h.current.select(index, e);
      }}
      onDoubleClick={() => track.playable && h.current.play(index)}
      onContextMenu={(e) => h.current.menu(index, e)}
      draggable
      onDragStart={(e) => {
        const rows = h.current.dragRows(index);
        e.dataTransfer.effectAllowed = "copyMove";
        e.dataTransfer.setData(TRACKS_MIME, JSON.stringify(rows.map((r) => r.uri)));
        e.dataTransfer.setData("text/plain", rows.map((r) => r.name).join(", "));
        beginDrag({ kind: "tracks", uris: rows.map((r) => r.uri), label: rows.length === 1 ? rows[0].name : t("{n} songs", { n: rows.length }) });
        h.current.dragStart(index);
      }}
      onDragOver={(e) => {
        if (!h.current.canDropOn(index)) return;
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        h.current.dragOver(index, e.clientY > r.top + r.height / 2);
      }}
      onDrop={(e) => {
        if (!h.current.canDropOn(index)) return;
        e.preventDefault();
        h.current.drop();
      }}
      onDragEnd={() => h.current.dragEnd()}
    >
      <span className="track-num">
        <span className="num">{playing ? <Eq /> : index + 1}</span>
        {selected && (
          <span className="row-check" aria-hidden>
            <CheckIcon size={12} />
          </span>
        )}
        <button
          className="row-play"
          aria-label={t("Play")}
          disabled={!track.playable}
          onClick={() => (current ? h.current.toggle() : h.current.play(index))}
        >
          {playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
        </button>
      </span>
      <span className="track-main">
        {showCover && <Cover src={track.image} className="track-cover" />}
        <span className="track-text">
          <span className="track-name">{track.name}</span>
          <span className="track-artists">
            {track.artists.map((a, k) => (
              <span key={a.uri || k}>
                {k > 0 && ", "}
                <a onClick={() => a.uri && h.current.open(a.uri)}>{a.name}</a>
              </span>
            ))}
          </span>
        </span>
      </span>
      {showPlays ? (
        <span className="track-album track-plays">{track.plays !== undefined ? formatCount(track.plays) : ""}</span>
      ) : (
        showAlbum && (
          <span className="track-album">
            {track.album && <a onClick={() => h.current.open(track.album!.uri)}>{track.album.name}</a>}
          </span>
        )
      )}
      {showAlbum && showAdded && <span className="track-added">{formatAgo(track.addedAt)}</span>}
      <span className="track-time">
        <LikeButton uri={track.uri} size={16} className="row-like" />
        <span>{formatDuration(track.durationMs)}</span>
        <button
          className="row-more"
          aria-label={t("More options for {name}", { name: track.name })}
          title={t("More options")}
          onClick={(e) => {
            e.stopPropagation();
            h.current.menu(index, e);
          }}
        >
          <MoreIcon size={16} />
        </button>
      </span>
    </div>
  );
});
