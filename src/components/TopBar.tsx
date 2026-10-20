import { useEffect, useRef, useState } from "react";
import { useNav } from "../state/nav";
import { BackIcon, DuckIcon, ForwardIcon, HomeIcon, SearchIcon } from "./icons";

/** Back/forward, home, and the search box (which opens the search page as you type). */
export function TopBar({ name, image, onLogout }: { name: string; image: string | null; onLogout: () => void }) {
  const nav = useNav();
  const route = nav.route;
  const [term, setTerm] = useState(route.page === "search" ? route.term : "");
  const input = useRef<HTMLInputElement>(null);

  // Keep the box in sync when back/forward lands on another search.
  useEffect(() => {
    if (route.page === "search") setTerm(route.term);
  }, [route]);

  // Ctrl+K or Ctrl+L focuses search, like a browser bar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.key === "k" || e.key === "l")) {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onType = (value: string) => {
    setTerm(value);
    const next = { page: "search" as const, term: value };
    if (route.page === "search") nav.replace(next);
    else nav.go(next);
  };

  return (
    <header className="topbar">
      <div className="brand">
        <DuckIcon size={30} />
        <span>Quackify</span>
      </div>
      <div className="nav-arrows">
        <button className="round-btn" disabled={!nav.canBack} onClick={nav.back} aria-label="Back">
          <BackIcon size={18} />
        </button>
        <button className="round-btn" disabled={!nav.canForward} onClick={nav.forward} aria-label="Forward">
          <ForwardIcon size={18} />
        </button>
      </div>
      <div className="topbar-center">
        <button
          className={`round-btn big ${route.page === "home" ? "on" : ""}`}
          onClick={() => nav.go({ page: "home" })}
          aria-label="Home"
        >
          <HomeIcon size={22} filled={route.page === "home"} />
        </button>
        <label className="search-box">
          <SearchIcon size={20} />
          <input
            ref={input}
            value={term}
            placeholder="What do you want to play?"
            onChange={(e) => onType(e.currentTarget.value)}
            // Like Spotify, the search box opens search (recent searches and Browse all) at once.
            onFocus={() => route.page !== "search" && onType(term)}
            spellCheck={false}
          />
          {term && (
            <button className="clear" onClick={() => onType("")} aria-label="Clear">
              ×
            </button>
          )}
        </label>
      </div>
      <div className="user">
        {image ? <img className="avatar" src={image} alt="" /> : <span className="avatar">{name.slice(0, 1).toUpperCase()}</span>}
        <span className="user-name" title={name}>
          {name}
        </span>
        <button className="link" onClick={onLogout}>
          Log out
        </button>
      </div>
    </header>
  );
}
