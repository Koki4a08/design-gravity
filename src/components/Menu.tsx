import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import { layerFor } from "./Dropdown";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect(): void;
  danger?: boolean;
  /** Ask for a second click before running (destructive actions). */
  confirm?: string;
  disabled?: boolean;
}

/** Icon button that opens a small action menu. */
export function Menu({ icon, label, items }: { icon: ReactNode; label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState<number | null>(null);
  const [pos, setPos] = useState<CSSProperties>({});
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const r = btn.current!.getBoundingClientRect();
    setPos({ top: r.bottom + 6, right: Math.max(12, window.innerWidth - r.right) });
    setArmed(null);
    requestAnimationFrame(() => menu.current?.querySelector<HTMLButtonElement>("button")?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        btn.current?.focus();
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const all = [...(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
        const i = all.indexOf(document.activeElement as HTMLButtonElement);
        all[(i + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length]?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        className="icon-btn island-btn"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
      </button>
      {open &&
        createPortal(
          <div ref={menu} className="menu" role="menu" aria-label={label} style={pos}>
            {items.map((it, i) => (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                className={"menu-item" + (it.danger ? " is-danger" : "") + (armed === i ? " is-armed" : "")}
                disabled={it.disabled}
                onClick={() => {
                  if (it.confirm && armed !== i) {
                    setArmed(i);
                    return;
                  }
                  setOpen(false);
                  it.onSelect();
                }}
              >
                {it.icon}
                <span>{armed === i ? it.confirm : it.label}</span>
              </button>
            ))}
          </div>,
          layerFor(btn.current),
        )}
    </>
  );
}
