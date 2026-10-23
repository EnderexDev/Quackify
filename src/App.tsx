import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { clearCache } from "./api/spotify";
import { Aura } from "./components/Aura";
import { Cinema, useCinemaAuto } from "./components/Cinema";
import { DuckIcon } from "./components/icons";
import { FloatingScrollbar } from "./components/FloatingScrollbar";
import { ContextMenuProvider } from "./components/ContextMenu";
import { CreditsHost } from "./components/Credits";
import { PeekLayer } from "./components/Peek";
import { PlayerBar } from "./components/PlayerBar";
import { OPEN_PALETTE_EVENT, Palette, type PaletteCommand } from "./components/Palette";
import { QueuePanel } from "./components/Queue";
import { NewPlaylistHost } from "./components/NewPlaylist";
import { Sidebar } from "./components/Sidebar";
import { newPlaylist } from "./state/newPlaylist";
import { ShortcutsDialog, useShortcuts } from "./components/Shortcuts";
import { TopBar } from "./components/TopBar";
import { NavProvider, useNav, type Nav } from "./state/nav";
import { PlayerProvider, usePlayerNow, type NowPlaying } from "./state/player";
import { setTheme } from "./state/theme";
import { syncLang, t, useLang } from "./i18n";
import { setCinema, toggleCinema, toggleMini, useCinema } from "./state/windows";
import { toast, Toasts } from "./state/toast";
import { Artist } from "./views/Artist";
import { BrowseView, ExploreView } from "./views/Browse";
import { CardsView } from "./views/Cards";
import { LibraryView } from "./views/Library";
import { Collection } from "./views/Collection";
import { Home } from "./views/Home";
import { Search } from "./views/Search";
import { SongView } from "./views/Song";
import { SettingsView } from "./views/Settings";
import { ProfileView } from "./views/Profile";
import { EpisodeView, ShowView } from "./views/Show";
import "./styles/index.css";

type Profile = { display_name: string | null; image: string | null };
type Status = { logged_in: boolean; username: string | null; profile?: Profile };

// Someone who chose the web player gets it again at the next start, until they leave it.
const WEB_PLAYER_KEY = "webPlayer";

// The account's name and picture arrive a moment after the login ("spotify-profile"), so the app
// opens without waiting for them; until then it shows the ones seen last time.
const PROFILE_KEY = "profile";
const hasProfile = (p?: Profile) => !!(p?.display_name || p?.image);
function withSavedProfile(s: Status): Status {
  if (!s.logged_in || hasProfile(s.profile)) return s;
  try {
    const saved = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? "null");
    if (saved?.username === s.username) return { ...s, profile: saved.profile };
  } catch {
    // Nothing saved yet.
  }
  return s;
}

/** The account seen last, to open the app with it at once while Spotify connects. */
function lastStatus(): Status | null {
  try {
    const saved = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? "null");
    return saved?.username ? { logged_in: true, username: saved.username, profile: saved.profile } : null;
  } catch {
    return null;
  }
}

