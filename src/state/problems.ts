// When something goes wrong on someone's PC: the webview's errors go to the same log file as the
// Rust side's (logs.rs), Settings > About and the crash screen open its folder, and Report a
// problem opens a GitHub issue that already carries the version.
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { error as logError } from "@tauri-apps/plugin-log";
import { openUrl } from "@tauri-apps/plugin-opener";
import { t } from "../i18n";

const ISSUES = "https://github.com/EnderexDev/Quackify/issues/new";
/** The encoded body's most, in characters. */
const MAX_BODY = 6000;

/** Writes `message` to the log file; a failure to log is only left to the console. */
export function logProblem(message: string) {
  console.error(message);
  logError(message).catch(() => {});
}

const describe = (e: unknown) => (e instanceof Error ? e.stack ?? `${e.name}: ${e.message}` : String(e));

window.addEventListener("error", (e) => logProblem(`[webview] ${describe(e.error ?? e.message)}`));
window.addEventListener("unhandledrejection", (e) => logProblem(`[webview] unhandled: ${describe(e.reason)}`));

export const openLogFolder = () => invoke("logs_open_folder");

/** A new GitHub issue with the version and Windows filled in; `detail` goes in too (the crash). */
export async function reportProblem(detail?: string) {
  const version = await getVersion().catch(() => "?");
  const body = (cut: number) =>
    [
      `**${t("What happened?")}**`,
      "",
      "",
      `**${t("What did you do right before?")}**`,
      "",
      "",
      `Quackify ${version} · ${navigator.userAgent.match(/Windows NT [\d.]+/)?.[0] ?? navigator.platform}`,
      t("Logs: Settings > About > Open log folder, then drag the newest file here."),
      ...(detail && cut > 0 ? ["", "```", Array.from(detail).slice(0, cut).join(""), "```"] : []),
    ].join("\n");
  // GitHub turns away a URL past about 8 KB, and encoding can make each character 9 bytes:
  // the detail is cut until the encoded body fits. It is cut by code points: half an emoji makes
  // encodeURIComponent throw.
  let cut = 3000;
  while (cut > 0 && encodeURIComponent(body(cut)).length > MAX_BODY) cut = Math.floor(cut / 2);
  return openUrl(`${ISSUES}?body=${encodeURIComponent(body(cut))}`);
}
