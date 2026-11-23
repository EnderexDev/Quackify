// Quackify's installer and update window (setup.rs), the whole of its own small window.
// Installing: the folder and the desktop shortcut, then Install, then Open Quackify. Updating:
// it starts by itself, shows the real download percentage, then installing (no number: silent
// NSIS reports none), and closes when the installer opens the new Quackify.
import { useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { t } from "../i18n";
import { CloseIcon, DuckIcon, FolderIcon } from "./icons";
import { Toggle } from "./Toggle";

type Info = { mode: "install" | "update"; version: string; dir: string; installed: boolean };
type Progress = { stage: "found"; version: string } | { stage: "downloading"; percent: number | null } | { stage: "installing" };
type Stage =
  | { kind: "ready" }
  | { kind: "checking" }
  | { kind: "downloading"; percent: number | null }
  | { kind: "installing" }
  | { kind: "done" }
  | { kind: "error"; message: string };

const close = () => invoke("setup_close");

export function Setup() {
  const [info, setInfo] = useState<Info | null>(null);
  const [dir, setDir] = useState("");
  const [desktop, setDesktop] = useState(true);
  const [version, setVersion] = useState("");
  const [stage, setStage] = useState<Stage>({ kind: "ready" });
  const started = useRef(false);

  useEffect(() => {
    invoke<Info>("setup_info").then((i) => {
      setInfo(i);
      setDir(i.dir);
      setVersion(i.version);
      if (i.mode === "update") update();
    });
  }, []);

  const update = async () => {
    // StrictMode runs the first effect twice: one update only.
    if (started.current) return;
    started.current = true;
    setStage({ kind: "checking" });
    const progress = new Channel<Progress>();
    progress.onmessage = (p) => {
      if (p.stage === "found") setVersion(p.version);
      else if (p.stage === "downloading") setStage({ kind: "downloading", percent: p.percent });
      else setStage({ kind: "installing" });
    };
    try {
      // On success the installer opens the new Quackify and this window closes itself.
      await invoke("setup_update", { progress });
    } catch (e) {
      started.current = false;
      setStage({ kind: "error", message: String(e) });
    }
  };

  const install = async () => {
    setStage({ kind: "installing" });
    try {
      await invoke("setup_install", { dir, desktop });
      setStage({ kind: "done" });
    } catch (e) {
      setStage({ kind: "error", message: String(e) });
    }
  };

  const pick = async () => {
    const picked = await invoke<string | null>("setup_pick_folder");
    if (!picked) return;
    setDir(picked);
    const installed = await invoke<boolean>("setup_installed", { dir: picked });
    setInfo((i) => i && { ...i, installed });
  };

  const open = () => invoke("setup_launch", { dir }).catch((e) => setStage({ kind: "error", message: String(e) }));

  if (!info) return <div className="setup" />;
  const updating = info.mode === "update";
  const busy = stage.kind === "checking" || stage.kind === "downloading" || stage.kind === "installing";

  const title =
    stage.kind === "done"
      ? t("Quackify is installed")
      : stage.kind === "error"
        ? updating
          ? t("The update did not go through")
          : t("The install did not go through")
        : updating
          ? version
            ? t("Updating to Quackify {version}", { version })
            : t("Looking for the new version…")
          : "Quackify";

  const line =
    stage.kind === "downloading"
      ? stage.percent === null
        ? t("Downloading…")
        : t("Downloading… {percent}%", { percent: stage.percent })
      : stage.kind === "installing"
        ? updating
          ? t("Installing. Quackify opens again by itself.")
          : t("Installing…")
        : stage.kind === "done"
          ? t("Your music, in a quack.")
          : stage.kind === "error"
            ? stage.message
            : stage.kind === "checking"
              ? t("Asking GitHub…")
              : info.installed
                ? t("Quackify {version} over the one already in this folder. Your login and settings stay.", { version })
                : t("A Spotify player, yellow, with a duck's taste.");

  return (
    <div className="setup">
      <header className="setup-bar" data-tauri-drag-region>
        <span className="setup-bar-title" data-tauri-drag-region>
          {updating ? t("Quackify update") : t("Install Quackify")}
        </span>
        {!busy && (
          <button className="setup-close" aria-label={t("Close")} onClick={close}>
            <CloseIcon size={14} />
          </button>
        )}
      </header>

      <main className="setup-body">
        <div className={`setup-duck ${busy ? "busy" : ""} ${stage.kind === "done" ? "done" : ""}`}>
          <DuckIcon size={busy ? 52 : 76} />
        </div>
        <h1>{title}</h1>
        <p className={`setup-line ${stage.kind === "error" ? "error" : "muted"}`}>{line}</p>

        {(stage.kind === "downloading" || stage.kind === "installing" || stage.kind === "checking") && (
          <div className={`setup-progress ${stage.kind === "downloading" && stage.percent !== null ? "" : "endless"}`}>
            <i style={stage.kind === "downloading" && stage.percent !== null ? { width: `${stage.percent}%` } : undefined} />
          </div>
        )}

        {/* Also after a failed install: a folder it could not write to can be changed before trying again. */}
        {!updating && (stage.kind === "ready" || stage.kind === "error") && (
          <div className="setup-options">
            <div className="setup-option">
              <FolderIcon size={16} />
              <span className="setup-path" title={dir}>
                {dir}
              </span>
              <button className="pill-button" onClick={pick}>
                {t("Change…")}
              </button>
            </div>
            <label className="setup-option">
              <span>{t("Shortcut on the desktop")}</span>
              <Toggle on={desktop} onChange={setDesktop} />
            </label>
          </div>
        )}

        <div className="setup-actions">
          {stage.kind === "ready" && !updating && (
            <button className="primary" onClick={install}>
              {info.installed ? t("Update") : t("Install")}
            </button>
          )}
          {stage.kind === "done" && (
            <button className="primary" onClick={open}>
              {t("Open Quackify")}
            </button>
          )}
          {stage.kind === "error" && (
            <>
              <button className="primary" onClick={updating ? update : install}>
                {t("Try again")}
              </button>
              {updating && (
                <button className="secondary" onClick={open}>
                  {t("Open Quackify")}
                </button>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
