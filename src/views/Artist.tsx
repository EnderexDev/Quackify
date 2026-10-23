import { useState } from "react";
import { artist, collection, discography, play } from "../api/spotify";
import { t } from "../i18n";
import type { Artist as Data, Card as CardData } from "../api/types";
import { CardGrid, Shelf } from "../components/Card";
import { Cover } from "../components/Cover";
import { SaveButton } from "../components/LikeButton";
import { PlayButton } from "../components/PlayButton";
import { Segmented } from "../components/Segmented";
import { TrackList } from "../components/TrackList";
import { useContextMenu } from "../components/ContextMenu";
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, GridIcon, ListIcon, ShuffleIcon } from "../components/icons";
import { followMenu } from "../components/menus";
import { useNav } from "../state/nav";
import { useSaved } from "../state/saved";
import { usePlayerNow, usePlayerSelect } from "../state/player";
import { toast } from "../state/toast";
import { formatCount } from "../util/format";
import { useAsync } from "../util/useAsync";
import { usePaged } from "./Cards";
import { Empty, Failed, Loading } from "./common";

type Tab = "overview" | "discography" | "about";
// A function: read when drawn, in the language shown then.
const tabs = (): { id: Tab; label: string }[] => [
  { id: "overview", label: t("Overview") },
  { id: "discography", label: t("Discography") },
  { id: "about", label: t("About") },
];
/** Discography as cards or as albums that open into their songs; the choice is kept. */
const DISCO_VIEW_KEY = "discographyView";

/** An artist: header and actions, then Overview, Discography and About. */
export function Artist({ uri }: { uri: string }) {
  const getPlayer = usePlayerNow();
  const trackUri = usePlayerSelect((p) => p.track?.uri ?? null);
  const playing = usePlayerSelect((p) => p.playing);
  const shuffle = usePlayerSelect((p) => p.shuffle);
  const openMenu = useContextMenu();
  const [following] = useSaved(uri);
  const [tab, setTab] = useState<Tab>("overview");
  const { data, error, loading, retry } = useAsync(() => artist(uri), uri);
  if (error) return <Failed error={error} onRetry={retry} />;
  if (loading || !data) return <Loading />;

  const top = data.topTracks;
  const topUris = top.map((t) => t.uri);
  const isCurrent = !!trackUri && topUris.includes(trackUri);

  return (
    <div className="page artist">
      <header
        className="artist-hero"
        style={{ backgroundImage: data.header ? `url(${data.header})` : data.image ? `url(${data.image})` : undefined }}
      >
        <div className="artist-hero-shade" />
        <div className="artist-hero-text">
          {data.verified && (
            <span className="verified">
              <span className="verified-badge">
                <CheckIcon size={11} />
              </span>
              {t("Verified artist")}
            </span>
          )}
          <h1>{data.name}</h1>
          {data.monthlyListeners !== null && <p>{t("{n} monthly listeners", { n: formatCount(data.monthlyListeners) })}</p>}
        </div>
      </header>
      <div className="actions artist-actions">
        <PlayButton
          size={56}
          playing={isCurrent && playing}
          onClick={() => (isCurrent ? getPlayer().toggle() : top.length && play.tracks(topUris, 0).catch(toast))}
        />
        <button
          className={`icon-btn big ${shuffle ? "on" : ""}`}
          onClick={() => getPlayer().setShuffle(!shuffle)}
          aria-label={shuffle ? t("Disable shuffle") : t("Enable shuffle")}
          title={shuffle ? t("Disable shuffle") : t("Enable shuffle")}
        >
          <ShuffleIcon size={28} />
        </button>
        <SaveButton uri={uri} kind="artist" />
        <button className="more-btn" aria-label={t("More options for {name}", { name: data.name })} title={t("More options")} onClick={(e) => openMenu(e, followMenu(uri, following))}>
          •••
        </button>
        <Segmented className="artist-tabs" options={tabs()} value={tab} onChange={setTab} label={t("Artist")} />
      </div>
      {tab === "overview" && <Overview data={data} onAbout={() => setTab("about")} />}
      {tab === "discography" && <Discography uri={uri} name={data.name} />}
      {tab === "about" && <About data={data} />}
    </div>
  );
}

