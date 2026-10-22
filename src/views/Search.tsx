import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import { play, recentSearches, removeRecentSearches, saveRecentSearch, search, searchTab } from "../api/spotify";
import type { Card, SearchPage, SearchTab } from "../api/types";
import { CardGrid, Shelf } from "../components/Card";
import { Cover } from "../components/Cover";
import { PlayButton } from "../components/PlayButton";
import { TrackList } from "../components/TrackList";
import { useNav } from "../state/nav";
import { usePlayer } from "../state/player";
import { toast } from "../state/toast";
import { kindLabel } from "../util/kinds";
import { useAsync } from "../util/useAsync";
import { BrowseAll } from "./Browse";
import { Empty, Failed, Loading } from "./common";

const DEBOUNCE_MS = 250;

// A function: read when drawn, in the language shown then.
const tabs = (): { id: SearchTab; label: string }[] => [
  { id: "all", label: t("All") },
  { id: "tracks", label: t("Songs") },
  { id: "artists", label: t("Artists") },
  { id: "albums", label: t("Albums") },
  { id: "playlists", label: t("Playlists") },
  { id: "podcasts", label: t("Podcasts") },
  { id: "episodes", label: t("Episodes") },
  { id: "users", label: t("Profiles") },
];

export function Search({ term, tab = "all" }: { term: string; tab?: SearchTab }) {
  const nav = useNav();
  // Wait for the typing to pause before asking Spotify.
  const [settled, setSettled] = useState(term.trim());
  useEffect(() => {
    const id = setTimeout(() => setSettled(term.trim()), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [term]);

  if (!settled) {
    return (
      <div className="page search-start">
        <RecentSearches />
        <BrowseAll />
      </div>
    );
  }
  return (
    <>
      <div className="search-tabs">
        {tabs().map((x) => (
          <button key={x.id} className={`chip ${tab === x.id ? "on" : ""}`} onClick={() => nav.replace({ page: "search", term, tab: x.id })}>
            {x.label}
          </button>
        ))}
      </div>
      {tab === "all" ? <Results term={settled} /> : <TabResults key={`${tab}:${settled}`} tab={tab} term={settled} />}
    </>
  );
}

/** One kind of result, every one of them as you scroll. */
function TabResults({ tab, term }: { tab: Exclude<SearchTab, "all">; term: string }) {
  const { data, error, loading, retry } = useAsync(() => searchTab(tab, term, 0), `${tab}:${term}`);
  if (error) return <Failed error={error} onRetry={retry} />;
  if (loading || !data) return <Loading />;
  return <TabPages tab={tab} term={term} first={data} />;
}

function TabPages({ tab, term, first }: { tab: Exclude<SearchTab, "all">; term: string; first: SearchPage }) {
  const [page, setPage] = useState(first);
  const sentinel = useRef<HTMLDivElement>(null);
  const loadingMore = useRef(false);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || page.next === null) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting || loadingMore.current || page.next === null) return;
        loadingMore.current = true;
        searchTab(tab, term, page.next)
          .then((more) =>
            setPage((p) => ({
              tracks: [...p.tracks, ...more.tracks],
              cards: [...p.cards, ...more.cards],
              total: more.total,
              next: more.tracks.length + more.cards.length ? more.next : null,
            })),
          )
          .catch((e) => {
            toast(e);
            setPage((p) => ({ ...p, next: null }));
          })
          .finally(() => (loadingMore.current = false));
      },
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [page.next, tab, term]);

  const empty = page.tracks.length + page.cards.length === 0;
  return (
    <div className="page search">
      {empty && <Empty title={t("Nothing for “{term}”", { term })} text={t("Check the spelling, or try fewer words.")} />}
      {tab === "tracks" ? (
        <TrackList
          tracks={page.tracks}
          contextUri={null}
          onPlay={(i) => {
            remember(page.tracks[i].uri);
            play.tracks(page.tracks.map((t) => t.uri), i).catch(toast);
          }}
        />
      ) : (
        <CardGrid cards={page.cards} onPick={(c) => remember(c.uri)} />
      )}
      {page.next !== null && (
        <div ref={sentinel} className="more">
          <div className="spinner small" />
        </div>
      )}
    </div>
  );
}

