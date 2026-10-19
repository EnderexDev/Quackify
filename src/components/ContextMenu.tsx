// The right-click menu. `useContextMenu()` gives `open(event, items)`; one menu shows at a time.
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CheckIcon, ChevronRightIcon } from "./icons";

export type MenuItem =
  | "separator"
  | {
      label: string;
      onClick?: () => void;
      /** Opens a second menu on hover; may load its items. */
      submenu?: () => Promise<MenuItem[]> | MenuItem[];
      checked?: boolean;
      disabled?: boolean;
    };

type Open = (e: { clientX: number; clientY: number; preventDefault: () => void }, items: MenuItem[]) => void;

const MenuContext = createContext<Open>(() => {});
export const useContextMenu = () => useContext(MenuContext);

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);

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

  const open: Open = (e, items) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  return (
    <MenuContext.Provider value={open}>
      {children}
      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} onDone={() => setMenu(null)} />}
    </MenuContext.Provider>
  );
}

function Menu({ x, y, items, onDone }: { x: number; y: number; items: MenuItem[]; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [sub, setSub] = useState<{ index: number; items: MenuItem[] | null } | null>(null);

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)),
    });
  }, [x, y, items]);

  const openSub = async (index: number, load: () => Promise<MenuItem[]> | MenuItem[]) => {
    setSub({ index, items: null });
    try {
      const loaded = await load();
      setSub((s) => (s?.index === index ? { index, items: loaded } : s));
    } catch {
      setSub((s) => (s?.index === index ? { index, items: [{ label: "Could not load", disabled: true }] } : s));
    }
  };

  return (
    <div className="menu" ref={ref} style={pos} onMouseDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      {items.map((item, i) =>
        item === "separator" ? (
          <div key={i} className="menu-sep" />
        ) : (
          <div
            key={i}
            className={`menu-item ${item.disabled ? "disabled" : ""} ${sub?.index === i ? "open" : ""}`}
            onMouseEnter={() => (item.submenu ? openSub(i, item.submenu) : setSub(null))}
            onClick={() => {
              if (item.disabled || item.submenu) return;
              item.onClick?.();
              onDone();
            }}
          >
            <span className="menu-check">{item.checked && <CheckIcon size={14} />}</span>
            <span className="menu-label">{item.label}</span>
            {item.submenu && <ChevronRightIcon size={14} />}
            {sub?.index === i && (
              <SubMenu items={sub.items} onDone={onDone} />
            )}
          </div>
        ),
      )}
    </div>
  );
}

function SubMenu({ items, onDone }: { items: MenuItem[] | null; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [flip, setFlip] = useState(false);
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (r && r.right > window.innerWidth - 4) setFlip(true);
  }, [items]);
  return (
    <div className={`menu submenu ${flip ? "flip" : ""}`} ref={ref} onClick={(e) => e.stopPropagation()}>
      {items === null && <div className="menu-item disabled">Loading…</div>}
      {items?.length === 0 && <div className="menu-item disabled">Nothing here</div>}
      {items?.map((item, i) =>
        item === "separator" ? (
          <div key={i} className="menu-sep" />
        ) : (
          <div
            key={i}
            className={`menu-item ${item.disabled ? "disabled" : ""}`}
            onClick={() => {
              if (item.disabled) return;
              item.onClick?.();
              onDone();
            }}
          >
            <span className="menu-check">{item.checked && <CheckIcon size={14} />}</span>
            <span className="menu-label">{item.label}</span>
          </div>
        ),
      )}
    </div>
  );
}
