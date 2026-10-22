// The peek's layer: the rest darkened, the card's cover lifted, and beside it a preview in the
// cover's colour with its actions and first songs (state/peek.ts opens it).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { artist, collection, play } from "../api/spotify";
import type { Card, Track } from "../api/types";
import { songsOf, queueSongs } from "../state/drag";
import { useNav } from "../state/nav";
import { closePeek, pressInPeek, usePeekState, type PeekOpen } from "../state/peek";
import { usePlayer } from "../state/player";
import { useSaved } from "../state/saved";
import { toast } from "../state/toast";
import { coverColors, GRAPHITE, type CoverColors } from "../util/coverColors";
import { formatDuration, formatLength } from "../util/format";
import { kindLabel } from "../util/kinds";
import { useContextMenu } from "./ContextMenu";
import { Cover } from "./Cover";
import { HeartIcon, HeartOutlineIcon, MoreIcon, PlayIcon, QueueIcon } from "./icons";
import { cardMenuHandler } from "./menus";

/** How many songs the preview lists. */
const SHOWN = 6;
const WIDTH = 356;

type Preview = { line: string; total: number; tracks: Track[] };

async function preview(card: Card): Promise<Preview> {
  if (card.kind === "artist") {
    const a = await artist(card.uri);
    return { line: "Popular songs", total: a.topTracks.length, tracks: a.topTracks };
  }
  const c = await collection(card.uri);
  // The length only when every song is in: a long playlist comes a page at a time.
  const length = c.tracks.length === c.total ? formatLength(c.tracks.reduce((n, t) => n + t.durationMs, 0)) : "";
  const count = `${c.total.toLocaleString()} ${c.total === 1 ? "song" : "songs"}`;
  return { line: [c.owner, length ? `${count}, ${length}` : count].filter(Boolean).join(" · "), total: c.total, tracks: c.tracks };
}

export function PeekLayer() {
  const peek = usePeekState();
  if (!peek) return null;
  return createPortal(<PeekPanel key={peek.card.uri} peek={peek} />, document.body);
}

function PeekPanel({ peek }: { peek: PeekOpen }) {
  const { card, rect, cover, mode } = peek;
  const nav = useNav();
  const player = usePlayer();
  const openMenu = useContextMenu();
  const [saved, toggleSaved] = useSaved(card.kind === "liked" ? null : card.uri);
  const [data, setData] = useState<Preview | null>(null);
  const [colors, setColors] = useState<CoverColors>(GRAPHITE);
  const panel = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(rect.top);
  const queue = useRef(player.queue);
  queue.current = player.queue;

  useEffect(() => {
    let alive = true;
    preview(card).then(
      (p) => alive && setData(p),
      (e) => alive && (toast(e), closePeek()),
    );
    if (card.image) coverColors(card.image).then((c) => alive && setColors(c));
    return () => {
      alive = false;
    };
  }, [card]);

  // Beside the card, on the side with room, and inside the window.
  const left = rect.right + 12 + WIDTH < window.innerWidth - 12 ? rect.right + 12 : Math.max(12, rect.left - 12 - WIDTH);
  useLayoutEffect(() => {
    const h = panel.current?.offsetHeight ?? 0;
    setTop(Math.max(12, Math.min(rect.top - 12, window.innerHeight - h - 12)));
  }, [data, rect.top]);

  const done = () => {
    closePeek();
    if (mode === "key") peek.from.focus();
  };
  const run = (f: () => unknown) => () => {
    f();
    done();
  };
  const actions = {
    play: run(() => play.context(card.uri).catch(toast)),
    save: run(() => toggleSaved()),
    queue: run(() =>
      songsOf(card.uri)
        .then((uris) => queueSongs(uris, false, () => queue.current).then(() => toast(`Added ${uris.length} songs to the queue`)))
        .catch(toast),
    ),
    open: run(() => nav.open(card.uri, card.title)),
  };

  // Released after a hold: on a button or a song that runs; anywhere else it only closes.
  useEffect(() => {
    if (mode !== "hold") return;
    const up = (e: PointerEvent) => {
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-peek-act]");
      if (target) pressInPeek(target);
      else closePeek();
    };
    window.addEventListener("pointerup", up, { once: true });
    return () => window.removeEventListener("pointerup", up);
  }, [mode]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        done();
      } else if (e.key === "Enter" && !(e.target as HTMLElement)?.closest?.("button")) {
        e.preventDefault();
        actions.open();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });

  const isArtist = card.kind === "artist";
  const shown = data?.tracks.slice(0, SHOWN) ?? [];
  return (
    <div className={`peek ${mode}`} role="dialog" aria-label={`Peek: ${card.title}`}>
      <div className="peek-scrim" onPointerDown={() => mode === "key" && done()} />
      {cover && (
        <div className="peek-lift" style={{ left: cover.left, top: cover.top, width: cover.width, height: cover.height }}>
          <Cover src={card.image} kind={card.kind} shaped />
        </div>
      )}
      <div
        ref={panel}
        className="peek-panel"
        style={{ left, top, width: WIDTH, "--peek-base": colors.base, "--peek-glow": colors.glow } as React.CSSProperties}
      >
        <div className="peek-head">
          <Cover src={card.image} kind={card.kind} className="peek-cover" />
          <div className="peek-titles">
            <span className="peek-kind">{kindLabel(card)}</span>
            <strong className="peek-title">{card.title}</strong>
            <span className="peek-line">{data?.line ?? " "}</span>
          </div>
        </div>
        <div className="peek-actions">
          <button className="peek-btn play" data-peek-act onClick={actions.play}>
            <PlayIcon size={14} />
            Play
          </button>
          {card.kind !== "liked" && (
            <button className="peek-btn" data-peek-act onClick={actions.save} disabled={saved === undefined}>
              {saved ? <HeartIcon size={14} /> : <HeartOutlineIcon size={14} />}
              {isArtist ? (saved ? "Following" : "Follow") : saved ? "Saved" : "Save"}
            </button>
          )}
          <button className="peek-btn" data-peek-act onClick={actions.queue}>
            <QueueIcon size={14} />
            Queue
          </button>
          <button
            className="peek-btn"
            data-peek-act
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              closePeek();
              cardMenuHandler(card, nav, openMenu)({ clientX: r.left, clientY: r.bottom + 4, preventDefault: () => {} });
            }}
          >
            <MoreIcon size={14} />
            More
          </button>
        </div>
        <div className="peek-tracks">
          {!data && Array.from({ length: SHOWN }, (_, i) => <div key={i} className="peek-track loading" />)}
          {shown.map((t, i) => (
            <button
              key={`${t.uri}:${i}`}
              className={`peek-track ${player.track?.uri === t.uri ? "current" : ""}`}
              data-peek-act
              disabled={!t.playable}
              onClick={run(() => play.context(card.uri, t.uri).catch(toast))}
            >
              <span className="peek-num">{i + 1}</span>
              <span className="peek-name">{t.name}</span>
              <span className="peek-time">{formatDuration(t.durationMs)}</span>
            </button>
          ))}
          {data && data.total > shown.length && !isArtist && (
            <span className="peek-more">+ {(data.total - shown.length).toLocaleString()} songs</span>
          )}
        </div>
        <div className="peek-foot">
          <span>{mode === "hold" ? "Release to close" : "Esc closes"}</span>
          <span>Enter opens the page</span>
        </div>
      </div>
    </div>
  );
}
