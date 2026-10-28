// Updates without an installer: the app asks GitHub's latest release (its latest.json, see
// scripts/release.mjs) a moment after it starts and every 6 hours, and Settings > About can ask
// any time. A new version is downloaded, its signature checked against the key in
// tauri.conf.json, and its installer run with no questions; Windows closes Quackify for it and
// the installer opens it again. Quackify Dev never asks: it would install the official app.
import { useSyncExternalStore } from "react";
import { getIdentifier } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { t } from "../i18n";
import { notify, toast } from "./toast";

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "latest"; at: number }
  | { kind: "available"; version: string }
  | { kind: "downloading"; version: string; percent: number | null }
  | { kind: "error"; message: string };

const FIRST_CHECK_MS = 10_000;
const EVERY_MS = 6 * 60 * 60 * 1000;

let state: UpdateState = { kind: "idle" };
let found: Update | null = null;
/** The version a notice was already shown for, so the 6-hour check does not repeat it. */
let told: string | null = null;
const listeners = new Set<() => void>();

const set = (s: UpdateState) => {
  state = s;
  listeners.forEach((f) => f());
};

export function useUpdate(): UpdateState {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => state,
  );
}

let official: Promise<boolean> | null = null;
/** False in Quackify Dev (its identifier ends in .dev, as variant.rs reads it). */
export const updatesOn = () => (official ??= getIdentifier().then((id) => !id.endsWith(".dev"), () => false));

/** Asks for a new version. `quiet`: the timer's check, which says nothing unless one is found. */
export async function checkForUpdate(quiet = false) {
  if (!(await updatesOn())) return;
  if (state.kind === "checking" || state.kind === "downloading") return;
  set({ kind: "checking" });
  try {
    const update = await check();
    // Each check hands back a new Update held on the Rust side: the old one is let go.
    if (found && found !== update) found.close().catch(() => {});
    found = update;
    if (!update) {
      set({ kind: "latest", at: Date.now() });
      if (!quiet) notify(t("Quackify is up to date"), { kind: "info" });
      return;
    }
    set({ kind: "available", version: update.version });
    if (told !== update.version) {
      told = update.version;
      notify(t("Quackify {version} is out", { version: update.version }), {
        kind: "info",
        action: { label: t("Update"), run: installUpdate },
      });
    }
  } catch (e) {
    // A version found before is still there to install: its notice's Update button keeps working.
    set(found ? { kind: "available", version: found.version } : { kind: "error", message: String(e) });
    if (!quiet) toast(t("Could not check for updates: {error}", { error: String(e) }));
  }
}

/** Downloads and installs the version found. On Windows the installer closes Quackify itself. */
export async function installUpdate() {
  const update = found;
  // Only from "available": a check still on its way would close this Update when it lands.
  if (!update || state.kind !== "available") return;
  let total = 0;
  let got = 0;
  set({ kind: "downloading", version: update.version, percent: null });
  try {
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") total = event.data.contentLength ?? 0;
      else if (event.event === "Progress") {
        got += event.data.chunkLength;
        // Thousands of chunks: Settings re-renders only when the shown number moves.
        const percent = total ? Math.min(100, Math.round((got / total) * 100)) : null;
        if (state.kind === "downloading" && percent !== state.percent) set({ kind: "downloading", version: update.version, percent });
      }
    });
    // Only reached where the installer does not close the app.
    await relaunch();
  } catch (e) {
    set({ kind: "available", version: update.version });
    toast(t("Could not update: {error}", { error: String(e) }));
  }
}

/** The first check a moment after start, then the timer. Called once by the main window. */
export function startUpdateChecks() {
  setTimeout(() => checkForUpdate(true), FIRST_CHECK_MS);
  setInterval(() => checkForUpdate(true), EVERY_MS);
}