function Overview({ data, onAbout }: { data: Data; onAbout: () => void }) {
  const nav = useNav();
  const [showAll, setShowAll] = useState(false);
  const uri = data.uri;
  const top = data.topTracks;
  const topUris = top.map((t) => t.uri);
  const shownReleases = data.albums.length + data.singles.length;
  const showDiscography =
    data.releaseCount > shownReleases ? () => nav.go({ page: "cards", source: "discography", uri, from: data.name }) : undefined;
  const side = !!data.pick || !!data.bio;

  return (
    <>
      <div className={`artist-overview ${side ? "with-side" : ""}`}>
        {top.length > 0 && (
          <section className="artist-popular">
            <h2>{t("Popular")}</h2>
            <TrackList
              tracks={showAll ? top : top.slice(0, 5)}
              showAlbum={false}
              showPlays
              showHeader={false}
              contextUri={null}
              onPlay={(i) => play.tracks(topUris, i).catch(toast)}
            />
            {top.length > 5 && (
              <button className="link see-more" onClick={() => setShowAll(!showAll)}>
                {showAll ? t("Show less") : t("See more")}
              </button>
            )}
          </section>
        )}
        {side && (
          <aside className="artist-side">
            {data.pick && <ArtistPick card={data.pick.card} comment={data.pick.comment} />}
            {data.bio && (
              <div className="side-card">
                <h3>{t("About")}</h3>
                <p className="side-bio">{data.bio}</p>
                <button className="link side-more" onClick={onAbout}>
                  {t("Read more")}
                </button>
              </div>
            )}
          </aside>
        )}
      </div>
      <Shelf title={t("Albums")} cards={data.albums} onShowAll={showDiscography} />
      <Shelf title={t("Singles and EPs")} cards={data.singles} onShowAll={showDiscography} />
      <Shelf
        title={t("Fans also like")}
        cards={data.related}
        onShowAll={data.relatedCount > data.related.length ? () => nav.go({ page: "cards", source: "related", uri, from: data.name }) : undefined}
      />
      <Shelf title={t("Appears On")} cards={data.appearsOn} />
    </>
  );
}

function ArtistPick({ card, comment }: { card: CardData; comment: string }) {
  const nav = useNav();
  return (
    <div className="side-card">
      <h3>{t("Artist's pick")}</h3>
      <div className="pick" onClick={() => nav.open(card.uri)}>
        <Cover src={card.image} kind={card.kind} className="pick-cover" />
        <div className="pick-text">
          <div className="pick-title">{card.title}</div>
          <div className="pick-sub">{comment ? `${card.subtitle} · "${comment}"` : card.subtitle}</div>
        </div>
      </div>
    </div>
  );
}

/** Every release, newest first, as cards or as a list whose albums open into their songs. */
function Discography({ uri, name }: { uri: string; name: string }) {
  const [view, setView] = useState<"grid" | "list">(() => (localStorage.getItem(DISCO_VIEW_KEY) === "list" ? "list" : "grid"));
  const { data, error } = useAsync(() => discography(uri, 0), `discography:${uri}`);
  const pick = (v: "grid" | "list") => {
    setView(v);
    if (v === "list") localStorage.setItem(DISCO_VIEW_KEY, v);
    else localStorage.removeItem(DISCO_VIEW_KEY);
  };
  if (error) return <p className="muted">{t("Could not load the discography.")}</p>;
  if (!data) return <div className="spinner" />;
  return (
    <section className="discography">
      <div className="shelf-head">
        <h2>{t("Discography")}</h2>
        <div className="view-toggle">
          <button className={`icon-btn ${view === "grid" ? "on" : ""}`} aria-label={t("Grid")} title={t("Grid")} onClick={() => pick("grid")}>
            <GridIcon size={18} />
          </button>
          <button className={`icon-btn ${view === "list" ? "on" : ""}`} aria-label={t("List")} title={t("List")} onClick={() => pick("list")}>
            <ListIcon size={18} />
          </button>
        </div>
      </div>
      <DiscographyPages key={view} view={view} first={data} load={(offset) => discography(uri, offset)} name={name} />
    </section>
  );
}

