import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { clearCache } from "./api/spotify";
import { DuckIcon } from "./components/icons";
import { ContextMenuProvider } from "./components/ContextMenu";
import { CreditsHost } from "./components/Credits";
import { PlayerBar } from "./components/PlayerBar";
import { NowPlayingPanel } from "./components/NowPlaying";
import { QueuePanel } from "./components/Queue";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { NavProvider, useNav } from "./state/nav";
import { PlayerProvider, usePlayer } from "./state/player";
import { toast, Toasts } from "./state/toast";
import { Artist } from "./views/Artist";
import { BrowseView } from "./views/Browse";
import { CardsView } from "./views/Cards";
import { Collection } from "./views/Collection";
import { Home } from "./views/Home";
import { LyricsView } from "./views/Lyrics";
import { Search } from "./views/Search";
import { SettingsView } from "./views/Settings";
import { EpisodeView, ShowView } from "./views/Show";
import "./App.css";

type Profile = { display_name: string | null; image: string | null };
type Status = { logged_in: boolean; username: string | null; profile?: Profile };

function App() {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    // A failed restore (stale credentials, no network) still has to land on the login screen.
    invoke<Status>("spotify_restore")
      .then(setStatus)
      .catch((e) => {
        toast(e);
        setStatus({ logged_in: false, username: null });
      });
  }, []);

  if (status === null) {
    return (
      <div className="splash">
        <DuckIcon size={72} />
        <div className="spinner" />
      </div>
    );
  }
  if (!status.logged_in) {
    return (
      <>
        <Login onLoggedIn={setStatus} />
        <Toasts />
      </>
    );
  }

  const logout = async () => {
    try {
      await invoke("spotify_logout");
      clearCache();
      setStatus({ logged_in: false, username: null });
    } catch (e) {
      toast(e);
    }
  };

  return (
    <NavProvider>
      <PlayerProvider>
        <ContextMenuProvider>
        <Shell name={status.profile?.display_name ?? status.username ?? ""} image={status.profile?.image ?? null} onLogout={logout} />
        <CreditsHost />
        </ContextMenuProvider>
        <Toasts />
      </PlayerProvider>
    </NavProvider>
  );
}

export type Panel = "queue" | "nowplaying" | null;

function Shell({ name, image, onLogout }: { name: string; image: string | null; onLogout: () => void }) {
  const nav = useNav();
  const player = usePlayer();
  const route = nav.route;
  // The right-hand panel. Which one was open is kept for the next start, like Spotify does.
  const [panel, setPanelState] = useState<Panel>(() => {
    const saved = localStorage.getItem("panel");
    return saved === "queue" || saved === "nowplaying" ? saved : null;
  });
  const setPanel = (p: Panel) => {
    setPanelState(p);
    if (p) localStorage.setItem("panel", p);
    else localStorage.removeItem("panel");
  };

  // Space plays/pauses, Alt+arrows go back/forward, unless the user is typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.("input, textarea");
      if (e.code === "Space" && !typing) {
        e.preventDefault();
        player.toggle();
      } else if (e.altKey && e.key === "ArrowLeft") nav.back();
      else if (e.altKey && e.key === "ArrowRight") nav.forward();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player, nav]);

  const key = JSON.stringify(route);
  return (
    <div className={`shell ${panel ? "with-queue" : ""}`}>
      <TopBar name={name} image={image} onLogout={onLogout} />
      <Sidebar />
      <main className="main panel" key={route.page === "search" ? "search" : key}>
        {route.page === "home" && <Home />}
        {route.page === "search" && <Search term={route.term} />}
        {route.page === "collection" && <Collection uri={route.uri} />}
        {route.page === "artist" && <Artist uri={route.uri} />}
        {route.page === "lyrics" && <LyricsView />}
        {route.page === "settings" && <SettingsView account={{ name, image, onLogout }} />}
        {route.page === "show" && <ShowView uri={route.uri} />}
        {route.page === "episode" && <EpisodeView uri={route.uri} />}
        {route.page === "browse" && <BrowseView uri={route.uri} />}
        {route.page === "cards" && <CardsView source={route.source} uri={route.uri} title={route.title} />}
      </main>
      {panel === "queue" && <QueuePanel onClose={() => setPanel(null)} />}
      {panel === "nowplaying" && <NowPlayingPanel onClose={() => setPanel(null)} onOpenQueue={() => setPanel("queue")} />}
      <PlayerBar panel={panel} onPanel={(p) => setPanel(panel === p ? null : p)} />
    </div>
  );
}

function Login({ onLoggedIn }: { onLoggedIn: (s: Status) => void }) {
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");

  const login = async () => {
    setWaiting(true);
    setError("");
    try {
      onLoggedIn(await invoke<Status>("spotify_login"));
    } catch (e) {
      setError(String(e));
    } finally {
      setWaiting(false);
    }
  };

  return (
    <div className="login">
      <DuckIcon size={96} />
      <h1>Quackify</h1>
      <p className="muted">Your music, quacking fast.</p>
      <div className="login-actions">
        <button className="primary" onClick={login} disabled={waiting}>
          {waiting ? "Waiting for the browser…" : "Log in with Spotify"}
        </button>
        {waiting && (
          <button className="secondary" onClick={() => invoke("spotify_cancel_login")}>
            Cancel
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

export default App;