function App() {
  // The last account opens the app straight away (its Home and Your Library come from the copies
  // kept on disk); Spotify's answer confirms it a moment later, or sends it to the login screen.
  const [status, setStatus] = useState<Status | null>(lastStatus);
  // Every text re-reads the language: the shell starts over when it changes (the page open and
  // the player stay, they live above it).
  const language = useLang();
  useEffect(() => {
    syncLang();
  }, []);
  // Reads already cached carry the old language in what the app wrote into them ("Album • …"):
  // dropped on every change, here in render, before the new shell reads them again (an effect
  // would run after the shell's own, which already read the old ones).
  const shownLanguage = useRef(language);
  if (shownLanguage.current !== language) {
    shownLanguage.current = language;
    clearCache();
  }
  const [webPlayer, setWebPlayer] = useState(() => localStorage.getItem(WEB_PLAYER_KEY) === "1");

  // The last profile heard, kept in case it comes before the login's status does.
  const heard = useRef<(Profile & { username: string }) | null>(null);
  const showStatus = (s: Status) => {
    const p = heard.current;
    setStatus(withSavedProfile(s.logged_in && p && p.username === s.username && hasProfile(p) ? { ...s, profile: p } : s));
  };
  useEffect(() => {
    const off = listen<Profile & { username: string }>("spotify-profile", ({ payload }) => {
      if (!hasProfile(payload)) return;
      heard.current = payload;
      const profile = { display_name: payload.display_name, image: payload.image };
      setStatus((s) => (s?.logged_in && s.username === payload.username ? { ...s, profile } : s));
    });
    return () => {
      off.then((f) => f());
    };
  }, []);
  useEffect(() => {
    if (!status?.logged_in || !hasProfile(status.profile)) return;
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify({ username: status.username, profile: status.profile }));
    } catch {
      // Storage full or off: the next start just waits for the profile.
    }
  }, [status]);

  useEffect(() => {
    // A failed restore (stale credentials, no network) still has to land on the login screen.
    invoke<Status>("spotify_restore")
      .then((s) => {
        // Not that account anymore: nothing it kept may show.
        const shown = lastStatus();
        if (shown && (!s.logged_in || s.username !== shown.username)) clearCache();
        showStatus(s);
      })
      .catch((e) => {
        toast(e);
        setStatus({ logged_in: false, username: null });
      });
  }, []);

  if (status === null) {
    return (
      <div className="splash" role="status">
        <div className="splash-ring">
          <DuckIcon size={56} />
        </div>
        <p className="muted small">{t("Connecting to Spotify…")}</p>
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
          <Login onLoggedIn={showStatus} onWebPlayer={() => openWebPlayer(true)} />
        )}
        <Toasts />
      </>
    );
  }

  const logout = async () => {
    try {
      await invoke("spotify_logout");
      clearCache();
      localStorage.removeItem(PROFILE_KEY);
      setStatus({ logged_in: false, username: null });
    } catch (e) {
      toast(e);
    }
  };

  return (
    <NavProvider>
      <PlayerProvider>
        <ContextMenuProvider>
        <Shell
          key={language}
          name={status.profile?.display_name ?? status.username ?? ""}
          image={status.profile?.image ?? null} onLogout={logout} />
        <CreditsHost />
        </ContextMenuProvider>
        <Toasts />
      </PlayerProvider>
    </NavProvider>
  );
}

/** The right-hand panel: only the queue (the Now playing panel became the song page). */
export type Panel = "queue" | null;

/** Whether a media query matches, kept up to date. */
function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const update = () => setOn(m.matches);
    update();
    m.addEventListener("change", update);
    return () => m.removeEventListener("change", update);
  }, [query]);
  return on;
}

/** Whether Windows says there is a network, kept up to date. */
function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

// Below 1200px wide the right-hand panel opens over the page; below 1100px Your Library
// collapses to icons and the player turns compact (the CSS has the same widths).
const NARROW = "(max-width: 1199px)";
const COMPACT = "(max-width: 1099px)";
const SIDEBAR_KEY = "sidebarCollapsed";

