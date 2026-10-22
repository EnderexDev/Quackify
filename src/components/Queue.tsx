import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { artist, collection, play, show, type QueueEdit } from "../api/spotify";
import { useNav } from "../state/nav";
import { usePlayer, type NowPlaying, type QueuedTrack } from "../state/player";
import { useSaved } from "../state/saved";
import { toast } from "../state/toast";
import { formatDuration } from "../util/format";
import { useContextMenu, type MenuItem } from "./ContextMenu";
import { Cover } from "./Cover";
import { CloseIcon, RepeatIcon, ShuffleIcon } from "./icons";
import { trackMenu } from "./menus";
import { Segmented } from "./Segmented";

/** How many tracks each group shows, with names and covers. */
const SHOWN = 30;

/** Names and covers for the tracks of \`list\`, fetched as they show up. */
function useTrackInfo(list: QueuedTrack[]) {
  const key = list.map((q) => q.uri).join(",");
  const [info, setInfo] = useState<Map<string, NowPlaying>>(new Map());
  useEffect(() => {
    const uris = [...new Set(list.map((q) => q.uri))].filter((u) => !info.has(u));
    if (uris.length === 0) return;
    let alive = true;
    // Only the tracks shown now are kept, so an open queue does not pile them up.
    const wanted = new Set(list.map((q) => q.uri));
    invoke<NowPlaying[]>("spotify_tracks", { uris }).then(
      (got) =>
        alive &&
        setInfo(
          (m) =>
            new Map([...[...m].filter(([u]) => wanted.has(u)), ...got.map((t) => [t.uri, t] as const)]),
        ),
      () => {},
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return info;
}

type Source = { kind: string; name: string; total: number | null };

/** What the context playing is called ("Album", "Noite Azul", 9 tracks), when a page can say. */
function useSource(uri: string | null): Source | null {
  const [source, setSource] = useState<Source | null>(null);
  useEffect(() => {
    setSource(null);
    if (!uri) return;
    let alive = true;
    const kind = uri.split(":")[1];
    const load: Promise<Source> | null =
      kind === "album" || kind === "playlist" || kind === "collection"
        ? collection(uri).then((c) => ({ kind: kind === "album" ? "Album" : "Playlist", name: c.title, total: c.total }))
        : kind === "artist"
          ? artist(uri).then((a) => ({ kind: "Artist", name: a.name, total: null }))
          : kind === "show"
            ? show(uri).then((s) => ({ kind: "Podcast", name: s.name, total: null }))
            : null;
    load?.then(
      (s) => alive && setSource(s),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [uri]);
  return source;
}

/** A row's key: its uid, or its place when it has none (the same song can come twice). */
const rowKey = (q: QueuedTrack, i: number) => q.uid || `${q.uri}#${i}`;

/** A new order for \`list\`, every order as likely. */
function shuffled<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The queue panel. "Queue": now playing, what you added (shuffle, clear), the rest of the
 * context playing (its shuffle and repeat are the player's; skip past it), then autoplay.
 * Added songs can be dragged, removed or cleared. "History": the songs played before.
 */
export function QueuePanel({ onClose }: { onClose: () => void }) {
  const player = usePlayer();
  const [tab, setTab] = useState<"queue" | "history">("queue");
  // An edit shows at once; Spotify's next state replaces it.
  const [shown, setShown] = useState<QueuedTrack[] | null>(null);
  // Every entry counts, uid or not, so a new state always replaces an edit shown early.
  const serverKey = JSON.stringify(player.queue.map((q) => [q.uri, q.uid, q.provider]));
  useEffect(() => setShown(null), [serverKey]);
  const all = shown ?? player.queue;
  const allQueued = all.filter((q) => q.provider === "queue");
  const queued = allQueued.slice(0, SHOWN);
  const fromContext = all.filter((q) => q.provider !== "queue" && q.provider !== "autoplay").slice(0, SHOWN);
  const autoplay = all.filter((q) => q.provider === "autoplay").slice(0, SHOWN);
  const history = player.history.slice(0, SHOWN);
  const info = useTrackInfo(tab === "queue" ? [...queued, ...fromContext, ...autoplay] : history);
  const source = useSource(player.contextUri);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropBefore, setDropBefore] = useState<string | null | undefined>(undefined);

  const edit = (e: QueueEdit, optimistic: QueuedTrack[]) => {
    setShown(optimistic);
    play.editQueue(e).catch((err) => {
      setShown(null);
      toast(err);
    });
  };
  const ref = (q: QueuedTrack) => ({ uid: q.uid, uri: q.uri });
  const remove = (q: QueuedTrack) => edit({ kind: "remove", tracks: [ref(q)] }, all.filter((x) => x.uid !== q.uid));
  const clear = () => edit({ kind: "clear" }, all.filter((x) => x.provider !== "queue"));
  // Your songs in a new order: all of them moved, in that order, to where the added ones go.
  const canShuffle = allQueued.length > 1 && allQueued.every((q) => q.uid);
  const shuffleAdded = () => {
    const order = shuffled(allQueued);
    edit({ kind: "move", tracks: order.map(ref), before: null }, [...order, ...all.filter((x) => x.provider !== "queue")]);
  };
  // Dropped before \`before\` (a uid), or at the end of the added songs (null).
  const drop = (uid: string, before: string | null) => {
    const moving = all.find((x) => x.uid === uid);
    if (!moving || before === uid) return;
    const rest = all.filter((x) => x.uid !== uid);
    let at = before === null ? rest.map((x) => x.provider).lastIndexOf("queue") + 1 : rest.findIndex((x) => x.uid === before);
    if (at < 0) at = rest.length;
    // A song dragged among the added ones (or right after them) becomes one of them; one
    // dragged further down becomes part of the rest of the list, in that place.
    const intoAdded = before === null || rest[at]?.provider === "queue" || (at > 0 && rest[at - 1]?.provider === "queue");
    const moved = { ...moving, provider: intoAdded ? "queue" : moving.provider === "queue" ? "context" : moving.provider };
    rest.splice(at, 0, moved);
    const anchor = before === null ? null : all.find((x) => x.uid === before);
    edit({ kind: "move", tracks: [ref(moving)], before: anchor ? ref(anchor) : null }, rest);
  };

  // The move happens on the drop itself; a drag let go elsewhere or cancelled with Escape
  // changes nothing.
  const endDrag = () => {
    setDragging(null);
    setDropBefore(undefined);
  };
  const dropOn = (before: string | null) => {
    if (dragging) drop(dragging, before);
    endDrag();
  };
  // A track without a uid cannot be told apart from another copy: it is shown but not edited.
  const rowProps = (q: QueuedTrack) => ({
    track: info.get(q.uri),
    item: q,
    onRemove: q.uid ? () => remove(q) : undefined,
    drag: q.uid
      ? {
          start: () => setDragging(q.uid),
          over: () => setDropBefore(q.uid),
          drop: () => dropOn(q.uid),
          end: endDrag,
          marker: dragging !== null && dropBefore === q.uid,
          dragging: dragging === q.uid,
        }
      : undefined,
  });

  // "Album · track 2 of 9": the row is only a place in the context when it plays in order.
  const place =
    source && player.index != null && source.total && !player.shuffle ? ` · track ${player.index + 1} of ${source.total}` : "";
  const n = (count: number) => (count === 1 ? "1 song" : `${count} songs`);

  return (
    <aside className="queue panel">
      <div className="queue-head">
        <h2>Queue</h2>
        <Segmented
          className="queue-tabs"
          label="Queue or history"
          options={[
            { id: "queue", label: "Queue" },
            { id: "history", label: "History" },
          ]}
          value={tab}
          onChange={setTab}
        />
        <button className="icon-btn queue-close" aria-label="Close queue" title="Close" onClick={onClose}>
          <CloseIcon size={16} />
        </button>
      </div>
      <div className="queue-body">
        {tab === "queue" && !player.track && <p className="muted pad">Nothing is playing.</p>}
        {tab === "queue" && player.track && (
          <>
            <div className="queue-group-head">
              <div className="queue-group-title">
                <h3>Now playing</h3>
              </div>
            </div>
            <QueueRow track={player.track} current />
            {queued.length > 0 && (
              <div className="queue-group-head">
                <div className="queue-group-title">
                  <h3>From your queue</h3>
                  <span>{n(allQueued.length)}</span>
                </div>
                {canShuffle && (
                  <button className="icon-btn queue-group-btn" aria-label="Shuffle your queue" title="Shuffle your queue" onClick={shuffleAdded}>
                    <ShuffleIcon size={16} />
                  </button>
                )}
                <button className="queue-pill" onClick={clear}>
                  Clear
                </button>
              </div>
            )}
            {queued.map((q, i) => (
              <QueueRow key={rowKey(q, i)} {...rowProps(q)} />
            ))}
            {/* Dropping here puts a song at the end of the added ones. */}
            {dragging && (
              <div
                className={`queue-drop-end ${dropBefore === null ? "on" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDropBefore(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  dropOn(null);
                }}
              >
                Drop here to add to the queue
              </div>
            )}
            {fromContext.length > 0 && (
              <div className="queue-group-head">
                <div className="queue-group-title">
                  <h3>{source ? `From ${source.name}` : "Next up"}</h3>
                  {source && (
                    <span>
                      {source.kind}
                      {place}
                    </span>
                  )}
                </div>
                <button
                  className={`icon-btn queue-group-btn ${player.shuffle ? "on" : ""}`}
                  aria-label={player.shuffle ? "Disable shuffle" : "Enable shuffle"}
                  title={player.shuffle ? "Disable shuffle" : "Enable shuffle"}
                  onClick={() => player.setShuffle(!player.shuffle)}
                >
                  <ShuffleIcon size={16} />
                </button>
                <button
                  className={`icon-btn queue-group-btn ${player.repeat !== "off" ? "on" : ""}`}
                  aria-label="Repeat"
                  title={`Repeat ${player.repeat}`}
                  onClick={player.cycleRepeat}
                >
                  <RepeatIcon size={16} one={player.repeat === "one"} />
                </button>
                {autoplay.length > 0 && (
                  <button
                    className="queue-pill"
                    title="Skip to what plays after it"
                    onClick={() => play.skipTo(autoplay[0].uri, autoplay[0].uid).catch(toast)}
                  >
                    Skip
                  </button>
                )}
              </div>
            )}
            {fromContext.map((q, i) => (
              <QueueRow key={rowKey(q, i)} {...rowProps(q)} />
            ))}
            {autoplay.length > 0 && (
              <div className="queue-group-head">
                <div className="queue-group-title">
                  <h3>After</h3>
                  <span>Autoplay{source ? `: similar to ${source.name}` : ""}</span>
                </div>
              </div>
            )}
            {autoplay.map((q, i) => (
              <QueueRow key={rowKey(q, i)} track={info.get(q.uri)} item={q} />
            ))}
          </>
        )}
        {tab === "history" && history.length === 0 && <p className="muted pad">Nothing here yet.</p>}
        {tab === "history" &&
          history.map((q, i) => (
            <QueueRow key={rowKey(q, i)} track={info.get(q.uri)} onPlay={() => play.tracks([q.uri], 0).catch(toast)} />
          ))}
      </div>
    </aside>
  );
}

export function QueueRow({
  track,
  item,
  current,
  onRemove,
  onPlay,
  drag,
}: {
  track: NowPlaying | undefined;
  item?: QueuedTrack;
  current?: boolean;
  onRemove?: () => void;
  onPlay?: () => void;
  drag?: { start: () => void; over: () => void; drop: () => void; end: () => void; marker: boolean; dragging: boolean };
}) {
  const nav = useNav();
  const player = usePlayer();
  const openMenu = useContextMenu();
  const [saved] = useSaved(track?.uri);
  const playIt = onPlay ?? (() => item && play.skipTo(item.uri, item.uid).catch(toast));
  return (
    <div
      className={`queue-row ${current ? "current" : ""} ${drag?.marker ? "drop-before" : ""} ${drag?.dragging ? "dragging" : ""}`}
      title={current ? undefined : "Double-click to play"}
      onDoubleClick={() => !current && playIt()}
      draggable={!!drag}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        drag?.start();
      }}
      onDragOver={(e) => {
        if (!drag) return;
        e.preventDefault();
        drag.over();
      }}
      onDrop={(e) => {
        if (!drag) return;
        e.preventDefault();
        drag.drop();
      }}
      onDragEnd={() => drag?.end()}
      onContextMenu={(e) => {
        if (!track) return;
        const items: MenuItem[] = [...trackMenu({ ...track, album: track.album.uri ? track.album : null }, saved, nav)];
        if (onRemove) items.unshift({ label: "Remove from queue", onClick: onRemove }, "separator");
        openMenu(e, items);
      }}
    >
      {drag && <span className="queue-grip" aria-hidden />}
      <Cover src={track?.image ?? null} className="queue-cover" />
      <div className="queue-text">
        <div className="queue-name">{track?.name ?? "…"}</div>
        <div className="queue-artists">{track?.artists.map((a) => a.name).join(", ")}</div>
      </div>
      {current ? (
        <span className={`eq ${player.playing ? "" : "paused"}`} />
      ) : (
        <span className="queue-time">{track ? formatDuration(track.duration_ms) : ""}</span>
      )}
      {onRemove && (
        <button
          className="queue-remove"
          aria-label="Remove from queue"
          title="Remove from queue"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <CloseIcon size={12} />
        </button>
      )}
    </div>
  );
}
