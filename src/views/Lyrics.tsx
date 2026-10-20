// The lyrics of what is playing, in the song's colors. Synced lyrics follow the song: the line
// being sung lights up and stays in view, and clicking a line seeks to it.
import { useEffect, useRef, useState } from "react";
import { lyrics as loadLyrics } from "../api/spotify";
import type { Lyrics } from "../api/types";
import { usePlayer } from "../state/player";

/** After the user scrolls by hand, the view leaves the scroll alone for this long. */
const MANUAL_SCROLL_MS = 3000;

export function LyricsView() {
  const p = usePlayer();
  const uri = p.track?.uri ?? null;
  const [loaded, setLoaded] = useState<{ uri: string; lyrics: Lyrics | null; failed: boolean } | null>(null);
  const [, tick] = useState(0);
  const lines = useRef<(HTMLDivElement | null)[]>([]);
  const scrolledAt = useRef(0);
  const dragging = useRef(false);

  useEffect(() => {
    if (!uri) return;
    let alive = true;
    // Episodes and local files have no lyrics.
    if (!uri.startsWith("spotify:track:")) {
      setLoaded({ uri, lyrics: null, failed: false });
      return;
    }
    loadLyrics(uri).then(
      (lyrics) => alive && setLoaded({ uri, lyrics, failed: false }),
      () => alive && setLoaded({ uri, lyrics: null, failed: true }),
    );
    return () => {
      alive = false;
    };
  }, [uri]);

  // Re-render a few times a second while playing, so the sung line moves.
  useEffect(() => {
    if (!p.playing) return;
    const id = setInterval(() => tick((n) => n + 1), 200);
    return () => clearInterval(id);
  }, [p.playing]);

  const current = loaded && loaded.uri === uri ? loaded : null;
  const l = current?.lyrics ?? null;
  const position = p.position();
  let active = -1;
  if (l?.synced) {
    for (let i = 0; i < l.lines.length && l.lines[i].start_ms <= position; i++) active = i;
  }

  // Scrolling by hand (wheel, touch, the scrollbar, scroll keys) pauses following the song.
  // Only user input counts: the scroll events of following the song itself would too.
  useEffect(() => {
    const manual = () => (scrolledAt.current = Date.now());
    const inMain = (e: Event) => (e.target as Element | null)?.closest?.(".main");
    const onWheel = (e: Event) => inMain(e) && manual();
    // A press on the scroll container itself, not on a line inside it, is a press on its
    // scrollbar: the pause lasts the whole drag, counted from when it ends.
    const onDown = (e: Event) => {
      if (!(e.target as Element | null)?.matches?.(".main")) return;
      dragging.current = true;
      manual();
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      manual();
    };
    const onKey = (e: KeyboardEvent) =>
      ["PageUp", "PageDown", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key) && manual();
    window.addEventListener("wheel", onWheel, { capture: true, passive: true });
    window.addEventListener("touchmove", onWheel, { capture: true, passive: true });
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
      lines.current[active]?.scrollIntoView({ block: "center", behavior: "smooth" });
    };
    follow();
    return () => clearTimeout(timer);
  }, [active]);

  if (!uri) return <Message text="Play a song to see its lyrics." />;
  if (!current) return <div className="lyrics-page"><div className="spinner" /></div>;
  if (current.failed) return <Message text="Couldn't load the lyrics. Try again in a moment." />;
  if (!l) return <Message text="Looks like we don't have the lyrics for this song." />;

  return (
    <div
      className="lyrics-page"
      style={{
        background: l.background ?? undefined,
        ["--ly-text" as string]: l.text ?? "rgba(255,255,255,0.45)",
        ["--ly-hi" as string]: l.highlight ?? "#fff",
      }}
    >
      {!l.synced && <p className="lyrics-note">These lyrics aren't synced to the song yet.</p>}
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
      {l.provider && <p className="lyrics-provider">Lyrics provided by {l.provider}</p>}
    </div>
  );
}

function Message({ text }: { text: string }) {
  return (
    <div className="lyrics-page empty">
      <p>{text}</p>
    </div>
  );
}
