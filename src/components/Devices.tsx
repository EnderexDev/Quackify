import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { t } from "../i18n";
import { usePlayer, type Device } from "../state/player";
import { CloseIcon, DeviceIcon, DevicesIcon } from "./icons";

// The device whose "Playing on" pill was closed. Only for this session, and only for that
// device: another one taking over, or the music coming back here, brings the pill back.
let hiddenFor: string | null = null;
const hiddenListeners = new Set<() => void>();
function setHiddenFor(id: string | null) {
  if (hiddenFor === id) return;
  hiddenFor = id;
  hiddenListeners.forEach((f) => f());
}
const useHiddenFor = () =>
  useSyncExternalStore(
    (f) => {
      hiddenListeners.add(f);
      return () => hiddenListeners.delete(f);
    },
    () => hiddenFor,
  );

/** The Spotify Connect picker: every device on the account, click one to move playback there. */
export function DevicePicker() {
  const player = usePlayer();
  const hidden = useHiddenFor();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // The pill was closed: the button carries its dot, and opening the picker is the way back.
  const minimized = !!player.remoteDevice && hidden === player.remoteDevice.id;

  // Close on a click outside or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = player.devices.find((d) => d.is_active) ?? player.devices.find((d) => d.is_local);
  const others = player.devices.filter((d) => d !== current);

  const pick = (d: Device) => {
    player.transfer(d.id);
    setOpen(false);
  };

  return (
    <div className="devices" ref={box}>
      <button
        className={`icon-btn ${player.remoteDevice ? "remote" : ""} ${minimized ? "remote-min" : ""}`}
        onClick={() => setOpen(!open)}
        aria-label={t("Connect to a device")}
        title={t("Connect to a device")}
      >
        <DevicesIcon size={20} />
      </button>
      {open && (
        <div className="devices-pop">
          {/* Figma "seletor de aparelhos": where it plays on top, then the others. */}
          {current && (
            <div className={`devices-now ${current.is_local ? "" : "remote"}`}>
              <div className="devices-now-name">{current.is_local ? t("Playing on this computer") : t("Playing on {name}", { name: current.name })}</div>
              <div className="device-sub">{current.is_local ? "Quackify" : kindLabel(current.kind)}</div>
            </div>
          )}
          {current && others.length > 0 && <div className="menu-sep" />}
          {others.length > 0 && <div className="devices-sub">{t("Other devices")}</div>}
          {others.map((d) => (
            <button key={d.id} className="device" onClick={() => pick(d)}>
              <DeviceIcon kind={d.kind} size={18} />
              <div>
                <div className="device-name">{d.is_local ? t("This computer") : d.name}</div>
                <div className="device-sub">{d.is_local ? "Quackify" : kindLabel(d.kind)}</div>
              </div>
            </button>
          ))}
          {player.devices.length === 0 && <div className="muted small pad">{t("Looking for devices…")}</div>}
        </div>
      )}
    </div>
  );
}

/** Over the player while another device is the one playing: its name and a way to bring the music here. */
export function RemotePill() {
  const player = usePlayer();
  const hidden = useHiddenFor();
  const [leaving, setLeaving] = useState(false);
  const d = player.remoteDevice;
  const local = player.devices.find((x) => x.is_local);

  // Another device took over, or the music came back here: the pill shows again.
  useEffect(() => {
    if (d?.id !== hiddenFor) setHiddenFor(null);
    setLeaving(false);
  }, [d?.id]);

  if (!d || hidden === d.id) return null;
  return (
    <div
      className={`remote-pill ${leaving ? "leaving" : ""}`}
      role="status"
      onAnimationEnd={(e) => leaving && e.target === e.currentTarget && setHiddenFor(d.id)}
    >
      <span className="remote-dot" />
      <DeviceIcon kind={d.kind} size={16} />
      <span className="remote-name">{t("Playing on {name}", { name: d.name })}</span>
      {local && (
        <button className="remote-here" onClick={() => player.transfer(local.id)}>
          {t("Play here")}
        </button>
      )}
      <button className="remote-close" onClick={() => setLeaving(true)} aria-label={t("Hide")} title={t("Hide")}>
        <CloseIcon size={14} />
      </button>
    </div>
  );
}

function kindLabel(kind: string): string {
  const k = kind.toLowerCase().replace(/_/g, " ");
  // The kinds that show up most; any other keeps Spotify's own word.
  if (k === "computer") return t("Computer");
  if (k === "smartphone") return t("Smartphone");
  if (k === "tablet") return t("Tablet");
  if (k === "speaker") return t("Speaker");
  if (k === "tv") return t("TV");
  if (k === "game console") return t("Game console");
  if (k === "automobile") return t("Car");
  return k.charAt(0).toUpperCase() + k.slice(1);
}
