import type { Card as CardData } from "../api/types";
import { play } from "../api/spotify";
import { useNav } from "../state/nav";
import { usePlayer } from "../state/player";
import { toast } from "../state/toast";
import { Cover } from "./Cover";
import { PlayButton } from "./PlayButton";

/** A tile: click opens the page, the play button plays it from the top. */
export function Card({ card }: { card: CardData }) {
  const nav = useNav();
  const player = usePlayer();
  const isCurrent = player.contextUri === card.uri;
  const round = card.kind === "artist";

  const onPlay = () => {
    if (isCurrent) player.toggle();
    else play.context(card.uri).catch(toast);
  };

  return (
    <div className="card" onClick={() => nav.open(card.uri)} title={card.title}>
      <div className="card-art">
        <Cover src={card.image} round={round} liked={card.kind === "liked"} />
        <PlayButton className="card-play" playing={isCurrent && player.playing} onClick={onPlay} />
      </div>
      <div className="card-title">{card.title}</div>
      <div className="card-sub">{card.subtitle}</div>
    </div>
  );
}

export function Shelf({ title, cards }: { title: string; cards: CardData[] }) {
  if (cards.length === 0) return null;
  return (
    <section className="shelf">
      {title && <h2>{title}</h2>}
      <div className="shelf-row">
        {cards.map((c) => (
          <Card key={c.uri} card={c} />
        ))}
      </div>
    </section>
  );
}
