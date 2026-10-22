import { useEffect, useRef, useState } from "react";
import { onMeter } from "../state/meter";
import { useReducedMotion } from "../state/motion";
import { usePlayer } from "../state/player";
import { coverColors, type CoverColors } from "../util/coverColors";

/** Before anything plays: a quiet violet and amber. */
const IDLE: CoverColors = { base: "hsl(258 45% 26%)", glow: "hsl(24 55% 40%)" };

/**
 * The colour of the music behind the panels: three blurred blobs in the two colours of the cover
 * playing, drifting slowly, with a 600ms crossfade when the song changes, and pulsing with the low
 * notes while the meter runs (Wave and Live progress bars). One layer; it stops moving while the
 * window is hidden or out of focus, and with reduced motion.
 */
export function Aura() {
  const player = usePlayer();
  const image = player.track?.image ?? null;
  const [colors, setColors] = useState<CoverColors>(IDLE);
  const [unfocused, setStill] = useState(() => document.hidden || !document.hasFocus());
  // Another device playing: this app does not hear that music, so the aura rests.
  const still = unfocused || !!player.remoteDevice;
  const blobs = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

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

  // The pulse: the lows of the sound playing grow the blobs a little.
  useEffect(() => {
    const el = blobs.current;
    if (!el || still || reduced) return;
    const off = onMeter((f) => {
      // The first sixth of the bands: about 50 to 140 Hz.
      const n = Math.max(1, Math.round(f.bands.length / 6));
      const low = f.bands.slice(0, n).reduce((a, b) => a + b, 0) / n;
      const push = Math.max(0, (low - 0.45) / 0.55);
      el.style.transform = `scale(${(1 + push * 0.07).toFixed(3)})`;
    });
    return () => {
      off();
      el.style.transform = "";
    };
  }, [still, reduced]);

  return (
    <div className={`aura ${still ? "still" : ""}`} aria-hidden>
      <div className="aura-blobs" ref={blobs}>
        <span className="aura-blob a" style={{ backgroundColor: colors.glow }} />
        <span className="aura-blob b" style={{ backgroundColor: colors.base }} />
        <span className="aura-blob c" style={{ backgroundColor: colors.glow }} />
      </div>
      <div className="aura-grain" />
    </div>
  );
}
