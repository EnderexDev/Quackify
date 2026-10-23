// The Spotify Jam this account is in (jam.rs), read again every few seconds: a friend joining
// from their phone, or a Jam started on the phone, shows up here by itself. One copy for the
// whole page; it reads only while something on the page uses it.
import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";

export type JamMember = {
  id: string;
  username: string;
  name: string;
  image: string | null;
  is_me: boolean;
  is_host: boolean;
};

export type Jam = {
  id: string;
  is_host: boolean;
  share_url: string;
  members: JamMember[];
  max_members: number;
};

/** How often it is read again: often during a Jam (people come and go), rarely outside one. */
const IN_JAM_MS = 5000;
const NO_JAM_MS = 30000;

let jam: Jam | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
// Each read has a number: an older answer arriving late never overwrites a newer one.
let generation = 0;
// Starts and stops in flight: no read runs meanwhile, it could answer from before them.
let changing = 0;
const listeners = new Set<() => void>();

const same = (a: Jam | null, b: Jam | null) => JSON.stringify(a) === JSON.stringify(b);

function set(next: Jam | null) {
  if (same(jam, next)) return;
  jam = next;
  listeners.forEach((f) => f());
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = listeners.size ? setTimeout(read, jam ? IN_JAM_MS : NO_JAM_MS) : null;
}

async function read() {
  if (changing) return;
  const mine = ++generation;
  try {
    const next = await invoke<Jam | null>("jam_current");
    if (mine === generation) set(next);
  } catch {
    // Logged out or offline: keep what was shown and try again later.
  }
  if (mine === generation) schedule();
}

// Back to the window: read at once instead of waiting for the next round.
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && listeners.size && read());

function subscribe(f: () => void) {
  listeners.add(f);
  if (listeners.size === 1) read();
  return () => {
    listeners.delete(f);
    if (!listeners.size) schedule();
  };
}

/** The Jam now, or null. */
export const useJam = () => useSyncExternalStore(subscribe, () => jam);

/** Runs a start or a stop; reads resume after it, whether it worked or not. */
async function change<T>(work: () => Promise<T>, after: (result: T) => Jam | null): Promise<T> {
  changing++;
  generation++;
  try {
    const result = await work();
    generation++;
    set(after(result));
    return result;
  } finally {
    changing--;
    schedule();
  }
}

/** Starts a Jam hosted here; the page shows it at once. */
export const startJam = () => change(() => invoke<Jam>("jam_start"), (started) => started);

/** Ends the Jam (host) or leaves it (guest). */
export const stopJam = (j: Jam) => change(() => invoke("jam_stop", { id: j.id, host: j.is_host }), () => null);

/** Everyone in the Jam but this account. */
export const others = (j: Jam | null) => (j ? j.members.filter((m) => !m.is_me) : []);
