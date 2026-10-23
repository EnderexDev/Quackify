// The measured journeys. In the page: `await __run()` returns, per action, the React render time
// (Profiler, ms), how many components rendered, and the top ones.
type W = Window & {
  __emit: (e: string, p: unknown) => void;
  __bench: { view: Record<string, unknown> & { playback: Record<string, unknown> }; nowPlaying: (i: number) => unknown };
  __renders: { reset: () => void; read: () => { commits: number; byComponent: Record<string, number> } };
  __timing: { reset: () => void; read: () => number };
};
const w = window as unknown as W;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as T | null;
const rows = () => document.querySelectorAll<HTMLElement>(".tracklist .track-row:not(.track-head)");

async function until(test: () => boolean, ms = 10000) {
  const end = performance.now() + ms;
  while (!test()) {
    if (performance.now() > end) throw new Error("timed out");
    await sleep(20);
  }
}

async function measure(name: string, act: (k: number) => void | Promise<void>, times = 5) {
  const ms: number[] = [];
  const wall: number[] = [];
  let last = { commits: 0, byComponent: {} as Record<string, number> };
  for (let k = 0; k < times; k++) {
    await sleep(60);
    w.__renders.reset();
    w.__timing.reset();
    const t0 = performance.now();
    await act(k);
    void document.body.offsetHeight;
    wall.push(performance.now() - t0);
    await sleep(60);
    ms.push(w.__timing.read());
    last = w.__renders.read();
  }
  ms.sort((a, b) => a - b);
  const total = Object.values(last.byComponent).reduce((s, n) => s + n, 0);
  const top = Object.entries(last.byComponent)
    .slice(0, 5)
    .map(([k, v]) => `${k}:${v}`)
    .join(" ");
  wall.sort((a, b) => a - b);
  // wallMs: the action itself plus layout; it holds the render only for events React handles
  // at once (clicks), not for Rust events, which render a moment later.
  return { name, reactMs: ms[Math.floor(ms.length / 2)], wallMs: Math.round(wall[Math.floor(wall.length / 2)]), commits: last.commits, components: total, top };
}

export async function run() {
  const out: unknown[] = [];
  // Open the playlist and load all of it (sorting needs every page; back to custom keeps them).
  await until(() => !!document.querySelector(".library-title"));
  w.__renders.reset();
  w.__timing.reset();
  const t0 = performance.now();
  const item = [...document.querySelectorAll<HTMLElement>("*")].find(
    (e) => e.classList.contains("library-title") && e.textContent === "Bench 2000",
  )!;
  item.click();
  await until(() => rows().length >= 100);
  out.push({ name: "open playlist (100 rows)", wallMs: Math.round(performance.now() - t0), reactMs: w.__timing.read(), components: Object.values(w.__renders.read().byComponent).reduce((s, n) => s + n, 0) });
  const sort = $<HTMLSelectElement>(".main .list-sort")!;
  const setSort = (v: string) => {
    const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    set.call(sort, v);
    sort.dispatchEvent(new Event("change", { bubbles: true }));
  };
  w.__renders.reset();
  w.__timing.reset();
  const t1 = performance.now();
  setSort("title");
  await until(() => rows().length >= 2000);
  setSort("custom");
  await sleep(100);
  out.push({ name: "load all + sort + unsort (2000 rows)", wallMs: Math.round(performance.now() - t1), reactMs: w.__timing.read() });

  const { view, nowPlaying } = w.__bench;
  out.push(await measure("cluster update (connect event)", () => w.__emit("connect", { ...view })));
  out.push(
    await measure("seek (player-event)", (k) => w.__emit("player-event", { kind: "seeked", uri: "spotify:track:t500", position_ms: 5000 + k })),
  );
  out.push(await measure("next song (now-playing)", (k) => w.__emit("now-playing", nowPlaying(500 + (k % 2)))));
  out.push(await measure("select a row (click)", (k) => (rows()[700 + k].querySelector(".track-main") as HTMLElement).click()));
  out.push(await measure("like a song (heart)", () => (rows()[703].querySelector(".row-like") as HTMLElement).click()));
  out.push(
    await measure("drag over rows", async (k) => {
      const dt = new DataTransfer();
      const from = rows()[10];
      from.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
      for (let i = 0; i < 5; i++) {
        const r = rows()[20 + k * 5 + i].getBoundingClientRect();
        rows()[20 + k * 5 + i].dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt, clientY: r.top + 1 }));
        await sleep(16);
      }
      from.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
    }, 3),
  );
  out.push(await measure("1s of playback (progress ticks)", () => sleep(1000), 3));
  // Last: in the dev build, wheel events faster than the renders could leave React stuck.
  const vol = $(".slider.volume")!;
  out.push(
    await measure("volume wheel x10", async () => {
      for (let i = 0; i < 10; i++) {
        vol.dispatchEvent(new WheelEvent("wheel", { deltaY: i % 2 ? 100 : -100, bubbles: true }));
        await sleep(16);
      }
    }, 3),
  );
  return out;
}

Object.assign(window, { __run: run });

// `?show`: opens the 2000-song playlist and scrolls to its middle, for a screenshot.
if (location.search.includes("show")) {
  (async () => {
    await until(() => !!document.querySelector(".library-title"));
    [...document.querySelectorAll<HTMLElement>(".library-title")].find((e) => e.textContent === "Bench 2000")!.click();
    await until(() => rows().length >= 100);
    const sort = $<HTMLSelectElement>(".main .list-sort")!;
    const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    set.call(sort, "title");
    sort.dispatchEvent(new Event("change", { bubbles: true }));
    await until(() => rows().length >= 2000);
    set.call(sort, "custom");
    sort.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(200);
    $(".main")!.scrollTop = 56 * 1200;
  })();
}
