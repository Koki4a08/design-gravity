import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { KINDS, kindOf } from "../../lib/design/prompts";
import type { DesignKind, FramePreset } from "../../lib/types";
import { KindArt, KindIcon } from "../ui/KindIcon";
import { layerFor } from "../ui/Dropdown";

const CUSTOM = "Custom";

/**
 * Picks what to make and at what size: one button ("Screen · Desktop") that
 * opens a board of illustrated kinds with the chosen kind's sizes beneath.
 */
export function TypePicker({ value, onChange, frame, onFrame }: {
  value: DesignKind;
  onChange(k: DesignKind): void;
  frame: FramePreset;
  onFrame(frame: FramePreset): void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<CSSProperties>({});
  const trigger = useRef<HTMLButtonElement>(null);
  const board = useRef<HTMLDivElement>(null);
  const current = kindOf(value);

  useLayoutEffect(() => {
    if (!open) return;
    const r = trigger.current!.getBoundingClientRect();
    setPos({ top: r.bottom + 8, left: Math.max(12, Math.min(r.left, window.innerWidth - 560)) });
    const i = KINDS.findIndex((k) => k.id === value);
    setActive(i);
    requestAnimationFrame(() => board.current?.querySelectorAll<HTMLButtonElement>("[role=option]")[i]?.focus());
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!board.current?.contains(t) && !trigger.current?.contains(t)) setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const choose = (k: DesignKind) => {
    onChange(k);
    setGroup(null);
  };
  const chooseFrame = (f: FramePreset) => {
    onFrame(f);
    setOpen(false);
    trigger.current?.focus();
  };

  // Sizes come in groups (Desktop, Phone, Social…); the tab follows the current size.
  const groups = [...new Set(current.frames.map((f) => f.group ?? "Sizes"))];
  const home = frame.group === CUSTOM || frame.id.startsWith("custom-") ? CUSTOM : groups.find((g) => g === frame.group) ?? groups[0];
  const [group, setGroup] = useState<string | null>(null);
  const tab = group && (groups.includes(group) || group === CUSTOM) ? group : home;
  const [w, setW] = useState(String(frame.width));
  const [h, setH] = useState(String(frame.height));
  useEffect(() => {
    if (!open) return;
    setGroup(null);
    setW(String(frame.width));
    setH(String(frame.height));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onKey = (e: React.KeyboardEvent) => {
    const move = (d: number) => {
      e.preventDefault();
      const next = (active + d + KINDS.length) % KINDS.length;
      setActive(next);
      board.current?.querySelectorAll<HTMLButtonElement>("[role=option]")[next]?.focus();
    };
    if (e.key === "ArrowRight" || e.key === "ArrowDown") move(1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") move(-1);
    else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    }
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="dd-trigger type-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Design type and size: ${current.label}, ${frame.label}`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <KindIcon kind={value} />
        <span className="dd-value">
          {current.label}
          <span className="type-frame"> · {frame.id.startsWith("custom-") ? `${frame.width}×${frame.height}` : frame.label}</span>
        </span>
        <ChevronDown className="dd-chevron" aria-hidden />
      </button>
      {open &&
        createPortal(
          <div ref={board} className="type-board" role="dialog" aria-label="Design type and size" style={pos}
            onKeyDown={onKey}
            onBlur={(e) => {
              // Tab moves from the kinds to the sizes; leaving the board closes it.
              const to = e.relatedTarget as Node | null;
              if (to && !board.current?.contains(to) && !trigger.current?.contains(to)) setOpen(false);
            }}
          >
            <div className="type-kinds" role="listbox" aria-label="Design type">
            {KINDS.map((k, i) => (
              <button
                key={k.id}
                type="button"
                role="option"
                aria-selected={k.id === value}
                tabIndex={i === active ? 0 : -1}
                className="type-card"
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(k.id)}
              >
                <span className="type-art">
                  <KindArt kind={k.id} />
                </span>
                <span className="type-name">{k.label}</span>
                <span className="type-desc">{k.description}</span>
              </button>
            ))}
            </div>
            <div className="type-frames" role="group" aria-label={`${current.label} size`}>
              <div className="type-groups" role="tablist" aria-label="Size groups">
                <span className="type-frames-title">Size</span>
                {[...groups, CUSTOM].map((g) => (
                  <button
                    key={g}
                    type="button"
                    role="tab"
                    aria-selected={g === tab}
                    className="type-group"
                    onClick={() => setGroup(g)}
                  >
                    {g}
                  </button>
                ))}
              </div>
              {tab === CUSTOM ? (
                <form
                  className="type-custom"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const width = Math.round(Number(w));
                    const height = Math.round(Number(h));
                    if (!(width >= 100 && width <= 8000 && height >= 100 && height <= 8000)) return;
                    chooseFrame({ id: `custom-${width}x${height}`, label: "Custom", width, height, group: CUSTOM });
                  }}
                >
                  <label>
                    <span className="visually-hidden">Width</span>
                    <input type="number" min={100} max={8000} value={w} onChange={(e) => setW(e.target.value)} placeholder="Width" />
                  </label>
                  <span aria-hidden>×</span>
                  <label>
                    <span className="visually-hidden">Height</span>
                    <input type="number" min={100} max={8000} value={h} onChange={(e) => setH(e.target.value)} placeholder="Height" />
                  </label>
                  <span className="type-custom-unit">px</span>
                  <button type="submit" className="btn btn-sm">Use this size</button>
                </form>
              ) : (
                <div className="type-sizes" role="tabpanel">
                  {current.frames
                    .filter((f) => (f.group ?? "Sizes") === tab)
                    .map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        className="type-size"
                        aria-pressed={f.id === frame.id}
                        onClick={() => chooseFrame(f)}
                      >
                        {f.label}
                        <span>{f.width}×{f.height}</span>
                      </button>
                    ))}
                </div>
              )}
            </div>
          </div>,
          layerFor(trigger.current),
        )}
    </>
  );
}
