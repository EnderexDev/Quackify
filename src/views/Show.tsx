// Podcasts: a show's page (header, follow, every episode as you scroll) and an episode's page.
import { useEffect, useRef, useState } from "react";
import { episode as loadEpisode, play, show as loadShow, showEpisodes } from "../api/spotify";
import { formatDay } from "../api/normalize";
import type { Episode, EpisodePage } from "../api/types";
import { useContextMenu } from "../components/ContextMenu";
import { Cover } from "../components/Cover";
import { SaveButton } from "../components/LikeButton";
import { copy, followMenu, webLink } from "../components/menus";
import { PlayButton } from "../components/PlayButton";
import { useNav } from "../state/nav";
import { useSaved } from "../state/saved";
import { usePlayer } from "../state/player";
import { toast } from "../state/toast";
import { formatDuration } from "../util/format";
import { useAsync } from "../util/useAsync";
import { Failed, Loading } from "./common";

export function ShowView({ uri }: { uri: string }) {
  const player = usePlayer();
  const openMenu = useContextMenu();
  const [following] = useSaved(uri);
  const { data, error, loading } = useAsync(() => Promise.all([loadShow(uri), showEpisodes(uri, 0)]), uri);
  if (error) return <Failed error={error} />;
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
          <p className="hero-meta">
            <b>{s.publisher}</b>
            {s.rating !== null && <span> • ★ {s.rating.toFixed(1)}</span>}
          </p>
        </div>
      </header>
      <div className="actions">
        <PlayButton size={56} playing={isCurrent && player.playing} onClick={playShow} />
        <SaveButton uri={uri} kind="show" />
        <button className="more-btn" aria-label={`More options for ${s.name}`} title="More options" onClick={(e) => openMenu(e, followMenu(uri, following))}>
          •••
        </button>
      </div>
      <div className="show-body">
        <section className="show-episodes">
          <h2>All episodes</h2>
          <Episodes showUri={uri} first={first} />
        </section>
        {s.description && (
          <aside className="show-about">
            <h2>About</h2>
            <p className="muted">{s.description}</p>
            {s.topics.length > 0 && (
              <div className="show-topics">
                {s.topics.map((t) => (
                  <span key={t} className="pill">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

function Episodes({ showUri, first }: { showUri: string; first: EpisodePage }) {
  const [episodes, setEpisodes] = useState<Episode[]>(first.episodes);
  const [next, setNext] = useState<number | null>(first.next);
  const sentinel = useRef<HTMLDivElement>(null);
  const loadingMore = useRef(false);

  // Next page when the end of the list comes into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || next === null) return;
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
            setNext(null);
          })
          .finally(() => (loadingMore.current = false));
      },
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [next, showUri]);

  if (episodes.length === 0) return <p className="muted">No episodes yet.</p>;
  return (
    <div className="episode-list">
      {episodes.map((e) => (
        <EpisodeRow key={e.uri} episode={e} contextUri={showUri} />
      ))}
      {next !== null && (
        <div ref={sentinel} className="more">
          <div className="spinner small" />
        </div>
      )}
    </div>
  );
}

/** The date and how long is left, like "Oct 20, 2026 • 22 min left". */
function episodeMeta(e: Episode, playingMs: number | null) {
  const date = formatDay(e.released);
  const at = playingMs ?? e.playedMs;
  const time = e.finished
    ? "Played"
    : at > 0 && e.durationMs > at
      ? `${Math.max(1, Math.round((e.durationMs - at) / 60000))} min left`
      : formatDuration(e.durationMs);
  return [date, time].filter(Boolean).join(" • ");
}

function EpisodeRow({ episode: e, contextUri }: { episode: Episode; contextUri: string }) {
  const nav = useNav();
  const player = usePlayer();
  const openMenu = useContextMenu();
  const isCurrent = player.track?.uri === e.uri;
  const progress = isCurrent ? player.position() : e.finished ? e.durationMs : e.playedMs;
  const playThis = () => (isCurrent ? player.toggle() : play.context(contextUri, e.uri).catch(toast));

  return (
    <div
      className={`episode-row ${isCurrent ? "current" : ""}`}
      onClick={() => nav.open(e.uri)}
      onContextMenu={(ev) =>
        openMenu(ev, [
          { label: "Play", onClick: playThis },
          { label: "Add to queue", onClick: () => play.addToQueue(e.uri).catch(toast) },
          "separator",
          { label: "Go to podcast", onClick: () => e.show.uri && nav.open(e.show.uri), disabled: !e.show.uri },
          { label: "Copy episode link", onClick: () => copy(webLink(e.uri)) },
        ])
      }
    >
      <Cover src={e.image} className="episode-cover" />
      <div className="episode-text">
        <div className="episode-name">{e.name}</div>
        <p className="episode-desc muted">{e.description}</p>
        <div className="episode-foot">
          <PlayButton size={32} playing={isCurrent && player.playing} onClick={playThis} />
          <span className="muted small">{episodeMeta(e, isCurrent ? player.position() : null)}</span>
          {progress > 0 && e.durationMs > 0 && (
            <span className="episode-progress">
              <span style={{ width: `${Math.min(100, (progress / e.durationMs) * 100)}%` }} />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function EpisodeView({ uri }: { uri: string }) {
  const nav = useNav();
  const player = usePlayer();
  const { data: e, error, loading } = useAsync(() => loadEpisode(uri), uri);
  if (error) return <Failed error={error} />;
  if (loading || !e) return <Loading />;
  const isCurrent = player.track?.uri === uri;
  const playThis = () =>
    isCurrent ? player.toggle() : (e.show.uri ? play.context(e.show.uri, uri) : play.tracks([uri], 0)).catch(toast);

  return (
    <div className="page collection episode-page">
      <header className="hero">
        <Cover src={e.image} className="hero-cover" />
        <div className="hero-text">
          <span className="hero-kind">Podcast episode</span>
          <h1 className={`hero-title ${e.name.length > 28 ? "long" : ""}`}>{e.name}</h1>
          <p className="hero-meta">
            <a className="link-strong" onClick={() => e.show.uri && nav.open(e.show.uri)}>
              {e.show.name}
            </a>
          </p>
        </div>
      </header>
      <div className="actions">
        <PlayButton size={56} playing={isCurrent && player.playing} onClick={playThis} />
        <span className="muted">{episodeMeta(e, isCurrent ? player.position() : null)}</span>
      </div>
      <section className="episode-about">
        <h2>Episode Description</h2>
        <p className="muted">{e.description}</p>
        {e.show.uri && (
          <button className="secondary" onClick={() => nav.open(e.show.uri)}>
            See all episodes
          </button>
        )}
      </section>
    </div>
  );
}
