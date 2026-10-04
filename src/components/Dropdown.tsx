import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export interface Option<T extends string> {
  value: T;
  label: string;
  hint?: string;
  style?: CSSProperties;
}

interface Props<T extends string> {
  value: T;
  options: Option<NoInfer<T>>[];
  onChange(value: NoInfer<T>): void;
  label: string;
  /** field: bordered, full width. quiet: borderless, sits in toolbars. */
  variant?: "field" | "quiet";
  icon?: ReactNode;
  disabled?: boolean;
  id?: string;
  menuWidth?: number;
  title?: string;
  /** Extra classes on the trigger button. */
  triggerClass?: string;
  /** Show only the chevron (e.g. the menu half of a split button). */
  bare?: boolean;
}

/** A listbox dropdown drawn in the app's own language instead of the OS select. */
export function Dropdown<T extends string>(p: Props<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<CSSProperties>({});
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const uid = useId();
  const listId = `${uid}-list`;
  const selectedIndex = Math.max(0, p.options.findIndex((o) => o.value === p.value));
  const selected = p.options[selectedIndex];

  const place = useCallback(() => {
    const r = trigger.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.max(r.width, p.menuWidth ?? 0);
    const room = window.innerHeight - r.bottom;
    const want = Math.min(320, p.options.length * 36 + 12);
    const up = room < want + 16 && r.top > room;
    const left = Math.min(r.left, window.innerWidth - width - 12);
    setPos(
      up
        ? { left, width, bottom: window.innerHeight - r.top + 6, maxHeight: Math.min(320, r.top - 16) }
        : { left, width, top: r.bottom + 6, maxHeight: Math.min(320, room - 16) },
    );
  }, [p.menuWidth, p.options.length]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    setActive(selectedIndex);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!list.current?.contains(t) && !trigger.current?.contains(t)) setOpen(false);
    };
    // Follow the trigger if something behind the menu scrolls.
    const onScroll = (e: Event) => {
      if (!list.current?.contains(e.target as Node)) place();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place, selectedIndex]);

  useEffect(() => {
    // Scroll only the menu itself; scrollIntoView would also move ancestors.
    const ul = list.current;
    const item = ul?.children[active] as HTMLElement | undefined;
    if (!open || !ul || !item) return;
    if (item.offsetTop < ul.scrollTop) ul.scrollTop = item.offsetTop - 5;
    else if (item.offsetTop + item.offsetHeight > ul.scrollTop + ul.clientHeight)
      ul.scrollTop = item.offsetTop + item.offsetHeight - ul.clientHeight + 5;
  }, [active, open]);

  const choose = (i: number) => {
    const o = p.options[i];
    if (o) p.onChange(o.value);
    setOpen(false);
    trigger.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(p.options.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(p.options.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(active);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div className={`dd dd-${p.variant ?? "field"}`}>
      <button
        ref={trigger}
        id={p.id}
        type="button"
        className={"dd-trigger" + (p.triggerClass ? " " + p.triggerClass : "")}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${p.label}: ${selected?.label ?? ""}`}
        aria-activedescendant={open ? `${uid}-${active}` : undefined}
        title={p.title}
        disabled={p.disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKey}
      >
        {!p.bare && p.icon}
        {!p.bare && <span className="dd-value" style={selected?.style}>{selected?.label}</span>}
        <ChevronDown className="dd-chevron" aria-hidden />
      </button>
      {open && createPortal(
        <ul ref={list} id={listId} role="listbox" aria-label={p.label} className="dd-menu" style={pos}>
          {p.options.map((o, i) => (
            <li
              key={o.value}
              id={`${uid}-${i}`}
              role="option"
              aria-selected={o.value === p.value}
              className={"dd-option" + (i === active ? " is-active" : "")}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(i)}
            >
              <span className="dd-label" style={o.style}>{o.label}</span>
              {o.hint && <span className="dd-hint">{o.hint}</span>}
              <Check className="dd-check" aria-hidden />
            </li>
          ))}
        </ul>,
        layerFor(trigger.current),
      )}
    </div>
  );
}

/** Menus render in the top layer of their context: inside an open modal
 * dialog (anything outside it is inert), otherwise at the end of <body>. */
export function layerFor(el: Element | null): Element {
  return el?.closest("dialog[open]") ?? document.body;
}
