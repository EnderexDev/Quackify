// The right-click menu. `useContextMenu()` gives `open(event, items)`; one menu shows at a time.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { t } from "../i18n";
import { CheckIcon, ChevronRightIcon, PlayIcon, DiscIcon, EditIcon, HeartIcon, HeartOutlineIcon, MoreIcon, PlaylistAddIcon, PlusIcon, QueueIcon, RepeatIcon, UserIcon } from "./icons";

/** The icons a menu item can show on its left (Figma "menu da música"). */
const ICONS = {
  queue: QueueIcon,
  "playlist-add": PlaylistAddIcon,
  heart: HeartOutlineIcon,
  liked: HeartIcon,
  user: UserIcon,
  disc: DiscIcon,
  radio: RepeatIcon,
  more: MoreIcon,
  plus: PlusIcon,
  edit: EditIcon,
  play: PlayIcon,
};

export type MenuItem =
  | "separator"
  | {
      label: string;
      /** A name that does not change with the language, for code that looks an item up. */
      id?: string;
      onClick?: () => void;
      /** Opens a second menu on hover; may load its items. */
      submenu?: () => Promise<MenuItem[]> | MenuItem[];
      /** Items shown at the top of the submenu at once, before the loaded ones arrive. */
      submenuHead?: MenuItem[];
      checked?: boolean;
      disabled?: boolean;
      icon?: keyof typeof ICONS;
      /** Small grey text at the right, such as a shortcut. */
      hint?: string;
      /** Red, for what removes something. */
      danger?: boolean;
    };

/** The left slot: the check when the item has one, otherwise its icon. */
function ItemStart({ item }: { item: Exclude<MenuItem, "separator"> }) {
  const Icon = item.icon && ICONS[item.icon];
  return (
    <span className={`menu-check ${item.checked ? "on" : ""}`}>
      {item.checked ? <CheckIcon size={14} /> : Icon && <Icon size={16} />}
    </span>
  );
}

type Open = (e: { clientX: number; clientY: number; preventDefault: () => void }, items: MenuItem[]) => void;

const MenuContext = createContext<Open>(() => {});
export const useContextMenu = () => useContext(MenuContext);

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[]; id: number } | null>(null);
  // A new id per opening: a menu opened over another (a card waits for Spotify before opening its
  // own) mounts fresh, without the old one's submenu.
  const opened = useRef(0);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  // The same function every render, so opening a menu does not re-render everything that can open one.
  const open: Open = useCallback((e, items) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, items, id: ++opened.current });
  }, []);

  return (
    <MenuContext.Provider value={open}>
      {children}
      {menu && <Menu key={menu.id} x={menu.x} y={menu.y} items={menu.items} onDone={() => setMenu(null)} />}
    </MenuContext.Provider>
  );
}

function Menu({ x, y, items, onDone }: { x: number; y: number; items: MenuItem[]; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [sub, setSub] = useState<{ index: number; items: MenuItem[] | null; head: MenuItem[] } | null>(null);

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)),
    });
  }, [x, y, items]);

  // Each opening gets its own number: leaving a submenu and coming back starts a new load, and
  // only the latest one may fill it.
  const subRequest = useRef(0);
  const openSub = async (index: number, load: () => Promise<MenuItem[]> | MenuItem[], head: MenuItem[] = []) => {
    const request = ++subRequest.current;
    setSub({ index, items: null, head });
    let items: MenuItem[];
    try {
      items = await load();
    } catch {
      items = [{ label: t("Could not load"), disabled: true }];
    }
    if (request === subRequest.current) setSub((s) => (s?.index === index ? { ...s, items } : s));
  };

  return (
    <div className="menu" ref={ref} style={pos} onMouseDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      {items.map((item, i) =>
        item === "separator" ? (
          <div key={i} className="menu-sep" />
        ) : (
          <div
            key={i}
            className={`menu-item ${item.disabled ? "disabled" : ""} ${item.danger ? "danger" : ""} ${sub?.index === i ? "open" : ""}`}
            onMouseEnter={() => (item.submenu ? sub?.index !== i && openSub(i, item.submenu, item.submenuHead) : setSub(null))}
            onClick={() => {
              if (item.disabled || item.submenu) return;
              item.onClick?.();
              onDone();
            }}
          >
            <ItemStart item={item} />
            <span className="menu-label">{item.label}</span>
            {item.hint && <span className="menu-hint">{item.hint}</span>}
            {item.submenu && <ChevronRightIcon size={14} className="menu-chevron" />}
            {sub?.index === i && (
              <SubMenu head={sub.head} items={sub.items} onDone={onDone} />
            )}
          </div>
        ),
      )}
    </div>
  );
}

function SubMenu({ head, items, onDone }: { head: MenuItem[]; items: MenuItem[] | null; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [flip, setFlip] = useState(false);
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (r && r.right > window.innerWidth - 4) setFlip(true);
  }, [items]);
  return (
    <div className={`menu submenu ${flip ? "flip" : ""}`} ref={ref} onClick={(e) => e.stopPropagation()}>
      {items === null && head.length === 0 && <div className="menu-item disabled">{t("Loading…")}</div>}
      {items?.length === 0 && head.length === 0 && <div className="menu-item disabled">{t("Nothing here")}</div>}
      {[...head, ...(items ?? [])].map((item, i) =>
        item === "separator" ? (
          <div key={i} className="menu-sep" />
        ) : (
          <div
            key={i}
            className={`menu-item ${item.disabled ? "disabled" : ""} ${item.danger ? "danger" : ""}`}
            onClick={() => {
              if (item.disabled) return;
              item.onClick?.();
              onDone();
            }}
          >
            <ItemStart item={item} />
            <span className="menu-label">{item.label}</span>
            {item.hint && <span className="menu-hint">{item.hint}</span>}
          </div>
        ),
      )}
    </div>
  );
}
