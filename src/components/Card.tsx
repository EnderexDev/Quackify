import type { Card as CardData } from "../api/types";
import { play } from "../api/spotify";
import { useNav } from "../state/nav";
import { usePlayer } from "../state/player";
import { toast } from "../state/toast";
import { useContextMenu } from "./ContextMenu";
import { cardMenuHandler } from "./menus";
import { Cover } from "./Cover";
import { PlayButton } from "./PlayButton";

/**
 * A tile: click opens the page, the play button plays it from the top. A song tile (recent
 * searches) plays the song. `onPick` hears both; `onRemove` adds a remove button.
 */
export function Card({ card, onPick, onRemove }: { card: CardData; onPick?: () => void; onRemove?: () => void }) {
  const nav = useNav();
  const player = usePlayer();
  const isTrack = card.kind === "track";
  const isCurrent = isTrack ? player.track?.uri === card.uri : player.contextUri === card.uri;
  const round = card.kind === "artist";
  const openMenu = useContextMenu();

  const onPlay = () => {
    onPick?.();
    if (isCurrent) player.toggle();
    else (isTrack ? play.tracks([card.uri], 0) : play.context(card.uri)).catch(toast);
  };

  return (
    <div
      className="card"
      onClick={() => (isTrack ? onPlay() : (onPick?.(), nav.open(card.uri)))}
      onContextMenu={cardMenuHandler(card, nav, openMenu)}
      title={card.title}
    >
      <div className="card-art">
        <Cover src={card.image} round={round} liked={card.kind === "liked"} />
        <PlayButton className="card-play" playing={isCurrent && player.playing} onClick={onPlay} />
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

/** One row of cards; "Show all" appears when `onShowAll` is given. */
export function Shelf({
  title,
  cards,
  onShowAll,
  onPick,
}: {
  title: string;
  cards: CardData[];
  onShowAll?: () => void;
  onPick?: (card: CardData) => void;
}) {
  if (cards.length === 0) return null;
  return (
    <section className="shelf">
      {(title || onShowAll) && (
        <div className="shelf-head">
          <h2>{title}</h2>
          {onShowAll && (
            <button className="link show-all" onClick={onShowAll}>
              Show all
            </button>
          )}
        </div>
      )}
      <div className="shelf-row">
        {cards.map((c) => (
          <Card key={c.uri} card={c} onPick={onPick && (() => onPick(c))} />
        ))}
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
    <div className={oneRow ? "shelf-row" : "card-grid"}>
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
