// In-app navigation with back and forward, like a browser history of pages.
import { createContext, useContext, useState, type ReactNode } from "react";

export type Route =
  | { page: "home" }
  | { page: "search"; term: string }
  | { page: "collection"; uri: string }
  | { page: "artist"; uri: string };

type Nav = {
  route: Route;
  go: (r: Route) => void;
  /** Swaps the current page without a history entry (typing in the search box). */
  replace: (r: Route) => void;
  back: () => void;
  forward: () => void;
  canBack: boolean;
  canForward: boolean;
  /** Opens the page for a Spotify URI (playlist, album, artist, Liked Songs). */
  open: (uri: string) => void;
};

const NavContext = createContext<Nav | null>(null);

export function useNav(): Nav {
  const n = useContext(NavContext);
  if (!n) throw new Error("useNav outside NavProvider");
  return n;
}

const same = (a: Route, b: Route) => JSON.stringify(a) === JSON.stringify(b);

export function NavProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ stack: Route[]; at: number }>({ stack: [{ page: "home" }], at: 0 });
  const route = state.stack[state.at];

  const go = (r: Route) =>
    setState((s) => (same(s.stack[s.at], r) ? s : { stack: [...s.stack.slice(0, s.at + 1), r], at: s.at + 1 }));

  const value: Nav = {
    route,
    go,
    replace: (r) => setState((s) => ({ stack: s.stack.map((x, i) => (i === s.at ? r : x)), at: s.at })),
    back: () => setState((s) => ({ ...s, at: Math.max(0, s.at - 1) })),
    forward: () => setState((s) => ({ ...s, at: Math.min(s.stack.length - 1, s.at + 1) })),
    canBack: state.at > 0,
    canForward: state.at < state.stack.length - 1,
    open: (uri) => {
      if (uri.startsWith("spotify:artist:")) go({ page: "artist", uri });
      else if (/^spotify:(playlist|album|collection)/.test(uri)) go({ page: "collection", uri });
    },
  };

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}
