// The Jam button on the player: who is listening along (their faces take the icon's place), and
// starting, sharing, ending or leaving a Jam. Friends join with the link in their own Spotify app.
import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import { others, startJam, stopJam, useJam, type JamMember } from "../state/jam";
import { notify, toast } from "../state/toast";
import { JamIcon } from "./icons";

/** The most faces shown on the button. */
const FACES = 3;

export function JamButton() {
  const jam = useJam();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const friends = others(jam);

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

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
    } catch (e) {
      toast(e);
    } finally {
      setBusy(false);
    }
  };
  const copy = (url: string) =>
    navigator.clipboard.writeText(url).then(() => notify(t("Invite link copied"), { kind: "success" }), toast);
  const start = () => run(async () => copy((await startJam()).share_url));

  const label = friends.length ? t("Listening with {names}", { names: friends.map((f) => f.name).join(", ") }) : t("Jam");

  return (
    <div className="jam" ref={box}>
      <button className={`icon-btn jam-btn ${jam ? "on" : ""}`} onClick={() => setOpen(!open)} aria-label={label} title={label}>
        {friends.length ? (
          <span className="jam-faces">
            {friends.slice(0, FACES).map((m) => (
              <Face key={m.id} member={m} size={22} />
            ))}
          </span>
        ) : (
          <JamIcon size={20} />
        )}
      </button>
      {open && (
        <div className="jam-pop">
          <div className="jam-title">{t("Jam")}</div>
          {!jam ? (
            <>
              <p className="jam-text">{t("Listen together: friends join with a link and add songs from their own Spotify.")}</p>
              <button className="jam-main" disabled={busy} onClick={start}>
                {busy ? t("Starting…") : t("Start a Jam")}
              </button>
            </>
          ) : (
            <>
              <div className="jam-members">
                {jam.members.map((m) => (
                  <div key={m.id} className="jam-member">
                    <Face member={m} size={32} />
                    <span className="jam-name">{m.name}</span>
                    {m.is_host && <span className="jam-tag">{t("Host")}</span>}
                    {m.is_me && !m.is_host && <span className="jam-tag">{t("You")}</span>}
                  </div>
                ))}
              </div>
              {friends.length === 0 && <p className="jam-text">{t("No one has joined yet. Send the link to a friend.")}</p>}
              <button className="jam-main" onClick={() => copy(jam.share_url)}>
                {t("Copy invite link")}
              </button>
              <button className="jam-end" disabled={busy} onClick={() => run(() => stopJam(jam).then(() => setOpen(false)))}>
                {jam.is_host ? t("End the Jam") : t("Leave the Jam")}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** A member's picture, or their initial on a colour when they have none. */
function Face({ member, size }: { member: JamMember; size: number }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size };
  if (member.image && !broken) {
    return <img className="jam-face" style={style} src={member.image} alt="" onError={() => setBroken(true)} />;
  }
  return (
    <span className="jam-face jam-initial" style={{ ...style, fontSize: size * 0.45 }} aria-hidden>
      {member.name.charAt(0).toUpperCase()}
    </span>
  );
}
