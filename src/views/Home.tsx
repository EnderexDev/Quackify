import { getHome, play } from "../api/spotify";
import type { Card as CardData } from "../api/types";
import { Shelf } from "../components/Card";
import { Cover } from "../components/Cover";
import { PlayButton } from "../components/PlayButton";
import { useNav } from "../state/nav";
import { usePlayer } from "../state/player";
import { toast } from "../state/toast";
import { useAsync } from "../util/useAsync";
import { Failed, Loading } from "./common";

/** Spotify's own home for this account: shortcuts on top, then its sections. */
export function Home() {
  const nav = useNav();
  const { data, error, loading } = useAsync(getHome, "home");
  if (error) return <Failed error={error} />;
  if (loading || !data) return <Loading />;

  // The untitled first section is the grid of shortcuts Spotify puts at the top.
  const [first, ...rest] = data.sections;
  const shortcuts = first && !first.title ? first.cards.slice(0, 8) : [];
  const sections = shortcuts.length ? rest : data.sections;

  return (
    <div className="page home">
      <h1 className="greeting">{data.greeting}</h1>
      {shortcuts.length > 0 && (
        <div className="shortcuts">
          {shortcuts.map((c) => (
            <Shortcut key={c.uri} card={c} />
          ))}
        </div>
      )}
      {sections.map((s, i) => (
        <Shelf
          key={`${s.title}:${i}`}
          title={s.title}
          cards={s.cards}
          onShowAll={s.more && s.uri ? () => nav.go({ page: "cards", source: "home", uri: s.uri!, title: s.title }) : undefined}
        />
      ))}
    </div>
  );
}

function Shortcut({ card }: { card: CardData }) {
  const nav = useNav();
  const player = usePlayer();
  const isCurrent = player.contextUri === card.uri;
  return (
    <div className="shortcut" onClick={() => nav.open(card.uri)} title={card.title}>
      <Cover src={card.image} round={card.kind === "artist"} liked={card.kind === "liked"} className="shortcut-cover" />
      <span className={`shortcut-title ${isCurrent ? "accent" : ""}`}>{card.title}</span>
      <PlayButton
        size={36}
        className="shortcut-play"
        playing={isCurrent && player.playing}
        onClick={() => (isCurrent ? player.toggle() : play.context(card.uri).catch(toast))}
      />
    </div>
  );
}
