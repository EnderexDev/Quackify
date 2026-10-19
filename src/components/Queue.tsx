import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { play } from "../api/spotify";
import { useNav } from "../state/nav";
import { usePlayer, type NowPlaying, type QueuedTrack } from "../state/player";
import { useSaved } from "../state/saved";
import { toast } from "../state/toast";
import { formatDuration } from "../util/format";
import { useContextMenu } from "./ContextMenu";
import { Cover } from "./Cover";
import { trackMenu } from "./menus";

/** How many upcoming tracks get names and covers. */
const SHOWN = 30;

/** The queue panel: now playing, what the user queued, then the rest of the context. */
export function QueuePanel({ onClose }: { onClose: () => void }) {
  const player = usePlayer();
  const upcoming = player.queue.slice(0, SHOWN);
  const key = upcoming.map((q) => q.uri).join(",");
  const [info, setInfo] = useState<Map<string, NowPlaying>>(new Map());

  useEffect(() => {
    const uris = [...new Set(upcoming.map((q) => q.uri))].filter((u) => !info.has(u));
    if (uris.length === 0) return;
    let alive = true;
    invoke<NowPlaying[]>("spotify_tracks", { uris }).then(
      (list) => alive && setInfo((m) => new Map([...m, ...list.map((t) => [t.uri, t] as const)])),
      () => {},
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const queued = upcoming.filter((q) => q.provider === "queue");
  const rest = upcoming.filter((q) => q.provider !== "queue");

  return (
    <aside className="queue panel">
      <div className="queue-head">
        <h2>Queue</h2>
        <button className="link" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="queue-body">
        {!player.track && <p className="muted pad">Nothing is playing.</p>}
        {player.track && (
          <>
            <h3>Now playing</h3>
            <QueueRow track={player.track} current />
          </>
        )}
        {queued.length > 0 && <h3>Next in queue</h3>}
        {queued.map((q) => (
          <QueueRow key={q.uid || q.uri} track={info.get(q.uri)} item={q} />
        ))}
        {rest.length > 0 && <h3>Next up</h3>}
        {rest.map((q) => (
          <QueueRow key={q.uid || q.uri} track={info.get(q.uri)} item={q} />
        ))}
      </div>
    </aside>
  );
}

function QueueRow({ track, item, current }: { track: NowPlaying | undefined; item?: QueuedTrack; current?: boolean }) {
  const nav = useNav();
  const openMenu = useContextMenu();
  const [saved] = useSaved(track?.uri);
  return (
    <div
      className={`queue-row ${current ? "current" : ""}`}
      title={current ? undefined : "Double-click to play"}
      onDoubleClick={() => item && play.skipTo(item.uri, item.uid).catch(toast)}
      onContextMenu={(e) => track && openMenu(e, trackMenu({ ...track, album: track.album.uri ? track.album : null }, saved, nav))}
    >
      <Cover src={track?.image ?? null} className="queue-cover" />
      <div className="queue-text">
        <div className="queue-name">{track?.name ?? "…"}</div>
        <div className="queue-artists">{track?.artists.map((a) => a.name).join(", ")}</div>
      </div>
      <span className="queue-time">{track ? formatDuration(track.duration_ms) : ""}</span>
    </div>
  );
}
