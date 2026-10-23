// The two dominant colours of a cover, read from a 32x32 copy of it: the darker one is the base,
// the more vivid one the glow. Used by the aura behind the panels (and the player bar later).

export type CoverColors = { base: string; glow: string };

const SIZE = 32;
/** A cover with no usable colour (grey, or unreadable): graphite. */
export const GRAPHITE: CoverColors = { base: "hsl(240 6% 18%)", glow: "hsl(240 5% 30%)" };

/** The last covers read; the oldest goes first past this many. */
const CACHE_MAX = 200;
const cache = new Map<string, Promise<CoverColors>>();

/** Cached by image URL; never rejects (an unreadable image gives graphite). */
export function coverColors(url: string): Promise<CoverColors> {
  let hit = cache.get(url);
  if (!hit) {
    hit = read(url).catch((e) => {
      console.warn("cover colours not read", url, e);
      return GRAPHITE;
    });
    cache.set(url, hit);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  }
  return hit;
}

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Before src: without it the canvas is tainted and cannot be read.
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image did not load"));
    img.src = url;
  });
}

type Hsl = { h: number; s: number; l: number };

function toHsl(r: number, g: number, b: number): Hsl {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

const css = (c: Hsl) => `hsl(${Math.round(c.h)} ${Math.round(c.s * 100)}% ${Math.round(c.l * 100)}%)`;

/** WCAG relative luminance of an HSL colour. */
function luminance({ h, s, l }: Hsl): number {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const c = l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(8) + 0.0722 * channel(4);
}

/**
 * The brightest the music's colours get. Lightness alone treats yellow like blue, but a yellow
 * at the same lightness is far brighter to the eye; capping the luminance darkens only the light
 * hues (yellows, greens, cyans), so white text keeps a contrast of 4.5 or more on the aura, the
 * player bar and the cinema in the worst case (measured over every hue, 23/10/26).
 */
const MAX_LUMINANCE = 0.12;
const capped = (c: Hsl): Hsl => {
  let l = c.l;
  while (l > 0 && luminance({ ...c, l }) > MAX_LUMINANCE) l -= 0.005;
  return { ...c, l };
};

const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

async function read(url: string): Promise<CoverColors> {
  const img = await load(url);
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return GRAPHITE;
  ctx.drawImage(img, 0, 0, SIZE, SIZE);
  const px = ctx.getImageData(0, 0, SIZE, SIZE).data;

  // Pixels grouped in 12 hue buckets; greys (low saturation) only count as grey.
  const buckets = Array.from({ length: 12 }, () => ({ n: 0, h: 0, s: 0, l: 0 }));
  let grey = 0;
  for (let i = 0; i < px.length; i += 4) {
    const c = toHsl(px[i], px[i + 1], px[i + 2]);
    if (c.s < 0.15 || c.l < 0.08 || c.l > 0.94) {
      grey++;
      continue;
    }
    const b = buckets[Math.floor(c.h / 30) % 12];
    b.n++;
    b.h += c.h;
    b.s += c.s;
    b.l += c.l;
  }
  const total = SIZE * SIZE;
  const ranked = buckets
    .filter((b) => b.n > 0)
    .map((b) => ({ n: b.n, c: { h: b.h / b.n, s: b.s / b.n, l: b.l / b.n } }))
    // Many pixels first, a little help for vivid ones.
    .sort((a, b) => b.n * (0.5 + b.c.s) - a.n * (0.5 + a.c.s));
  if (!ranked.length || ranked[0].n < total * 0.04 || grey > total * 0.9) return GRAPHITE;

  const first = ranked[0].c;
  const second = ranked.find((r) => r.n >= total * 0.03 && hueGap(r.c.h, first.h) >= 40)?.c ?? { ...first, h: (first.h + 25) % 360 };
  // The darker of the two is the base; colours too light get darker, so white text stays readable.
  const [dark, vivid] = first.l <= second.l ? [first, second] : [second, first];
  return {
    base: css(capped({ h: dark.h, s: Math.min(dark.s, 0.75), l: Math.min(Math.max(dark.l, 0.2), 0.36) })),
    glow: css(capped({ h: vivid.h, s: Math.min(Math.max(vivid.s, 0.45), 0.9), l: Math.min(Math.max(vivid.l, 0.38), 0.55) })),
  };
}
