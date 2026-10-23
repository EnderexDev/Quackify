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

  useBakedBlur(blobs);

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

/** The blur of each blob, as the CSS filter had it. */
const BLUR_PX = 90;
/** How far the blur reaches past a blob's edge (three times its spread). */
const BLUR_REACH = 3 * BLUR_PX;
/** The masks are drawn this many times smaller: a blur has no fine detail to lose. */
const MASK_SCALE = 4;

/**
 * Each blob's blur made once, as a mask of a blurred ellipse the size of the blob, instead of
 * a CSS blur the GPU ran again on every frame that anything on the window moved (about a
 * quarter of a core at 165 Hz, 23/10/26). Drawn again when the blobs change size; the colour
 * still crossfades and the blobs still drift and pulse.
 */
function useBakedBlur(blobs: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const box = blobs.current;
    if (!box) return;
    box.classList.add("baked");
    const bake = () => {
      for (const el of box.querySelectorAll<HTMLElement>(".aura-blob")) {
        // The box takes the blur's reach on every side (shell.css); the blob is what is inside.
        const w = el.clientWidth - 2 * BLUR_REACH;
        const h = el.clientHeight - 2 * BLUR_REACH;
        if (w <= 0 || h <= 0) continue;
        const c = document.createElement("canvas");
        c.width = Math.ceil(el.clientWidth / MASK_SCALE);
        c.height = Math.ceil(el.clientHeight / MASK_SCALE);
        const ctx = c.getContext("2d");
        if (!ctx) continue;
        ctx.filter = `blur(${BLUR_PX / MASK_SCALE}px)`;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.ellipse(c.width / 2, c.height / 2, w / 2 / MASK_SCALE, h / 2 / MASK_SCALE, 0, 0, Math.PI * 2);
        ctx.fill();
        const url = `url(${c.toDataURL()})`;
        el.style.maskImage = url;
        el.style.webkitMaskImage = url;
      }
    };
    let timer = 0;
    const resized = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = window.setTimeout(bake, 150);
    });
    resized.observe(box);
    bake();
    return () => {
      resized.disconnect();
      clearTimeout(timer);
      box.classList.remove("baked");
      for (const el of box.querySelectorAll<HTMLElement>(".aura-blob")) {
        el.style.maskImage = "";
        el.style.webkitMaskImage = "";
      }
    };
  }, [blobs]);
}
