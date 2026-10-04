import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import { useSystems } from "../../lib/state/systemsStore";
import { layerFor } from "../ui/Dropdown";

export function Swatches({ colors, size = "sm" }: { colors?: string[]; size?: "sm" | "md" }) {
  if (!colors?.length) return <span className={`swatches swatches-${size} is-empty`} aria-hidden />;
  return (
    <span className={`swatches swatches-${size}`} aria-hidden>
      {colors.slice(0, 5).map((c, i) => (
        <i key={i} style={{ background: c }} />
      ))}
    </span>
  );
}

/** Choose the design system new designs follow; "+" starts the builder. */
export function SystemPicker({ value, onChange, onCreate, onEdit }: {
  value: string;
  onChange(id: string): void;
  onCreate(): void;
  onEdit(id: string): void;
}) {
  const sys = useSystems();
  const saved = sys.systems.filter((m) => m.saved);
  const current = saved.find((m) => m.id === value);
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const [pos, setPos] = useState<CSSProperties>({});
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  // A deleted system can't stay selected.
  useEffect(() => {
    if (value && sys.systems.length && !current) onChange("");
  }, [value, current, sys.systems.length, onChange]);

  useLayoutEffect(() => {
    if (!open) return;
    const r = trigger.current!.getBoundingClientRect();
    setPos({ top: r.bottom + 8, left: Math.max(12, Math.min(r.left, window.innerWidth - 352)) });
    setArmed(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !trigger.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="dd-trigger system-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Design system: ${current?.name ?? "none"}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Swatches colors={current?.swatches} />
        <span className="dd-value">{current?.name ?? "No system"}</span>
        <ChevronDown className="dd-chevron" aria-hidden />
      </button>
      {open &&
        createPortal(
          <div ref={panel} className="system-panel" role="dialog" aria-label="Design systems" style={pos}>
            <div className="system-panel-head">
              <span>Design systems</span>
              <button
                className="icon-btn system-add"
                onClick={() => {
                  setOpen(false);
                  onCreate();
                }}
                aria-label="Create a design system"
                title="Create a design system"
              >
                <Plus aria-hidden />
              </button>
            </div>
            <div className="system-list" role="listbox" aria-label="Design system">
              <button role="option" aria-selected={!value} className="system-row" onClick={() => pick("")}>
                <span className="swatches swatches-sm is-none" aria-hidden />
                <span className="system-row-text">
                  <span className="system-row-name">No system</span>
                  <span className="system-row-sub">The agent picks the style</span>
                </span>
                {!value && <Check className="system-check" aria-hidden />}
              </button>
              {saved.map((m) => (
                <div key={m.id} className="system-row-wrap">
                  <button role="option" aria-selected={value === m.id} className="system-row" onClick={() => pick(m.id)}>
                    <Swatches colors={m.swatches} />
                    <span className="system-row-text">
                      <span className="system-row-name">{m.name}</span>
                      <span className="system-row-sub">{armed === m.id ? "Click delete again to remove it" : m.fonts || m.summary || "Custom system"}</span>
                    </span>
                    {value === m.id && <Check className="system-check" aria-hidden />}
                  </button>
                  <span className="system-row-actions">
                    <button
                      className="icon-btn"
                      aria-label={`Edit ${m.name}`}
                      title="Review and edit"
                      onClick={() => {
                        setOpen(false);
                        onEdit(m.id);
                      }}
                    >
                      <Pencil aria-hidden />
                    </button>
                    <button
                      className={"icon-btn" + (armed === m.id ? " is-armed" : "")}
                      aria-label={armed === m.id ? `Confirm delete ${m.name}` : `Delete ${m.name}`}
                      title={armed === m.id ? "Click again to delete" : "Delete"}
                      onClick={() => {
                        if (armed !== m.id) return setArmed(m.id);
                        if (value === m.id) onChange("");
                        sys.remove(m.id);
                      }}
                    >
                      <Trash2 aria-hidden />
                    </button>
                  </span>
                </div>
              ))}
              {saved.length === 0 && (
                <button
                  className="system-empty"
                  onClick={() => {
                    setOpen(false);
                    onCreate();
                  }}
                >
                  <Plus aria-hidden /> Create your first design system
                </button>
              )}
            </div>
          </div>,
          layerFor(trigger.current),
        )}
    </>
  );
}