function Shell({ name, image, onLogout }: { name: string; image: string | null; onLogout: () => void }) {
  const nav = useNav();
  const getPlayer = usePlayerNow();
  const route = nav.route;
  // The right-hand panel. Whether it was open is kept for the next start, like Spotify does;
  // a "nowplaying" saved before the song page existed reads as closed.
  // The page that scrolls, for the bar drawn over it; a new page is a new element.
  const [main, setMain] = useState<HTMLElement | null>(null);
  const [panel, setPanelState] = useState<Panel>(() => (localStorage.getItem("panel") === "queue" ? "queue" : null));
  const setPanel = (p: Panel) => {
    setPanelState(p);
    if (p) localStorage.setItem("panel", p);
    else localStorage.removeItem("panel");
  };
  const togglePanel = (p: Exclude<Panel, null>) => setPanel(panel === p ? null : p);

  const online = useOnline();
  const narrow = useMedia(NARROW);
  const compact = useMedia(COMPACT);
  // Ctrl B: null follows the window's width; true or false is a choice that differs from it.
  const [sideChoice, setSideChoice] = useState<boolean | null>(() => {
    const saved = localStorage.getItem(SIDEBAR_KEY);
    return saved === null ? null : saved === "1";
  });
  const collapsed = sideChoice ?? compact;
  const toggleSidebar = () => {
    const next = !collapsed;
    const choice = next === compact ? null : next;
    setSideChoice(choice);
    if (choice === null) localStorage.removeItem(SIDEBAR_KEY);
    else localStorage.setItem(SIDEBAR_KEY, choice ? "1" : "0");
  };

  // The palette starts from the search shown, if any.
  const [palette, setPalette] = useState<string | null>(null);
  const openPalette = () => setPalette(route.page === "search" ? route.term : "");

  const app = useMemo(() => ({ openPalette, toggleSidebar }), [route, collapsed, compact]);
  const shortcuts = useShortcuts(getPlayer, nav, panel, togglePanel, app);
  useEffect(() => {
    const open = () => setPalette("");
    window.addEventListener(OPEN_PALETTE_EVENT, open);
    return () => window.removeEventListener(OPEN_PALETTE_EVENT, open);
  }, []);
  useOpenLinks(nav);

  // The cinema mode covers the shell; going to a page or opening the queue leaves it.
  const cinema = useCinema();
  useCinemaAuto(cinema);
  useEffect(() => {
    document.documentElement.classList.toggle("cinema-on", cinema);
  }, [cinema]);
  const cinemaRef = useRef(cinema);
  cinemaRef.current = cinema;
  const routeKey = JSON.stringify(route);
  const firstRoute = useRef(true);
  useEffect(() => {
    if (firstRoute.current) return void (firstRoute.current = false);
    if (cinemaRef.current) setCinema(false);
  }, [routeKey, panel]);
  // The mini player's lyrics button: the song page, here.
  const navRef = useRef(nav);
  navRef.current = nav;
  useEffect(() => {
    const off = listen<string>("mini-player-show", ({ payload }) => {
      setCinema(false);
      if (payload === "song" && navRef.current.route.page !== "song") navRef.current.go({ page: "song" });
    });
    return () => {
      off.then((f) => f());
    };
  }, []);

  // Over the page, the panel closes with Escape like any overlay.
  const overlay = narrow && panel !== null;
  useEffect(() => {
    if (!overlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || palette !== null) return;
      e.preventDefault();
      setPanel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlay, palette]);

  const commands: PaletteCommand[] = [
    { label: t("Home"), keys: "Alt Shift H", run: () => nav.go({ page: "home" }) },
    { label: t("Explore"), run: () => nav.go({ page: "explore" }) },
    { label: t("Your Library"), run: () => nav.go({ page: "library", filter: "Playlists" }) },
    { label: t("Settings"), keys: "Ctrl P", run: () => nav.go({ page: "settings" }) },
    { label: t("Your profile"), run: () => nav.go({ page: "user", uri: "me" }) },
    { label: t("Queue"), keys: "Alt Shift Q", run: () => togglePanel("queue") },
    { label: t("New playlist"), keys: "Ctrl N", run: () => newPlaylist() },
    { label: collapsed ? t("Expand Your Library") : t("Collapse Your Library"), keys: "Ctrl B", run: toggleSidebar },
    { label: t("Mini player"), keys: "Ctrl M", run: toggleMini },
    { label: t("Cinema mode"), keys: "F11", run: toggleCinema },
    { label: t("Theme: System"), run: () => setTheme("system") },
    { label: t("Theme: Dark"), run: () => setTheme("dark") },
    { label: t("Theme: Light"), run: () => setTheme("light") },
    { label: t("Keyboard shortcuts"), keys: "Ctrl /", run: shortcuts.openList },
  ];

  const key = JSON.stringify(route);
  return (
    <>
      <Aura />
      <div
        className={`shell ${panel && !narrow ? "with-queue" : ""} ${collapsed ? "side-collapsed" : ""} ${compact ? "compact" : ""} ${cinema ? "under-cinema" : ""}`}
      >
        <TopBar name={name} image={image} onLogout={onLogout} onSearch={openPalette} onShortcuts={shortcuts.openList} />
        <Sidebar collapsed={collapsed} onExpand={toggleSidebar} />
        <main ref={setMain} className="main panel" key={route.page === "search" ? "search" : key}>
          {route.page === "home" && <Home name={name} />}
          {route.page === "explore" && <ExploreView />}
          {route.page === "search" && <Search term={route.term} tab={route.tab} />}
          {route.page === "collection" && <Collection uri={route.uri} />}
          {route.page === "artist" && <Artist uri={route.uri} />}
          {route.page === "song" && <SongView />}
          {route.page === "settings" && <SettingsView account={{ name, image, onLogout }} />}
          {route.page === "user" && <ProfileView uri={route.uri} />}
          {route.page === "show" && <ShowView uri={route.uri} />}
          {route.page === "episode" && <EpisodeView uri={route.uri} />}
          {route.page === "browse" && <BrowseView uri={route.uri} />}
          {route.page === "cards" && <CardsView source={route.source} uri={route.uri} title={route.title} from={route.from} />}
          {route.page === "library" && <LibraryView filter={route.filter} folder={route.folder} title={route.title} />}
        </main>
        <FloatingScrollbar target={main} />
        {!online && (
          <div className="offline" role="status">
            {t("No connection. Playing only what's already saved on this computer.")}
          </div>
        )}
        {overlay && <div className="panel-scrim" onMouseDown={() => setPanel(null)} />}
        {panel === "queue" && <QueuePanel onClose={() => setPanel(null)} />}
        <PlayerBar panel={panel} onPanel={togglePanel} />
        <PeekLayer />
        <NewPlaylistHost />
        {shortcuts.listOpen && <ShortcutsDialog onClose={shortcuts.closeList} />}
      </div>
      {cinema && (
        <Cinema
          onQueue={() => {
            setCinema(false);
            setPanel("queue");
          }}
        />
      )}
      {palette !== null && <Palette key="palette" initialTerm={palette} onClose={() => setPalette(null)} commands={commands} />}
    </>
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
          if (!track?.album.uri) throw t("That song could not be found");
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
      <DuckIcon size={26} />
      <strong>Quackify</strong>
      <span className="web-player-pill">{t("Spotify Free · Spotify's web player")}</span>
      <span className="muted small web-player-note">{t("Quackify's player needs Premium.")}</span>
      <button className="pill-button" onClick={onLeave}>
        {t("Log in with Premium")}
      </button>
    </div>
  );
}

