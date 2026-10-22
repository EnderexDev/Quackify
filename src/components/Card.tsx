import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Card as CardData } from "../api/types";
import { play } from "../api/spotify";
import { useNav } from "../state/nav";
import { kindLabel, TAGGED_KINDS } from "../util/kinds";
import { usePlayer } from "../state/player";
import { toast } from "../state/toast";
import { useContextMenu } from "./ContextMenu";
import { cardMenuHandler } from "./menus";
import { Cover } from "./Cover";
import { BackIcon, ForwardIcon, PinIcon } from "./icons";
import { PlayButton } from "./PlayButton";

/**
 * A tile: click opens the page, the play button plays it from the top. A song tile (recent
 * searches) plays the song. `onPick` hears both; `onRemove` adds a remove button; `onMenu`
 * replaces the usual right-click menu (Your Library adds Pin to it). A folder has no play.
 */
export function Card({
  card,
  onPick,
  onRemove,
  onMenu,
}: {
  card: CardData;
  onPick?: () => void;
  onRemove?: () => void;
  onMenu?: (e: React.MouseEvent) => void;
}) {
  const nav = useNav();
  const player = usePlayer();
  const isTrack = card.kind === "track" || card.kind === "episode";
  const isCurrent = isTrack ? player.track?.uri === card.uri : player.contextUri === card.uri;
  const openMenu = useContextMenu();

  const onPlay = () => {
    onPick?.();
    if (isCurrent) player.toggle();
    else (isTrack ? play.tracks([card.uri], 0) : play.context(card.uri)).catch(toast);
  };

  return (
    <div
      className="card"
      onClick={() => (isTrack ? onPlay() : (onPick?.(), nav.open(card.uri, card.title)))}
      onContextMenu={onMenu ?? cardMenuHandler(card, nav, openMenu)}
      title={card.title}
    >
      <div className="card-art">
        <Cover src={card.image} kind={card.kind} shaped />
        {TAGGED_KINDS.has(card.kind) && <span className="card-tag">{kindLabel(card)}</span>}
        {card.pinned && !onRemove && (
          <span className="card-pin" title="Pinned">
            <PinIcon size={13} />
          </span>
        )}
        {card.kind !== "folder" && <PlayButton className="card-play" playing={isCurrent && player.playing} onClick={onPlay} />}
        {onRemove && (
          <button
            className="card-remove"
            aria-label="Remove"
            title="Remove"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            ×
          </button>
        )}
      </div>
      <div className="card-title">{card.title}</div>
      <div className="card-sub">{card.subtitle}</div>
    </div>
  );
}

/** One row of cards that scrolls sideways, with arrows and by dragging; "Show all" appears when `onShowAll` is given. */
export function Shelf({
  title,
  note,
  cards,
  onShowAll,
  onPick,
}: {
  title: string;
  /** A small line after the title ("only you see this"). */
  note?: string;
  cards: CardData[];
  onShowAll?: () => void;
  onPick?: (card: CardData) => void;
}) {
  if (cards.length === 0) return null;
  return (
    <ShelfRow title={title} note={note} onShowAll={onShowAll}>
      {cards.map((c) => (
        <Card key={c.uri} card={c} onPick={onPick && (() => onPick(c))} />
      ))}
    </ShelfRow>
  );
}

/** How far the mouse moves before a press on the row becomes a drag instead of a click. */
const DRAG_PX = 6;

/** The sideways-scrolling row under a title, for cards or any other tiles. */
export function ShelfRow({ title, note, onShowAll, children }: { title: string; note?: string; onShowAll?: () => void; children: ReactNode }) {
  const row = useRef<HTMLDivElement>(null);
  const [ends, setEnds] = useState({ start: true, end: true });

  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const update = () => setEnds({ start: el.scrollLeft <= 1, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 });
    update();
    el.addEventListener("scroll", update, { passive: true });
    const sizes = new ResizeObserver(update);
    sizes.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      sizes.disconnect();
    };
  }, []);

  const page = (dir: 1 | -1) => row.current?.scrollBy({ left: dir * row.current.clientWidth, behavior: "smooth" });

  return (
    <section className="shelf">
      <div className="shelf-head">
        <h2>
          {title}
          {note && <span className="shelf-note">{note}</span>}
        </h2>
        {onShowAll && (
          <button className="link show-all" onClick={onShowAll}>
            Show all
          </button>
        )}
        {!(ends.start && ends.end) && (
          <div className="shelf-arrows">
            <button className="round-button" aria-label="Scroll back" disabled={ends.start} onClick={() => page(-1)}>
              <BackIcon size={16} />
            </button>
            <button className="round-button" aria-label="Scroll forward" disabled={ends.end} onClick={() => page(1)}>
              <ForwardIcon size={16} />
            </button>
          </div>
        )}
      </div>
      <div
        ref={row}
        className="shelf-row"
        onPointerDown={(e) => {
          const el = row.current;
          if (!el || e.button !== 0 || e.pointerType !== "mouse") return;
          const startX = e.clientX;
          const startLeft = el.scrollLeft;
          let dragging = false;
          const move = (m: PointerEvent) => {
            const dx = m.clientX - startX;
            if (!dragging && Math.abs(dx) < DRAG_PX) return;
            if (!dragging) {
              dragging = true;
              el.setPointerCapture(e.pointerId);
              el.classList.add("dragging");
            }
            el.scrollLeft = startLeft - dx;
          };
          const up = () => {
            el.removeEventListener("pointermove", move);
            el.removeEventListener("pointerup", up);
            el.removeEventListener("pointercancel", up);
            el.classList.remove("dragging");
            // The click that ends a drag does not open the card under the mouse.
            if (!dragging) return;
            const eat = (c: MouseEvent) => c.stopPropagation();
            el.addEventListener("click", eat, { capture: true });
            // The click comes right after the release, if at all: never let it eat a later one.
            setTimeout(() => el.removeEventListener("click", eat, { capture: true }), 0);
          };
          el.addEventListener("pointermove", move);
          el.addEventListener("pointerup", up);
          el.addEventListener("pointercancel", up);
        }}
      >
        {children}
      </div>
    </section>
  );
}

/** Cards in as many rows as they need, or in one row that hides what does not fit. */
export function CardGrid({
  cards,
  onPick,
  onRemove,
  oneRow = false,
}: {
  cards: CardData[];
  onPick?: (card: CardData) => void;
  onRemove?: (card: CardData) => void;
  oneRow?: boolean;
}) {
  return (
    <div className={oneRow ? "card-row" : "card-grid"}>
      {cards.map((c, i) => (
        <Card
          key={`${c.uri}:${i}`}
          card={c}
          onPick={onPick && (() => onPick(c))}
          onRemove={onRemove && (() => onRemove(c))}
        />
      ))}
    </div>
  );
}
