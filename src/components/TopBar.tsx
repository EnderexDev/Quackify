import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import { useNav } from "../state/nav";
import { toggleCinema, toggleMini } from "../state/windows";
import { BackIcon, DuckIcon, ExpandIcon, ForwardIcon, KeyboardIcon, LogOutIcon, MiniPlayerIcon, SearchIcon, SettingsIcon } from "./icons";
import { Segmented } from "./Segmented";

// Labels read at render, so they follow the language.
const tabs = () => [
  { id: "home" as const, label: t("Home") },
  { id: "explore" as const, label: t("Explore") },
];

/** The duck, back and forward, the Home and Explore tabs, the magnifier that opens the palette, and the avatar menu. */
export function TopBar({
  name,
  image,
  onLogout,
  onSearch,
  onShortcuts,
}: {
  name: string;
  image: string | null;
  onLogout: () => void;
  onSearch: () => void;
  onShortcuts: () => void;
}) {
  const nav = useNav();
  const page = nav.route.page;
  const [menu, setMenu] = useState(false);

  return (
    <header className="topbar">
      <div className="brand">
        <DuckIcon size={30} />
        <span className="brand-name">Quackify</span>
      </div>
      <div className="nav-arrows">
        <button className="round-btn" disabled={!nav.canBack} onClick={nav.back} aria-label={t("Back")} title={t("Back")}>
          <BackIcon size={18} />
        </button>
        <button className="round-btn" disabled={!nav.canForward} onClick={nav.forward} aria-label={t("Forward")} title={t("Forward")}>
          <ForwardIcon size={18} />
        </button>
      </div>
      <Segmented
        className="topbar-tabs"
        label={t("Pages")}
        options={tabs()}
        value={page === "home" || page === "explore" ? page : null}
        onChange={(id) => nav.go({ page: id })}
      />
      <button className="round-btn topbar-search" onClick={onSearch} aria-label={t("Search")} title={t("Search (Ctrl K)")}>
        <SearchIcon size={18} />
      </button>
      <div className="topbar-end">
        <button className="topbar-hint" onClick={onSearch} tabIndex={-1}>
          Ctrl K
        </button>
        <button className={`avatar-btn ${menu ? "on" : ""}`} onClick={() => setMenu((m) => !m)} aria-label={t("Account")} aria-haspopup="menu" title={name}>
          <Avatar name={name} image={image} />
        </button>
        {menu && (
          <AvatarMenu
            name={name}
            image={image}
            onClose={() => setMenu(false)}
            onProfile={() => nav.go({ page: "user", uri: "me" })}
            onSettings={() => nav.go({ page: "settings" })}
            onShortcuts={onShortcuts}
            onLogout={onLogout}
          />
        )}
      </div>
    </header>
  );
}

function Avatar({ name, image, className = "" }: { name: string; image: string | null; className?: string }) {
  return image ? (
    <img className={`avatar ${className}`} src={image} alt="" />
  ) : (
    <span className={`avatar ${className}`}>{name.slice(0, 1).toUpperCase()}</span>
  );
}

/** Profile, Settings, the mini player, the cinema mode, the shortcuts and Log out. Esc or a click outside closes it. */
function AvatarMenu({
  name,
  image,
  onClose,
  onProfile,
  onSettings,
  onShortcuts,
  onLogout,
}: {
  name: string;
  image: string | null;
  onClose: () => void;
  onProfile: () => void;
  onSettings: () => void;
  onShortcuts: () => void;
  onLogout: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector<HTMLElement>("button")?.focus();
    const out = (e: MouseEvent) => {
      const t = e.target as Node;
      // The avatar button toggles the menu itself.
      if (!box.current?.contains(t) && !(t as HTMLElement).closest?.(".avatar-btn")) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        // Focus goes back to the avatar, not to the page.
        document.querySelector<HTMLElement>(".avatar-btn")?.focus();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const items = [...(box.current?.querySelectorAll<HTMLElement>("button") ?? [])];
        const at = items.indexOf(document.activeElement as HTMLElement);
        const next = e.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
        items[next]?.focus();
      }
    };
    window.addEventListener("mousedown", out);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", out);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  const pick = (f: () => void) => () => {
    onClose();
    f();
  };

  return (
    <div className="avatar-menu" role="menu" ref={box}>
      <button className="avatar-menu-head" role="menuitem" onClick={pick(onProfile)}>
        <Avatar name={name} image={image} className="big" />
        <span>
          <strong>{name}</strong>
          <span className="muted small">{t("Spotify Premium")}</span>
        </span>
      </button>
      <div className="menu-sep" />
      <button className="avatar-menu-item" role="menuitem" onClick={pick(onSettings)}>
        <SettingsIcon size={18} />
        <span>{t("Settings")}</span>
        <kbd>Ctrl P</kbd>
      </button>
      <button className="avatar-menu-item" role="menuitem" onClick={pick(toggleMini)}>
        <MiniPlayerIcon size={18} />
        <span>{t("Mini player")}</span>
        <kbd>Ctrl M</kbd>
      </button>
      <button className="avatar-menu-item" role="menuitem" onClick={pick(toggleCinema)}>
        <ExpandIcon size={18} />
        <span>{t("Cinema mode")}</span>
        <kbd>F11</kbd>
      </button>
      <button className="avatar-menu-item" role="menuitem" onClick={pick(onShortcuts)}>
        <KeyboardIcon size={18} />
        <span>{t("Keyboard shortcuts")}</span>
        <kbd>Ctrl /</kbd>
      </button>
      <div className="menu-sep" />
      <button className="avatar-menu-item danger" role="menuitem" onClick={pick(onLogout)}>
        <LogOutIcon size={18} />
        <span>{t("Log out")}</span>
      </button>
    </div>
  );
}
