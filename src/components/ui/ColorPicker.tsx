import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { layerFor } from "./Dropdown";

type HSV = { h: number; s: number; v: number };

function hexToHsv(hex: string): HSV {
  const n = hex.replace("#", "");
  const full = n.length === 3 ? n.split("").map((c) => c + c).join("") : n.padEnd(6, "0");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

function hsvToHex({ h, s, v }: HSV): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return "#" + [f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
}

function useDrag(onMove: (x: number, y: number) => void) {
  return (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const at = (ev: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      onMove(
        Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)),
        Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)),
      );
    };
    at(e);
    const move = (ev: PointerEvent) => at(ev);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };
}

/** Swatch that opens an in-app picker: saturation/value field plus hue strip. */
export function ColorPicker({ value, onChange, label }: { value: string; onChange(hex: string): void; label: string }) {
  const [open, setOpen] = useState(false);
  const [hsv, setHsv] = useState<HSV>(() => hexToHsv(value));
  const [pos, setPos] = useState<CSSProperties>({});
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) setHsv(hexToHsv(value));
  }, [value, open]);

  useLayoutEffect(() => {
    if (!open) return;
    const r = btn.current!.getBoundingClientRect();
    const h = 250;
    const top = r.bottom + h + 12 > window.innerHeight ? r.top - h - 8 : r.bottom + 8;
    setPos({ top, left: Math.max(12, Math.min(r.left, window.innerWidth - 252)) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const commit = (next: HSV) => {
    setHsv(next);
    onChange(hsvToHex(next));
  };
  const dragField = useDrag((x, y) => commit({ ...hsv, s: x, v: 1 - y }));
  const dragHue = useDrag((x) => commit({ ...hsv, h: x * 359.9 }));
  const hue = hsvToHex({ h: hsv.h, s: 1, v: 1 });

  return (
    <>
      <button
        ref={btn}
        type="button"
        className="swatch"
        style={{ background: value }}
        aria-label={`${label} colour, ${value}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      />
      {open && createPortal(
        <div ref={pop} className="cp" style={pos} role="dialog" aria-label={`${label} colour`}>
          <div
            className="cp-field"
            style={{ background: hue }}
            onPointerDown={dragField}
            role="slider"
            aria-label="Saturation and brightness"
            aria-valuetext={value}
            tabIndex={0}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 0.1 : 0.02;
              const m: Record<string, [number, number]> = {
                ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step],
              };
              const d = m[e.key];
              if (!d) return;
              e.preventDefault();
              commit({ ...hsv, s: Math.min(1, Math.max(0, hsv.s + d[0])), v: Math.min(1, Math.max(0, hsv.v + d[1])) });
            }}
          >
            <span className="cp-knob" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: value }} />
          </div>
          <div
            className="cp-hue"
            onPointerDown={dragHue}
            role="slider"
            aria-label="Hue"
            aria-valuemin={0}
            aria-valuemax={360}
            aria-valuenow={Math.round(hsv.h)}
            tabIndex={0}
            onKeyDown={(e) => {
              const d = e.key === "ArrowRight" ? 4 : e.key === "ArrowLeft" ? -4 : 0;
              if (!d) return;
              e.preventDefault();
              commit({ ...hsv, h: (hsv.h + d + 360) % 360 });
            }}
          >
            <span className="cp-knob cp-knob-hue" style={{ left: `${(hsv.h / 360) * 100}%`, background: hue }} />
          </div>
        </div>,
        layerFor(btn.current),
      )}
    </>
  );
}
