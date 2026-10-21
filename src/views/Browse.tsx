// Browse all (genres and moods, on the search page) and a genre's own page.
import { browseAll, browsePage } from "../api/spotify";
import { Shelf } from "../components/Card";
import { useNav } from "../state/nav";
import { useAsync } from "../util/useAsync";
import { Failed, Loading } from "./common";

/** The colored tiles of every genre and mood. */
export function BrowseAll() {
  const nav = useNav();
  const { data, error } = useAsync(browseAll, "browseAll");
  if (error) return <p className="muted">Could not load Browse all.</p>;
  if (!data) return <div className="spinner" />;
  return (
    <section className="browse-all">
      <h2>Browse all</h2>
      <div className="category-grid">
        {data.map((c) => (
          <button key={c.uri} className="category" style={{ background: c.color }} onClick={() => nav.open(c.uri)}>
            <span className="category-title">{c.title}</span>
            {c.image && <img className="category-art" src={c.image} alt="" loading="lazy" />}
          </button>
        ))}
      </div>
    </section>
  );
}

/** The Explore tab of the top bar: every genre and mood. */
export function ExploreView() {
  return (
    <div className="page explore">
      <h1 className="page-title">Explore</h1>
      <BrowseAll />
    </div>
  );
}

/** A genre or mood: its rows, each with "Show all" when it has more. */
export function BrowseView({ uri }: { uri: string }) {
  const nav = useNav();
  const { data, error, loading } = useAsync(() => browsePage(uri), uri);
  if (error) return <Failed error={error} />;
  if (loading || !data) return <Loading />;
  return (
    <div className="page browse">
      <h1 className="page-title">{data.title}</h1>
      {data.sections.map((s, i) => (
        <Shelf
          key={`${s.uri}:${i}`}
          title={s.title}
          cards={s.cards}
          onShowAll={s.more && s.uri ? () => nav.go({ page: "cards", source: "browse", uri: s.uri!, title: s.title }) : undefined}
        />
      ))}
      {data.sections.length === 0 && <p className="muted">Nothing here yet.</p>}
    </div>
  );
}
