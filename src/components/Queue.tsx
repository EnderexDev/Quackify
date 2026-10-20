import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { play, type QueueEdit } from "../api/spotify";
import { useNav } from "../state/nav";
import { usePlayer, type NowPlaying, type QueuedTrack } from "../state/player";
import { useSaved } from "../state/saved";
import { toast } from "../state/toast";
import { formatDuration } from "../util/format";
import { useContextMenu, type MenuItem } from "./ContextMenu";
import { Cover } from "./Cover";
import { trackMenu } from "./menus";

/** How many upcoming tracks get names and covers. */
const SHOWN = 30;

/** Names and covers for the tracks of \`list\`, fetched as they show up. */
function useTrackInfo(list: QueuedTrack[]) {
  const key = list.map((q) => q.uri).join(",");
  const [info, setInfo] = useState<Map<string, NowPlaying>>(new Map());
  useEffect(() => {
    const uris = [...new Set(list.map((q) => q.uri))].filter((u) => !info.has(u));
    if (uris.length === 0) return;
    let alive = true;
    invoke<NowPlaying[]>("spotify_tracks", { uris }).then(
      (got) => alive && setInfo((m) => new Map([...m, ...got.map((t) => [t.uri, t] as const)])),
      () => {},
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return info;
}

/**
 * The queue panel. "Queue": now playing, what you added, then the rest of the context; added
 * songs can be dragged, removed or cleared. "Recently played": the songs played before.
 */
export function QueuePanel({ onClose }: { onClose: () => void }) {
  const player = usePlayer();
  const [tab, setTab] = useState<"queue" | "history">("queue");
  // An edit shows at once; Spotify's next state replaces it.
  const [shown, setShown] = useState<QueuedTrack[] | null>(null);
  const serverKey = player.queue.map((q) => q.uid).join(",");
  useEffect(() => setShown(null), [serverKey]);
  const upcoming = (shown ?? player.queue).slice(0, SHOWN);
  const history = player.history.slice(0, SHOWN);
  const info = useTrackInfo(tab === "queue" ? upcoming : history);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropBefore, setDropBefore] = useState<string | null | undefined>(undefined);

  const edit = (e: QueueEdit, optimistic: QueuedTrack[]) => {
    setShown(optimistic);
    play.editQueue(e).catch((err) => {
      setShown(null);
      toast(err);
    });
  };
  const remove = (q: QueuedTrack) =>
    edit({ kind: "remove", uids: [q.uid] }, (shown ?? player.queue).filter((x) => x.uid !== q.uid));
  const clear = () => edit({ kind: "clear" }, (shown ?? player.queue).filter((x) => x.provider !== "queue"));
  // Dropped before \`before\` (a uid), or at the end of the added songs (null).
  const drop = (uid: string, before: string | null) => {
    const list = shown ?? player.queue;
    const moving = list.find((x) => x.uid === uid);
    if (!moving || before === uid) return;
    const rest = list.filter((x) => x.uid !== uid);
    let at = before === null ? rest.map((x) => x.provider).lastIndexOf("queue") + 1 : rest.findIndex((x) => x.uid === before);
    if (at < 0) at = rest.length;
    // A song dragged among the added ones becomes one of them.
    const moved = before === null || rest[at]?.provider === "queue" ? { ...moving, provider: "queue" } : moving;
    rest.splice(at, 0, moved);
    edit({ kind: "move", uids: [uid], before }, rest);
  };

  const queued = upcoming.filter((q) => q.provider === "queue");
  const rest = upcoming.filter((q) => q.provider !== "queue");
  const rowProps = (q: QueuedTrack) => ({
    track: info.get(q.uri),
    item: q,
    onRemove: () => remove(q),
    drag: {
      start: () => setDragging(q.uid),
      over: () => setDropBefore(q.uid),
      end: () => {
        if (dragging && dropBefore !== undefined) drop(dragging, dropBefore);
        setDragging(null);
        setDropBefore(undefined);
      },
      marker: dragging !== null && dropBefore === q.uid,
      dragging: dragging === q.uid,
    },
  });

  return (
    <aside className="queue panel">
      <div className="queue-head">
        <div className="queue-tabs">
          <button className={tab === "queue" ? "on" : ""} onClick={() => setTab("queue")}>
            Queue
          </button>
          <button className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>
            Recently played
          </button>
        </div>
        <button className="link" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="queue-body">
        {tab === "queue" && !player.track && <p className="muted pad">Nothing is playing.</p>}
        {tab === "queue" && player.track && (
          <>
            <h3>Now playing</h3>
            <QueueRow track={player.track} current />
            {queued.length > 0 && (
              <div className="queue-section-head">
                <h3>Next in queue</h3>
                <button className="link small" onClick={clear}>
                  Clear queue
                </button>
              </div>
            )}
            {queued.map((q) => (
              <QueueRow key={q.uid || q.uri} {...rowProps(q)} />
            ))}
            {/* Dropping here puts a song at the end of the added ones. */}
            {dragging && (
              <div
                className={`queue-drop-end ${dropBefore === null ? "on" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDropBefore(null);
                }}
              >
                Drop here to add to the queue
              </div>
            )}
            {rest.length > 0 && <h3>Next up</h3>}
            {rest.map((q) => (
              <QueueRow key={q.uid || q.uri} {...rowProps(q)} />
            ))}
          </>
        )}
        {tab === "history" && history.length === 0 && <p className="muted pad">Songs you play show up here.</p>}
        {tab === "history" &&
          history.map((q) => (
            <QueueRow
              key={q.uid || q.uri}
              track={info.get(q.uri)}
              onPlay={() => play.tracks([q.uri], 0).catch(toast)}
            />
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
  drag?: { start: () => void; over: () => void; end: () => void; marker: boolean; dragging: boolean };
}) {
  const nav = useNav();
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
      onDrop={(e) => e.preventDefault()}
      onDragEnd={() => drag?.end()}
      onContextMenu={(e) => {
        if (!track) return;
        const items: MenuItem[] = [...trackMenu({ ...track, album: track.album.uri ? track.album : null }, saved, nav)];
        if (onRemove) items.unshift({ label: "Remove from queue", onClick: onRemove }, "separator");
        openMenu(e, items);
      }}
    >
      <Cover src={track?.image ?? null} className="queue-cover" />
      <div className="queue-text">
        <div className="queue-name">{track?.name ?? "…"}</div>
        <div className="queue-artists">{track?.artists.map((a) => a.name).join(", ")}</div>
      </div>
      <span className="queue-time">{track ? formatDuration(track.duration_ms) : ""}</span>
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
          ×
        </button>
      )}
    </div>
  );
}
