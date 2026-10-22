// The song page: what is playing, big, over a strong aura. On the left the cover, the song, its
// buttons and its main artist; on the right the lyrics, following the song: the line being sung
// grows and lights up and stays in view, and clicking a line seeks to it.
import { useEffect, useRef, useState } from "react";
import { trackDetails } from "../api/spotify";
import type { TrackDetails } from "../api/types";
import { Cover } from "../components/Cover";
import { useContextMenu } from "../components/ContextMenu";
import { openCredits } from "../components/Credits";
import { HeartIcon, HeartOutlineIcon, PlaylistAddIcon } from "../components/icons";
import { SaveButton } from "../components/LikeButton";
import { openPlaylistPicker, trackMenu } from "../components/menus";
import { Segmented } from "../components/Segmented";
import { activeLine, useLyrics } from "../state/lyrics";
import { useNav } from "../state/nav";
import { usePlayer, type NowPlaying } from "../state/player";
import { useSaved } from "../state/saved";
import { formatCount, formatDuration } from "../util/format";

/** After the user scrolls by hand, the view leaves the scroll alone for this long. */
const MANUAL_SCROLL_MS = 3000;

type LyricsSize = "s" | "m" | "l";
const SIZE_KEY = "lyricsSize";
const SIZES: { id: LyricsSize; label: string }[] = [
  { id: "s", label: "S" },
  { id: "m", label: "M" },
  { id: "l", label: "L" },
];

export function SongView() {
  const p = usePlayer();
  const t = p.track;
  if (!t)
    return (
      <div className="song-page empty">
        <p>Play a song to see it here.</p>
      </div>
    );
  return (
    <div className="song-page">
      <SongInfo t={t} />
      <SongLyrics uri={t.uri} />
    </div>
  );
}

function SongInfo({ t }: { t: NowPlaying }) {
  const nav = useNav();
  const openMenu = useContextMenu();
  const episode = t.uri.startsWith("spotify:episode:");
  const isTrack = t.uri.startsWith("spotify:track:");
  const [saved, toggleSaved] = useSaved(isTrack ? t.uri : null);
  const artistUri = t.artists[0]?.uri ?? "";
  const [details, setDetails] = useState<{
    uri: string;
    value: TrackDetails;
  } | null>(null);

  useEffect(() => {
    if (!isTrack || !artistUri) return;
    let alive = true;
    trackDetails(t.uri, artistUri).then(
      (value) => alive && setDetails({ uri: t.uri, value }),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [t.uri, artistUri]);
  const artist = details?.uri === t.uri ? details.value.artist : null;

  return (
    <section className="song-info">
      <Cover src={t.image} className="song-cover" />
      <div className="song-kind">{episode ? "Episode" : "Song"}</div>
      <h1 className="song-title" title={t.name}>
        {t.name}
      </h1>
      <div className="song-meta">
        {t.artists.map((a, i) => (
          <span key={a.uri || i}>
            {i > 0 && ", "}
            <a onClick={() => (a.uri ? nav.open(a.uri) : episode && nav.open(t.uri))}>{a.name}</a>
          </span>
        ))}
        {t.album.name && !episode && (
          <>
            {" · "}
            <a onClick={() => t.album.uri && nav.open(t.album.uri)}>{t.album.name}</a>
          </>
        )}
        {t.duration_ms > 0 && <> · {formatDuration(t.duration_ms)}</>}
      </div>

      <div className="song-actions">
        {isTrack && (
          <button className={`pill-btn ${saved ? "liked" : ""}`} disabled={saved === undefined} onClick={toggleSaved}>
            {saved ? <HeartIcon size={16} /> : <HeartOutlineIcon size={16} />}
            {saved ? "Liked" : "Like"}
          </button>
        )}
        {isTrack && (
          <button className="pill-btn" onClick={(e) => openPlaylistPicker(e.currentTarget, t, nav, openMenu)}>
            <PlaylistAddIcon size={16} />
            Add to playlist
          </button>
        )}
        {episode && (
          <button className="pill-btn" onClick={() => nav.open(t.uri)}>
            Go to episode
          </button>
        )}
        {!episode && (
          <button
            className="more-btn"
            aria-label="More"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              openMenu(
                {
                  clientX: r.left,
                  clientY: r.bottom,
                  preventDefault: () => {},
                },
                trackMenu(t, saved, nav),
              );
            }}
          >
            •••
          </button>
        )}
      </div>

      {artist && (
        <div className="song-artist" onClick={() => artist.uri && nav.open(artist.uri)}>
          <Cover src={artist.image} round className="song-artist-image" />
          <div className="song-artist-text">
            <div className="song-artist-name">
              {artist.name}
              {artist.verified && (
                <span className="song-verified" title="Verified artist">
                  ✓
                </span>
              )}
            </div>
            {artist.monthlyListeners !== null && (
              <div className="muted small">{formatCount(artist.monthlyListeners)} monthly listeners</div>
            )}
          </div>
          <div className="song-artist-buttons" onClick={(e) => e.stopPropagation()}>
            <button className="link" onClick={() => openCredits(t.uri)}>
              Credits
            </button>
            {artist.uri && <SaveButton uri={artist.uri} kind="artist" />}
          </div>
        </div>
      )}
    </section>
  );
}

