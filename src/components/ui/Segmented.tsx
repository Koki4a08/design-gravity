import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export interface SegOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
  disabled?: boolean;
}

/** Hook: position of the selected child, so an indicator can glide to it. */
function useIndicator(count: number, index: number) {
  const host = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => {
      const item = el.querySelectorAll<HTMLElement>("[data-seg]")[index];
      if (item) setBox({ left: item.offsetLeft, width: item.offsetWidth });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [count, index]);
  return { host, box };
}

/** Segmented control with a thumb that slides between options. */
export function Segmented<T extends string>(p: {
  value: T;
  options: SegOption<NoInfer<T>>[];
  onChange(v: NoInfer<T>): void;
  label: string;
  size?: "sm" | "md";
}) {
  const index = Math.max(0, p.options.findIndex((o) => o.value === p.value));
  const { host, box } = useIndicator(p.options.length, index);
  return (
    <div ref={host} className={`seg seg-${p.size ?? "md"}`} role="group" aria-label={p.label}>
      {box && <span className="seg-thumb" style={{ transform: `translateX(${box.left}px)`, width: box.width }} aria-hidden />}
      {p.options.map((o) => (
        <button
          key={o.value}
          data-seg
          type="button"
          aria-pressed={o.value === p.value}
          title={o.title}
          disabled={o.disabled}
          onClick={() => p.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Tab list with an underline that glides to the active tab. */
export function Tabs<T extends string>(p: {
  value: T;
  tabs: { value: T; label: string; disabled?: boolean }[];
  onChange(v: NoInfer<T>): void;
  label: string;
  idPrefix: string;
}) {
  const index = Math.max(0, p.tabs.findIndex((t) => t.value === p.value));
  const { host, box } = useIndicator(p.tabs.length, index);
  const move = (dir: number) => {
    const enabled = p.tabs.filter((t) => !t.disabled);
    const i = enabled.findIndex((t) => t.value === p.value);
    const next = enabled[(i + dir + enabled.length) % enabled.length];
    p.onChange(next.value);
    requestAnimationFrame(() => document.getElementById(`${p.idPrefix}-${next.value}`)?.focus());
  };
  return (
    <div
      ref={host}
      className="tabs"
      role="tablist"
      aria-label={p.label}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") move(1);
        if (e.key === "ArrowLeft") move(-1);
      }}
    >
      {box && <span className="tabs-line" style={{ transform: `translateX(${box.left}px)`, width: box.width }} aria-hidden />}
      {p.tabs.map((t) => (
        <button
          key={t.value}
          data-seg
          role="tab"
          id={`${p.idPrefix}-${t.value}`}
          aria-selected={t.value === p.value}
          aria-controls={`${p.idPrefix}-panel`}
          tabIndex={t.value === p.value ? 0 : -1}
          className="tab"
          disabled={t.disabled}
          onClick={() => p.onChange(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
