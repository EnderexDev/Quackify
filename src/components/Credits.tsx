// "Show credits": a dialog with everyone who made a song, grouped by role (Performed by,
// Written by, Produced by...). Any menu can open it with openCredits(uri).
import { useEffect, useState } from "react";
import { credits as loadCredits } from "../api/spotify";
import type { Credits } from "../api/types";
import { useNav } from "../state/nav";
import { Dialog } from "./Dialog";

const openers = new Set<(uri: string) => void>();

/** Shows the credits of a song. */
export function openCredits(uri: string) {
  openers.forEach((o) => o(uri));
}

/** Mounted once; shows the dialog when openCredits is called. */
export function CreditsHost() {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    openers.add(setUri);
    return () => {
      openers.delete(setUri);
    };
  }, []);
  return uri ? <CreditsDialog key={uri} uri={uri} onClose={() => setUri(null)} /> : null;
}

function CreditsDialog({ uri, onClose }: { uri: string; onClose: () => void }) {
  const nav = useNav();
  const [data, setData] = useState<Credits | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    loadCredits(uri).then(setData, (e) => setError(String(e)));
  }, [uri]);

  return (
    <Dialog title="Credits" onClose={onClose}>
      {!data && !error && <div className="spinner small" />}
      {error && <p className="muted">Could not load the credits.</p>}
      {data && (
        <div className="credits">
          <div className="credits-song">{data.title}</div>
          {data.groups.map((g) => (
            <section key={g.role}>
              <h3>{g.role}</h3>
              {g.people.map((p) => (
                <div key={p.name} className="credits-person">
                  {p.uri ? (
                    <a
                      onClick={() => {
                        onClose();
                        nav.open(p.uri!);
                      }}
                    >
                      {p.name}
                    </a>
                  ) : (
                    <span>{p.name}</span>
                  )}
                  {p.roles.length > 0 && <span className="muted small">{p.roles.join(", ")}</span>}
                </div>
              ))}
            </section>
          ))}
          {data.sources.length > 0 && <p className="muted small credits-source">Source: {data.sources.join(", ")}</p>}
        </div>
      )}
      <div className="dialog-actions">
        <button className="secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