function SongLyrics({ uri }: { uri: string }) {
  const p = usePlayer();
  const state = useLyrics(uri);
  const [size, setSizeState] = useState<LyricsSize>(() => {
    const saved = localStorage.getItem(SIZE_KEY);
    return saved === "s" || saved === "l" ? saved : "m";
  });
  const setSize = (s: LyricsSize) => {
    setSizeState(s);
    localStorage.setItem(SIZE_KEY, s);
  };
  const [, tick] = useState(0);
  const lines = useRef<(HTMLDivElement | null)[]>([]);
  const scrolledAt = useRef(0);
  const dragging = useRef(false);

  // Re-render a few times a second while playing, so the sung line moves.
  useEffect(() => {
    if (!p.playing) return;
    const id = setInterval(() => tick((n) => n + 1), 200);
    return () => clearInterval(id);
  }, [p.playing]);

  const l = state.status === "ready" ? state.lyrics : null;
  const active = activeLine(l, p.position());

  // Scrolling by hand (wheel, touch, the scrollbar, scroll keys) pauses following the song.
  // Only user input counts: the scroll events of following the song itself would too.
  useEffect(() => {
    const manual = () => (scrolledAt.current = Date.now());
    const inMain = (e: Event) => (e.target as Element | null)?.closest?.(".main");
    // The lyrics scroll in their own column (the page scrolls instead in a narrow window).
    const onWheel = (e: Event) => inMain(e) && manual();
    // A press on the scroll container itself, not on a line inside it, is a press on its
    // scrollbar: the pause lasts the whole drag, counted from when it ends.
    const onDown = (e: Event) => {
      if (!(e.target as Element | null)?.matches?.(".main, .song-lyrics-body")) return;
      dragging.current = true;
      manual();
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      manual();
    };
    const onKey = (e: KeyboardEvent) => ["PageUp", "PageDown", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key) && manual();
    window.addEventListener("wheel", onWheel, { capture: true, passive: true });
    window.addEventListener("touchmove", onWheel, {
      capture: true,
      passive: true,
    });
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("wheel", onWheel, true);
      window.removeEventListener("touchmove", onWheel, true);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);

  // Brings the sung line into view; while the user scrolls by hand, waits and tries again,
  // so following resumes once the pause is over even if the line has not changed.
  useEffect(() => {
    if (active < 0) return;
    let timer = 0;
    const follow = () => {
      const left = MANUAL_SCROLL_MS - (Date.now() - scrolledAt.current);
      if (dragging.current || left > 0) {
        timer = window.setTimeout(follow, dragging.current ? 250 : left);
        return;
      }
      lines.current[active]?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    };
    follow();
    return () => clearTimeout(timer);
  }, [active]);

  return (
    <section className={`song-lyrics size-${size}`}>
      <div className="song-lyrics-head">
        <h2>Lyrics</h2>
        {l?.synced && <span className="muted small">synced</span>}
        <Segmented className="song-lyrics-size" label="Lyrics size" options={SIZES} value={size} onChange={setSize} />
      </div>
      <div className="song-lyrics-body">
        {state.status === "loading" && <div className="spinner" />}
        {state.status === "failed" && (
          <div className="song-lyrics-message">
            <p>Couldn't load the lyrics.</p>
            <button className="pill-btn" onClick={state.retry}>
              Try again
            </button>
          </div>
        )}
        {state.status === "ready" && !l && (
          <div className="song-lyrics-message">
            <p>{uri.startsWith("spotify:track:") ? "This song has no lyrics on Spotify." : "Episodes have no lyrics."}</p>
          </div>
        )}
        {l && (
          <>
            {!l.synced && <p className="song-lyrics-note">These lyrics aren't synced to the song yet.</p>}
            <div className={`lyrics ${l.synced ? "synced" : ""}`}>
              {l.lines.map((line, i) => (
                <div
                  key={i}
                  ref={(el) => {
                    lines.current[i] = el;
                  }}
                  className={`lyrics-line ${i === active ? "active" : i < active ? "past" : ""}`}
                  onClick={() => l.synced && p.seek(line.start_ms)}
                >
                  {line.words || "♪"}
                </div>
              ))}
            </div>
            {l.provider && <p className="song-lyrics-provider">Lyrics provided by {l.provider}</p>}
          </>
        )}
      </div>
    </section>
  );
}