/** Remembers what was opened from the results, like Spotify's recent searches. */
const remember = (uri: string) => {
  saveRecentSearch(uri).catch((e) => console.warn("recent search not saved", e));
};

/** The account's recent searches: open one again, remove one, or clear them all. */
function RecentSearches() {
  const [items, setItems] = useState<Card[] | null>(null);
  useEffect(() => {
    let alive = true;
    recentSearches().then(
      (list) => alive && setItems(list),
      () => alive && setItems([]),
    );
    return () => {
      alive = false;
    };
  }, []);

  // Optimistic: gone at once, back if Spotify refuses.
  const remove = (uris: string[]) => {
    const before = items;
    setItems((list) => (list ?? []).filter((c) => !uris.includes(c.uri)));
    removeRecentSearches(uris).catch((e) => {
      toast(e);
      setItems(before);
    });
  };

  if (!items || items.length === 0) return null;
  return (
    <section className="recent-searches">
      <div className="shelf-head">
        <h2>{t("Recent searches")}</h2>
        <button className="link show-all" onClick={() => remove(items.map((c) => c.uri))}>
          {t("Clear recent searches")}
        </button>
      </div>
      <CardGrid cards={items.slice(0, 12)} onRemove={(c) => remove([c.uri])} oneRow />
    </section>
  );
}

function Results({ term }: { term: string }) {
  const nav = useNav();
  const player = usePlayer();
  const { data, error, loading, retry } = useAsync(() => search(term), term);
  if (error) return <Failed error={error} onRetry={retry} />;
  if (loading || !data) return <Loading />;

  const top = data.top;
  const songs = data.tracks.slice(0, 5);
  const topIsCurrent = !!top && player.contextUri === top.uri;
  const nothing =
    !top && !data.tracks.length && !data.artists.length && !data.albums.length && !data.playlists.length && !data.podcasts.length;
  if (nothing) {
    return (
      <div className="page center">
        <p className="muted">{t("No results for “{term}”.", { term })}</p>
      </div>
    );
  }

  return (
    <div className="page search">
      <div className="search-top">
        {top && (
          <section className="top-result-wrap">
            <h2>{t("Top result")}</h2>
            <div
              className="top-result"
              onClick={() => {
                remember(top.uri);
                nav.open(top.uri);
              }}
            >
              <Cover src={top.image} kind={top.kind} shaped className="top-cover" />
              <div className="top-title">{top.title}</div>
              <div className="top-sub">
                <span className="pill">{kindLabel(top)}</span>
                {top.kind !== "artist" && <span className="muted">{top.subtitle}</span>}
              </div>
              <PlayButton
                className="top-play"
                playing={topIsCurrent && player.playing}
                onClick={() => {
                  remember(top.uri);
                  if (topIsCurrent) player.toggle();
                  else play.context(top.uri).catch(toast);
                }}
              />
            </div>
          </section>
        )}
        {songs.length > 0 && (
          <section className="search-songs">
            <h2>{t("Songs")}</h2>
            <TrackList
              tracks={songs}
              showAlbum={false}
              showHeader={false}
              contextUri={null}
              onPlay={(i) => {
                remember(data.tracks[i].uri);
                play.tracks(data.tracks.map((t) => t.uri), i).catch(toast);
              }}
            />
          </section>
        )}
      </div>
      <Shelf title={t("Artists")} cards={data.artists} onPick={(c) => remember(c.uri)} />
      <Shelf title={t("Albums")} cards={data.albums} onPick={(c) => remember(c.uri)} />
      <Shelf title={t("Playlists")} cards={data.playlists} onPick={(c) => remember(c.uri)} />
      <Shelf title={t("Podcasts")} cards={data.podcasts} onPick={(c) => remember(c.uri)} />
      <Shelf title={t("Episodes")} cards={data.episodes} onPick={(c) => remember(c.uri)} />
    </div>
  );
}
