import { useEffect, useState } from "react";
import { usePlayer } from "../state/player";
import { coverColors, type CoverColors } from "../util/coverColors";

/** Before anything plays: a quiet violet and amber. */
const IDLE: CoverColors = { base: "hsl(258 45% 26%)", glow: "hsl(24 55% 40%)" };

/**
 * The colour of the music behind the panels: three blurred blobs in the two colours of the cover
 * playing, drifting slowly, with a 600ms crossfade when the song changes. One layer; it stops
 * moving while the window is hidden or out of focus, and with reduced motion.
 */
export function Aura() {
  const player = usePlayer();
  const image = player.track?.image ?? null;
  const [colors, setColors] = useState<CoverColors>(IDLE);
  const [still, setStill] = useState(() => document.hidden || !document.hasFocus());

  useEffect(() => {
    if (!image) return setColors(IDLE);
    let alive = true;
    coverColors(image).then((c) => alive && setColors(c));
    return () => {
      alive = false;
    };
  }, [image]);

  // The same pair as tokens, for anything else drawn in the colour of the music.
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--aura", colors.base);
    root.setProperty("--aura-2", colors.glow);
  }, [colors]);

  useEffect(() => {
    const update = () => setStill(document.hidden || !document.hasFocus());
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  return (
    <div className={`aura ${still ? "still" : ""}`} aria-hidden>
      <div className="aura-blobs">
        <span className="aura-blob a" style={{ backgroundColor: colors.glow }} />
        <span className="aura-blob b" style={{ backgroundColor: colors.base }} />
        <span className="aura-blob c" style={{ backgroundColor: colors.glow }} />
      </div>
      <div className="aura-grain" />
    </div>
  );
}