function DiscographyPages({
  view,
  first,
  load,
  name,
}: {
  view: "grid" | "list";
  first: Awaited<ReturnType<typeof discography>>;
  load: (offset: number) => ReturnType<typeof discography>;
  name: string;
}) {
  const { cards, more, sentinel } = usePaged(first, load);
  return (
    <>
      {view === "grid" ? (
        <CardGrid cards={cards} />
      ) : (
        <div className="disco-list">
          {cards.map((c) => (
            <Release key={c.uri} card={c} artist={name} />
          ))}
        </div>
      )}
      {cards.length === 0 && <Empty title={t("Nothing here yet")} />}
      {more && (
        <div ref={sentinel} className="more">
          <div className="spinner small" />
        </div>
      )}
    </>
  );
}

/** One release of the list: closed it is a line; open it lists its songs. */
function Release({ card, artist: artistName }: { card: CardData; artist: string }) {
  const getPlayer = usePlayerNow();
  const playingContext = usePlayerSelect((p) => p.contextUri);
  const playing = usePlayerSelect((p) => p.playing);
  const [open, setOpen] = useState(false);
  // A retry is a new key: the failed read is already out of the cache.
  const [attempt, setAttempt] = useState(0);
  const { data: songs, error } = useAsync(
    () => (open ? collection(card.uri) : Promise.resolve(null)),
    `${card.uri}:${open}:${attempt}`,
  );
  return (
    <div className={`release ${open ? "open" : ""}`}>
      <div className="release-head" onClick={() => setOpen(!open)} title={card.title}>
        <span className="release-chevron">{open ? <ChevronDownIcon size={16} /> : <ChevronRightIcon size={16} />}</span>
        <Cover src={card.image} kind={card.kind} className="release-cover" />
        <div className="release-text">
          <div className="release-title">{card.title}</div>
          <div className="release-sub">{card.subtitle || artistName}</div>
        </div>
        <PlayButton
          size={36}
          className="release-play"
          playing={playingContext === card.uri && playing}
          onClick={() => (playingContext === card.uri ? getPlayer().toggle() : play.context(card.uri).catch(toast))}
        />
      </div>
      {open &&
        (songs ? (
          <TrackList
            tracks={songs.tracks}
            showAlbum={false}
            showCover={false}
            showHeader={false}
            contextUri={card.uri}
            onPlay={(i) => play.context(card.uri, songs.tracks[i].uri).catch(toast)}
          />
        ) : error ? (
          <p className="muted small release-error">
            {t("Could not load the songs.")}{" "}
            <button className="link" onClick={() => setAttempt((n) => n + 1)}>
              {t("Try again")}
            </button>
          </p>
        ) : (
          <div className="spinner small" />
        ))}
    </div>
  );
}

/** About: the artist's photo, the numbers, the biography and where people listen. */
function About({ data }: { data: Data }) {
  return (
    <section className={`artist-about ${data.photo ? "with-photo" : ""}`}>
      {data.photo && <img className="about-photo" src={data.photo} alt="" draggable={false} />}
      <div className="about-text">
        <div className="about-stats">
          {data.worldRank && (
            <div className="about-stat">
              <b>#{data.worldRank}</b>
              <span>{t("in the world")}</span>
            </div>
          )}
          {data.monthlyListeners !== null && (
            <div className="about-stat">
              <b>{formatCount(data.monthlyListeners)}</b>
              <span>{t("monthly listeners")}</span>
            </div>
          )}
          {data.followers !== null && (
            <div className="about-stat">
              <b>{formatCount(data.followers)}</b>
              <span>{t("followers")}</span>
            </div>
          )}
        </div>
        {data.bio && <p className="about-bio">{data.bio}</p>}
        {data.topCities.length > 0 && (
          <div className="about-cities">
            <h3>{t("Where people listen")}</h3>
            {data.topCities.map((c) => (
              <div key={`${c.city}:${c.country}`} className="about-city">
                <span>
                  {c.city}, {c.country}
                </span>
                <span className="muted">{t("{n} listeners", { n: formatCount(c.listeners) })}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
