// Podcasts: a show's page (header, follow, every episode as you scroll) and an episode's page.
import { useEffect, useRef, useState } from "react";
import { episode as loadEpisode, play, show as loadShow, showEpisodes } from "../api/spotify";
import { formatDay } from "../api/normalize";
import type { Episode, EpisodePage } from "../api/types";
import { useContextMenu, type MenuItem } from "../components/ContextMenu";
import { CheckIcon, MoreIcon, PauseIcon, PlayIcon, QueueIcon, SearchIcon } from "../components/icons";
import { Segmented } from "../components/Segmented";
import { Cover } from "../components/Cover";
import { SaveButton } from "../components/LikeButton";
import { copy, followMenu, webLink } from "../components/menus";
import { PlayButton } from "../components/PlayButton";
import { useNav } from "../state/nav";
import { useSaved } from "../state/saved";
import { usePlayer } from "../state/player";
import { notify, toast  } from "../state/toast";
import { formatLength } from "../util/format";
import { useAsync } from "../util/useAsync";
import { Failed, Loading } from "./common";

/** Which episodes the list shows: all, the ones not started, or the ones left halfway. */
type EpisodeFilter = "all" | "unplayed" | "progress";
const FILTERS: { id: EpisodeFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unplayed", label: "Unplayed" },
  { id: "progress", label: "In progress" },
];
/** An episode is new for a week after it comes out, until it is played. */
const NEW_MS = 7 * 86_400_000;

/** `playedMs` is where it stopped when the page loaded; the episode playing passes its live position. */
const matches = (e: Episode, filter: EpisodeFilter, text: string, playedMs = e.playedMs) =>
  (filter === "all" || (filter === "unplayed" ? !e.finished && playedMs === 0 : !e.finished && playedMs > 0)) &&
  (!text || e.name.toLowerCase().includes(text) || e.description.toLowerCase().includes(text));