function Login({ onLoggedIn, onWebPlayer }: { onLoggedIn: (s: Status) => void; onWebPlayer: () => void }) {
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");
  // Spotify turned the account away for not being Premium: the Free card is the way in.
  const [free, setFree] = useState(false);

  const login = async () => {
    setWaiting(true);
    setError("");
    setFree(false);
    try {
      onLoggedIn(await invoke<Status>("spotify_login"));
    } catch (e) {
      const message = String(e);
      setFree(notPremium(message));
      setError(
        notPremium(message)
          ? t("Spotify didn't let this account in: Quackify's player needs Spotify Premium. With a Free account, use the web player below.")
          : message.replace(/^Error: /, ""),
      );
    } finally {
      setWaiting(false);
    }
  };

  return (
    <div className="login">
      <DuckIcon size={96} className="login-duck" />
      <h1>Quackify</h1>
      <p className="muted">{t("Your music, in a quack.")}</p>
      <div className="login-actions">
        <button className="primary login-button" onClick={login} disabled={waiting}>
          <span className="login-dot" aria-hidden />
          {waiting ? t("Waiting for the browser…") : t("Log in with Spotify")}
        </button>
        {waiting && (
          <button className="login-cancel" onClick={() => invoke("spotify_cancel_login")}>
            {t("Cancel")}
          </button>
        )}
      </div>
      {error ? (
        <p className="error login-error" role="alert">
          {error}
        </p>
      ) : (
        <p className="muted small">{t("Needs Spotify Premium. The login opens in your browser.")}</p>
      )}
      <div className={`login-free ${free ? "highlight" : ""}`}>
        <strong>{t("Spotify Free?")}</strong>
        <p className="muted small">
          {t("Spotify only lets Premium accounts into apps like Quackify. With Free you can still listen here, with Spotify's own web player inside Quackify. Quackify's player, queue, lyrics and the rest need Premium.")}
        </p>
        <button className={free ? "pill-button white" : "pill-button"} onClick={onWebPlayer}>
          {t("Open the web player")}
        </button>
      </div>
    </div>
  );
}

export default App;
