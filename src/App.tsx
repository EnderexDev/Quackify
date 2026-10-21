import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { clearCache } from "./api/spotify";
import { DuckIcon } from "./components/icons";
import { ContextMenuProvider } from "./components/ContextMenu";
import { CreditsHost } from "./components/Credits";
import { PlayerBar } from "./components/PlayerBar";
import { NowPlayingPanel } from "./components/NowPlaying";
import { QueuePanel } from "./components/Queue";
import { Sidebar, useNewPlaylist } from "./components/Sidebar";
import { ShortcutsDialog, useShortcuts } from "./components/Shortcuts";
import { TopBar } from "./components/TopBar";
import { NavProvider, useNav, type Nav } from "./state/nav";
import { PlayerProvider, usePlayer, type NowPlaying } from "./state/player";
import { toast, Toasts } from "./state/toast";
import { Artist } from "./views/Artist";
import { BrowseView } from "./views/Browse";
import { CardsView } from "./views/Cards";
import { Collection } from "./views/Collection";
import { Home } from "./views/Home";
import { LyricsView } from "./views/Lyrics";
import { Search } from "./views/Search";
import { SettingsView } from "./views/Settings";
import { ProfileView } from "./views/Profile";
import { EpisodeView, ShowView } from "./views/Show";
import "./App.css";

type Profile = { display_name: string | null; image: string | null };
type Status = { logged_in: boolean; username: string | null; profile?: Profile };

// Someone who chose the web player gets it again at the next start, until they leave it.
const WEB_PLAYER_KEY = "webPlayer";

function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [webPlayer, setWebPlayer] = useState(() => localStorage.getItem(WEB_PLAYER_KEY) === "1");

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
    const openWebPlayer = (on: boolean) => {
      if (on) localStorage.setItem(WEB_PLAYER_KEY, "1");
      else localStorage.removeItem(WEB_PLAYER_KEY);
      setWebPlayer(on);
    };
    return (
      <>
        {webPlayer ? (
          <WebPlayer onLeave={() => openWebPlayer(false)} />
        ) : (
          <Login onLoggedIn={setStatus} onWebPlayer={() => openWebPlayer(true)} />
        )}
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

  const shortcuts = useShortcuts(player, nav, panel, (p) => setPanel(panel === p ? null : p));
  useNewPlaylist();
  useOpenLinks(nav);

  const key = JSON.stringify(route);
  return (
    <div className={`shell ${panel ? "with-queue" : ""}`}>
      <TopBar name={name} image={image} onLogout={onLogout} />
      <Sidebar />
      <main className="main panel" key={route.page === "search" ? "search" : key}>
        {route.page === "home" && <Home />}
        {route.page === "search" && <Search term={route.term} tab={route.tab} />}
        {route.page === "collection" && <Collection uri={route.uri} />}
        {route.page === "artist" && <Artist uri={route.uri} />}
        {route.page === "lyrics" && <LyricsView />}
        {route.page === "settings" && <SettingsView account={{ name, image, onLogout }} />}
        {route.page === "user" && <ProfileView uri={route.uri} />}
        {route.page === "show" && <ShowView uri={route.uri} />}
        {route.page === "episode" && <EpisodeView uri={route.uri} />}
        {route.page === "browse" && <BrowseView uri={route.uri} />}
        {route.page === "cards" && <CardsView source={route.source} uri={route.uri} title={route.title} />}
      </main>
      {panel === "queue" && <QueuePanel onClose={() => setPanel(null)} />}
      {panel === "nowplaying" && <NowPlayingPanel onClose={() => setPanel(null)} onOpenQueue={() => setPanel("queue")} />}
      <PlayerBar panel={panel} onPanel={(p) => setPanel(panel === p ? null : p)} />
      {shortcuts.listOpen && <ShortcutsDialog onClose={shortcuts.closeList} />}
    </div>
  );
}

/** Opens the spotify: links Windows hands to Quackify, also one that started it or came before logging in. */
function useOpenLinks(nav: Nav) {
  const navRef = useRef(nav);
  navRef.current = nav;
  useEffect(() => {
    const take = () =>
      invoke<string | null>("links_take").then(async (uri) => {
        if (!uri) return;
        // Like Spotify, a song opens on its album.
        if (uri.startsWith("spotify:track:")) {
          const [track] = await invoke<NowPlaying[]>("spotify_tracks", { uris: [uri] });
          if (!track?.album.uri) throw "That song could not be found";
          uri = track.album.uri;
        }
        navRef.current.open(uri);
      }).catch(toast);
    const off = listen("open-link", take);
    take();
    return () => {
      off.then((f) => f());
    };
  }, []);
}

// Spotify turns a Free account away at librespot's login, with "Travel restriction" (measured
// 21/10/26 on an account that plays in the browser) or "Premium account required".
const notPremium = (e: string) => /travel restriction|premium/i.test(e);

/** Spotify's web player inside the window, below a bar of ours; for Free accounts. */
function WebPlayer({ onLeave }: { onLeave: () => void }) {
  useEffect(() => {
    invoke("web_player_open").catch((e) => {
      toast(e);
      onLeave();
    });
    return () => {
      invoke("web_player_close").catch(toast);
    };
  }, []);

  return (
    <div className="web-player-bar">
      <DuckIcon size={28} />
      <strong>Quackify</strong>
      <span className="muted small">Spotify Free, in Spotify's web player. Quackify's own player needs Premium.</span>
      <button className="link" onClick={onLeave}>
        Log in with Premium
      </button>
    </div>
  );
}

function Login({ onLoggedIn, onWebPlayer }: { onLoggedIn: (s: Status) => void; onWebPlayer: () => void }) {
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");

  const login = async () => {
    setWaiting(true);
    setError("");
    try {
      onLoggedIn(await invoke<Status>("spotify_login"));
    } catch (e) {
      const message = String(e);
      setError(
        notPremium(message)
          ? "Spotify didn't let this account in: Quackify's player needs Spotify Premium. With a Free account, use the web player below."
          : message,
      );
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
      {error && <p className="error login-error">{error}</p>}
      <div className="login-free">
        <strong>Spotify Free?</strong>
        <p className="muted">
          Spotify only lets Premium accounts into apps like Quackify. With Free you can still listen here, with
          Spotify's own web player inside Quackify. Quackify's player, queue, lyrics, media keys and the rest need
          Spotify Premium.
        </p>
        <button className="secondary" onClick={onWebPlayer}>
          Open the web player
        </button>
      </div>
    </div>
  );
}

export default App;