export function ShowView({ uri }: { uri: string }) {
  const player = usePlayer();
  const openMenu = useContextMenu();
  const [following] = useSaved(uri);
  const [filter, setFilter] = useState<EpisodeFilter>("all");
  const [text, setText] = useState("");
  const { data, error, loading, retry } = useAsync(() => Promise.all([loadShow(uri), showEpisodes(uri, 0)]), uri);
  if (error) return <Failed error={error} onRetry={retry} />;
  if (loading || !data) return <Loading />;
  const [s, first] = data;
  const isCurrent = player.contextUri === uri;
  // The show's context starts with the newest episode, as Spotify does.
  const playShow = () => (isCurrent ? player.toggle() : play.context(uri).catch(toast));

  return (
    <div className="page collection show" style={{ ["--tint" as string]: s.color ?? "#3a3a3a" }}>
      <header className="hero">
        <Cover src={s.image} kind="show" shaped className="hero-cover" />
        <div className="hero-text">
          <span className="hero-kind">Podcast</span>
          <h1 className={`hero-title ${s.name.length > 28 ? "long" : ""}`}>{s.name}</h1>
          {s.description && <p className="hero-desc">{s.description}</p>}
          <p className="hero-meta">
            <b className="hero-owner">{s.publisher}</b>
            {s.rating !== null && <span> • ★ {s.rating.toFixed(1)}</span>}
          </p>
          {s.topics.length > 0 && (
            <div className="hero-guests">
              {s.topics.map((t) => (
                <span key={t} className="chip">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      </header>
      <div className="actions">
        <PlayButton size={56} playing={isCurrent && player.playing} onClick={playShow} />
        <SaveButton uri={uri} kind="show" />
        <button className="more-btn" aria-label={`More options for ${s.name}`} title="More options" onClick={(e) => openMenu(e, followMenu(uri, following))}>
          •••
        </button>
        <div className="list-tools">
          <Segmented options={FILTERS} value={filter} onChange={setFilter} label="Episodes" />
          <label className="list-search">
            <SearchIcon size={16} />
            <input
              value={text}
              placeholder="Search episodes"
              onChange={(e) => setText(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key !== "Escape") return;
                setText("");
                e.currentTarget.blur();
              }}
            />
          </label>
        </div>
      </div>
      <Episodes showUri={uri} first={first} filter={filter} text={text.trim().toLowerCase()} />
    </div>
  );
}

function Episodes({ showUri, first, filter, text }: { showUri: string; first: EpisodePage; filter: EpisodeFilter; text: string }) {
  const [episodes, setEpisodes] = useState<Episode[]>(first.episodes);
  const [next, setNext] = useState<number | null>(first.next);
  // A page that failed: the list stops there until Try again, the cursor kept.
  const [failed, setFailed] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const loadingMore = useRef(false);
  const player = usePlayer();
  const playingUri = player.track?.uri;
  // The one playing has started, whatever the page loaded with.
  const shown = episodes.filter((e) => matches(e, filter, text, e.uri === playingUri ? Math.max(e.playedMs, 1) : e.playedMs));

  // Next page when the end of the list comes into view, also while filtering, so a filter
  // that hides most of a page still reaches the older episodes.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || next === null || failed) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting || loadingMore.current) return;
        loadingMore.current = true;
        showEpisodes(showUri, next)
          .then((page) => {
            setEpisodes((prev) => [...prev, ...page.episodes]);
            setNext(page.episodes.length ? page.next : null);
          })
          .catch((e) => {
            toast(e);
            setFailed(true);
          })
          .finally(() => (loadingMore.current = false));
      },
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [next, showUri, failed]);

  if (episodes.length === 0) return <p className="muted">No episodes yet.</p>;
  return (
    <div className="episode-list">
      {shown.map((e) => (
        <EpisodeRow key={e.uri} episode={e} contextUri={showUri} />
      ))}
      {shown.length === 0 && next === null && <p className="muted pad">No episodes here.</p>}
      {next !== null &&
        (failed ? (
          <p className="muted pad">
            Could not load more episodes.{" "}
            <button className="link" onClick={() => setFailed(false)}>
              Try again
            </button>
          </p>
        ) : (
          <div ref={sentinel} className="more">
            <div className="spinner small" />
          </div>
        ))}
    </div>
  );
}

/** Minutes left, from where it stopped or where it plays now. */
function minutesLeft(e: Episode, at: number) {
  return Math.max(1, Math.round((e.durationMs - at) / 60000));
}

/** "Oct 20, 2026 • 52 min" */
function episodeWhen(e: Episode) {
  return [formatDay(e.released), formatLength(e.durationMs)].filter(Boolean).join(" • ");
}

function episodeMenu(e: Episode, playThis: () => void, nav: ReturnType<typeof useNav>, playing = false): MenuItem[] {
  return [
    { label: playing ? "Pause" : "Play", onClick: playThis },
    { label: "Add to queue", onClick: () => play.addToQueue(e.uri).then(() => notify("Added to queue"), toast) },
    "separator",
    { label: "Go to podcast", onClick: () => e.show.uri && nav.open(e.show.uri), disabled: !e.show.uri },
    { label: "Copy episode link", onClick: () => copy(webLink(e.uri)) },
  ];
}

function EpisodeRow({ episode: e, contextUri }: { episode: Episode; contextUri: string }) {
  const nav = useNav();
  const player = usePlayer();
  const openMenu = useContextMenu();
  const isCurrent = player.track?.uri === e.uri;
  const at = isCurrent ? player.position() : e.playedMs;
  const halfway = !e.finished && at > 0 && e.durationMs > at;
  const age = e.released ? Date.now() - new Date(e.released).getTime() : -1;
  const isNew = !e.finished && e.playedMs === 0 && age >= 0 && age < NEW_MS;
  const playThis = () => (isCurrent ? player.toggle() : play.context(contextUri, e.uri).catch(toast));
  const menu = episodeMenu(e, playThis, nav, isCurrent && player.playing);

  return (
    <div
      className={`episode-row ${isCurrent ? "current" : ""} ${e.finished ? "played" : ""}`}
      role="link"
      tabIndex={0}
      aria-label={e.name}
      onClick={() => nav.open(e.uri)}
      onKeyDown={(ev) => ev.key === "Enter" && ev.target === ev.currentTarget && nav.open(e.uri)}
      onContextMenu={(ev) => openMenu(ev, menu)}
    >
      <Cover src={e.image} kind="show" className="episode-cover" />
      <div className="episode-text">
        <div className="episode-name">{e.name}</div>
        <p className="episode-desc">{e.description}</p>
        <div className="episode-foot">
          {isNew && <span className="episode-new">NEW</span>}
          <span>{episodeWhen(e)}</span>
          {halfway && (
            <>
              <span className="episode-progress">
                <span style={{ width: `${Math.min(100, (at / e.durationMs) * 100)}%` }} />
              </span>
              <b className="episode-left">{minutesLeft(e, at)} min left</b>
            </>
          )}
          {e.finished && (
            <span className="episode-played">
              <CheckIcon size={12} /> Played
            </span>
          )}
        </div>
      </div>
      <div className="episode-actions" onClick={(ev) => ev.stopPropagation()}>
        <button className="icon-btn" aria-label="Add to queue" title="Add to queue" onClick={() => play.addToQueue(e.uri).then(() => notify("Added to queue"), toast)}>
          <QueueIcon size={18} />
        </button>
        <button className="icon-btn" aria-label={`More options for ${e.name}`} title="More options" onClick={(ev) => openMenu(ev, menu)}>
          <MoreIcon size={18} />
        </button>
        <button className={`episode-play ${isCurrent ? "on" : ""}`} aria-label={isCurrent && player.playing ? "Pause" : "Play"} onClick={playThis}>
          {isCurrent && player.playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
        </button>
      </div>
    </div>
  );
}

export function EpisodeView({ uri }: { uri: string }) {
  const nav = useNav();
  const player = usePlayer();
  const openMenu = useContextMenu();
  const { data: e, error, loading, retry } = useAsync(() => loadEpisode(uri), uri);
  if (error) return <Failed error={error} onRetry={retry} />;
  if (loading || !e) return <Loading />;
  const isCurrent = player.track?.uri === uri;
  const playThis = () =>
    isCurrent ? player.toggle() : (e.show.uri ? play.context(e.show.uri, uri) : play.tracks([uri], 0)).catch(toast);
  const at = isCurrent ? player.position() : e.finished ? e.durationMs : e.playedMs;
  const share = e.durationMs > 0 ? Math.min(100, Math.round((at / e.durationMs) * 100)) : 0;
  const halfway = !e.finished && at > 0 && e.durationMs > at;

  return (
    <div className="page collection episode-page" style={{ ["--tint" as string]: "#5a3a2a" }}>
      <header className="hero">
        <Cover src={e.image} kind="show" shaped className="hero-cover" />
        <div className="hero-text">
          <span className="hero-kind">Episode</span>
          <h1 className={`hero-title ${e.name.length > 40 ? "long" : ""}`}>{e.name}</h1>
          {e.show.name && (
            <p className="hero-desc">
              <button className="hero-owner" disabled={!e.show.uri} onClick={() => nav.open(e.show.uri)}>
                {e.show.name}
              </button>
            </p>
          )}
          <p className="hero-meta">
            {[formatDay(e.released), formatLength(e.durationMs), halfway ? `${minutesLeft(e, at)} min left` : e.finished ? "Played" : ""]
              .filter(Boolean)
              .join(" • ")}
          </p>
          {at > 0 && (
            <div className="episode-hero-progress">
              <span className="episode-progress wide">
                <span style={{ width: `${share}%` }} />
              </span>
              <span className="muted small">{share}%</span>
            </div>
          )}
        </div>
      </header>
      <div className="actions">
        <PlayButton size={56} playing={isCurrent && player.playing} onClick={playThis} />
        {halfway && !isCurrent && <span className="muted">Continue where you stopped</span>}
        <button className="more-btn" aria-label={`More options for ${e.name}`} title="More options" onClick={(ev) => openMenu(ev, episodeMenu(e, playThis, nav, isCurrent && player.playing))}>
          •••
        </button>
      </div>
      <div className="episode-body">
        <section className="episode-about">
          <h2>About this episode</h2>
          <p className="muted">{e.description || "No description."}</p>
        </section>
        {e.show.uri && (
          <button className="side-card episode-show" onClick={() => nav.open(e.show.uri)}>
            <h3>Podcast</h3>
            <div className="pick">
              <Cover src={e.image} kind="show" className="pick-cover" />
              <div className="pick-text">
                <div className="pick-title">{e.show.name}</div>
                <div className="pick-sub">See all episodes</div>
              </div>
            </div>
          </button>
        )}
      </div>
    </div>
  );
}
