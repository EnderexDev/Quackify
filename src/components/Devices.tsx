import { useEffect, useRef, useState } from "react";
import { usePlayer, type Device } from "../state/player";
import { DeviceIcon, DevicesIcon } from "./icons";

/** The Spotify Connect picker: every device on the account, click one to move playback there. */
export function DevicePicker() {
  const player = usePlayer();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

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
        className={`icon-btn ${player.remoteDevice ? "on" : ""}`}
        onClick={() => setOpen(!open)}
        aria-label="Connect to a device"
        title="Connect to a device"
      >
        <DevicesIcon size={20} />
      </button>
      {open && (
        <div className="devices-pop">
          <div className="devices-title">Connect to a device</div>
          {current && (
            <div className="device current">
              <DeviceIcon kind={current.kind} size={28} />
              <div>
                <div className="device-name">{current.is_local ? "This computer" : current.name}</div>
                <div className="device-sub">{player.remoteDevice ? "Listening on" : "Quackify"}</div>
              </div>
            </div>
          )}
          {others.length > 0 && <div className="devices-sub">Select another device</div>}
          {others.map((d) => (
            <button key={d.id} className="device" onClick={() => pick(d)}>
              <DeviceIcon kind={d.kind} size={24} />
              <div>
                <div className="device-name">{d.is_local ? "This computer" : d.name}</div>
                <div className="device-sub">{d.is_local ? "Quackify" : kindLabel(d.kind)}</div>
              </div>
            </button>
          ))}
          {player.devices.length === 0 && <div className="muted small pad">Looking for devices…</div>}
        </div>
      )}
    </div>
  );
}

/** The yellow strip under the player when another device is the one playing. */
export function RemoteBanner() {
  const player = usePlayer();
  const d = player.remoteDevice;
  if (!d) return null;
  return (
    <div className="remote-banner">
      <DeviceIcon kind={d.kind} size={16} />
      <span>Playing on {d.name}</span>
    </div>
  );
}

function kindLabel(kind: string): string {
  const k = kind.toLowerCase().replace(/_/g, " ");
  return k.charAt(0).toUpperCase() + k.slice(1);
}
