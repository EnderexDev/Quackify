// Browse all (genres and moods, on the search page), Explore, and a genre's own page.
import { useState } from "react";
import { browseAll, browsePage } from "../api/spotify";
import type { Category } from "../api/types";
import { Shelf } from "../components/Card";
import { useNav } from "../state/nav";
import { BROWSE_GROUPS, browseGroup, MOOD_CHIPS } from "../util/browseGroups";
import { useAsync } from "../util/useAsync";
import { Empty, Failed, Loading } from "./common";

/** A break the browser may take without drawing anything. */
const ZWSP = String.fromCharCode(0x200b);

/** One genre or mood: Spotify's color, the title, a cover tilted in the corner. */
function CategoryTile({ c }: { c: Category }) {
  const nav = useNav();
  return (
    <button className="category" style={{ background: c.color }} onClick={() => nav.open(c.uri)}>
      {/* "Dance/Electronic" breaks after the slash, not inside a word. */}
      <span className="category-title">{c.title.split("/").join("/" + ZWSP)}</span>
      {c.image && <img className="category-art" src={c.image} alt="" loading="lazy" draggable={false} />}
    </button>
  );
}

/** The colored tiles of every genre and mood. */
export function BrowseAll() {
  const { data, error } = useAsync(browseAll, "browseAll");
  if (error) return <p className="muted">Could not load Browse all.</p>;
  if (!data) return <div className="spinner" />;
  return (
    <section className="browse-all">
      <h2>Browse all</h2>
      <div className="category-grid">
        {data.map((c) => (
          <CategoryTile key={c.uri} c={c} />
        ))}
      </div>
    </section>
  );
}

/** The Explore tab of the top bar: quick moods, then genres, moods and the rest in sections. */
export function ExploreView() {
  const nav = useNav();
  const { data, error, retry } = useAsync(browseAll, "browseAll");
  if (error) return <Failed error={error} onRetry={retry} />;
  if (!data) return <Loading />;
  const chips = MOOD_CHIPS.map((uri) => data.find((c) => c.uri === uri)).filter((c): c is Category => !!c);
  return (
    <div className="page explore">
      <h1 className="page-title">Explore</h1>
      {chips.length > 0 && (
        <div className="mood-chips">
          {chips.map((c) => (
            <button key={c.uri} className="chip" onClick={() => nav.open(c.uri)}>
              {c.title}
            </button>
          ))}
        </div>
      )}
      {BROWSE_GROUPS.map((g) => (
        <CategorySection key={g.id} title={g.title} tiles={data.filter((c) => browseGroup(c.uri) === g.id)} />
      ))}
    </div>
  );
}

/** A section of tiles: one row, and every tile with "Show all". */
function CategorySection({ title, tiles }: { title: string; tiles: Category[] }) {
  const [all, setAll] = useState(false);
  if (!tiles.length) return null;
  return (
    <section className="shelf">
      <div className="shelf-head">
        <h2>{title}</h2>
        <button className="link show-all" onClick={() => setAll((v) => !v)}>
          {all ? "Show less" : "Show all"}
        </button>
      </div>
      <div className={`category-grid ${all ? "" : "one-row"}`}>
        {tiles.map((c) => (
          <CategoryTile key={c.uri} c={c} />
        ))}
      </div>
    </section>
  );
}

/** A genre or mood: a band in its color with its cover tilted, then its rows. */
export function BrowseView({ uri }: { uri: string }) {
  const nav = useNav();
  const { data, error, loading, retry } = useAsync(() => browsePage(uri), uri);
  // The color and cover are the tile's: the page itself does not send them.
  const tiles = useAsync(browseAll, "browseAll").data;
  const tile = tiles?.find((c) => c.uri === uri);
  if (error) return <Failed error={error} onRetry={retry} />;
  if (loading || !data) return <Loading />;
  return (
    <div className="page browse">
      <header className="genre-band" style={{ ["--tint" as string]: tile?.color ?? "#3a3a3a" }}>
        <h1 className="page-title">{data.title}</h1>
        {tile?.image && <img className="genre-art" src={tile.image} alt="" draggable={false} />}
      </header>
      {data.sections.map((s, i) => (
        <Shelf
          key={`${s.uri}:${i}`}
          title={s.title}
          cards={s.cards}
          onShowAll={s.more && s.uri ? () => nav.go({ page: "cards", source: "browse", uri: s.uri!, title: s.title, from: data.title }) : undefined}
        />
      ))}
      {data.sections.length === 0 && <Empty title="Nothing here yet" />}
    </div>
  );
}
