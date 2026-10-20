// "Show all": every card of a row, loaded a page at a time as the end comes into view.
import { useEffect, useRef, useState } from "react";
import { browseSection, discography, homeSection, relatedArtists } from "../api/spotify";
import type { Card, CardPage } from "../api/types";
import { CardGrid } from "../components/Card";
import type { Route } from "../state/nav";
import { toast } from "../state/toast";
import { useAsync } from "../util/useAsync";
import { Failed, Loading } from "./common";

type Source = Extract<Route, { page: "cards" }>["source"];

const LOADERS: Record<Source, (uri: string, offset: number) => Promise<CardPage>> = {
  home: homeSection,
  browse: browseSection,
  discography,
  // All of them come in one answer.
  related: (uri, offset) => (offset ? Promise.resolve({ title: "", cards: [], total: 0, next: null }) : relatedArtists(uri)),
};

/** The heading: the row's own title; for an artist's pages, the artist's name (`title`) below. */
function heading(source: Source, page: CardPage, title?: string) {
  if (source === "discography") return { title: "Discography", subtitle: page.title || title || "" };
  if (source === "related") return { title: "Fans also like", subtitle: page.title || title || "" };
  return { title: title || page.title, subtitle: "" };
}

export function CardsView({ source, uri, title }: { source: Source; uri: string; title?: string }) {
  const load = LOADERS[source];
  const { data, error, loading } = useAsync(() => load(uri, 0), `${source}:${uri}`);
  if (error) return <Failed error={error} />;
  if (loading || !data) return <Loading />;
  const head = heading(source, data, title);
  return (
    <div className="page cards-page">
      <h1 className="page-title">{head.title}</h1>
      {head.subtitle && <p className="muted page-subtitle">{head.subtitle}</p>}
      <Pages first={data} load={(offset) => load(uri, offset)} />
    </div>
  );
}

function Pages({ first, load }: { first: CardPage; load: (offset: number) => Promise<CardPage> }) {
  const [cards, setCards] = useState<Card[]>(first.cards);
  const [next, setNext] = useState<number | null>(first.next);
  const sentinel = useRef<HTMLDivElement>(null);
  const loadingMore = useRef(false);

  // Next page when the end of the grid comes into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || next === null) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting || loadingMore.current) return;
        loadingMore.current = true;
        load(next)
          .then((page) => {
            setCards((prev) => [...prev, ...page.cards]);
            // A page that adds nothing ends the list, even if Spotify offers another.
            setNext(page.cards.length ? page.next : null);
          })
          .catch((e) => {
            toast(e);
            setNext(null);
          })
          .finally(() => (loadingMore.current = false));
      },
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next]);

  return (
    <>
      <CardGrid cards={cards} />
      {cards.length === 0 && <p className="muted">Nothing here yet.</p>}
      {next !== null && (
        <div ref={sentinel} className="more">
          <div className="spinner small" />
        </div>
      )}
    </>
  );
}
