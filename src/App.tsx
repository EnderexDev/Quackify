import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

type Status = { logged_in: boolean; username: string | null };
type PlayerEvent =
  | { kind: "loading"; uri: string }
  | { kind: "playing"; uri: string; position_ms: number }
  | { kind: "paused"; uri: string; position_ms: number }
  | { kind: "stopped" }
  | { kind: "end_of_track"; uri: string }
  | { kind: "unavailable"; uri: string };

// Temporary screen that proves login and audio; the real screens are still to be designed.
function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uri, setUri] = useState("");
  const [player, setPlayer] = useState<PlayerEvent | null>(null);
  const [log, setLog] = useState<string[]>([]);

  async function run<T>(label: string, action: () => Promise<T>) {
    setBusy(true);
    setError("");
    try {
      return await action();
    } catch (e) {
      setError(`${label}: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    // A failed restore (stale credentials, no network) still has to land on the login button.
    run("restore", () => invoke<Status>("spotify_restore")).then((s) =>
      setStatus(s ?? { logged_in: false, username: null }),
    );
    const unlisten = listen<PlayerEvent>("player-event", ({ payload }) => {
      setPlayer(payload);
      setLog((l) => [`${payload.kind}${"uri" in payload ? ` ${payload.uri}` : ""}`, ...l].slice(0, 20));
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const login = () => run("login", () => invoke<Status>("spotify_login")).then((s) => s && setStatus(s));
  // Not through run(): the login call still holds busy, and its own error ends it.
  const cancelLogin = () => invoke("spotify_cancel_login");
  const logout = () =>
    run("logout", async () => {
      await invoke("spotify_logout");
      return true;
    }).then((ok) => ok && setStatus({ logged_in: false, username: null }));
  const play = () => run("play", () => invoke<string>("spotify_play", { uri }));
  const pause = () => run("pause", () => invoke("spotify_pause"));
  const resume = () => run("resume", () => invoke("spotify_resume"));

  const playing = player?.kind === "playing";

  return (
    <main className="container">
      <h1>Quackify</h1>

      {status === null ? (
        <p>Connecting…</p>
      ) : status.logged_in ? (
        <>
          <p className="who">
            Logged in as <b>{status.username}</b>{" "}
            <button className="link" onClick={logout} disabled={busy}>
              log out
            </button>
          </p>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              play();
            }}
          >
            <input
              value={uri}
              onChange={(e) => setUri(e.currentTarget.value)}
              placeholder="spotify:track:… or an open.spotify.com link"
            />
            <button type="submit" disabled={busy || !uri.trim()}>
              Play
            </button>
          </form>
          <div className="row">
            <button onClick={playing ? pause : resume} disabled={busy || !player || player.kind === "stopped"}>
              {playing ? "Pause" : "Resume"}
            </button>
          </div>
          <p className="state">{player ? player.kind.replace(/_/g, " ") : "idle"}</p>
        </>
      ) : (
        <div className="row">
          <button onClick={login} disabled={busy}>
            {busy ? "Waiting for the browser…" : "Log in with Spotify"}
          </button>
          {busy && (
            <button className="secondary" onClick={cancelLogin}>
              Cancel
            </button>
          )}
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {log.length > 0 && (
        <ul className="log">
          {log.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
    </main>
  );
}

export default App;
