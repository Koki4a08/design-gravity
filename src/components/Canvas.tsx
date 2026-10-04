import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { Plus, RotateCcw } from "lucide-react";
import { frameDoc } from "../lib/frame";
import { overrideCss } from "../lib/tokens";
import { siblingName, useStudio, variantLetter } from "../lib/studio";
import type { Artifact, DesignMeta } from "../lib/types";
import { clock, useElapsed } from "./Progress";

const GAP = 160;
const PAD = 72;
const TOP = 100;
/** Screen width kept for the "+ Variant" button after the last frame. */
const ADD_W = 130;
const MAX_H = 12000;
const MIN_Z = 0.04;
const MAX_Z = 4;

interface View {
  x: number;
  y: number;
  z: number;
}

/** A zoom request from the toolbar; `tick` makes repeated clicks count. */
export interface CanvasCommand {
  kind: "fit" | "actual";
  tick: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const contentKey = (a?: Artifact) => (a ? `${a.modifiedMs}:${a.content.length}` : "");
const frameName = (x: DesignMeta) => (x.group?.kind === "flow" ? String((x.group.index ?? 0) + 1) : variantLetter(x.group?.index ?? 0));

/**
 * A project's frames side by side on one pannable, zoomable canvas, like
 * frames on a Figma page. Clicking a frame selects it; the side panel, the
 * tools and the agent then work on that frame.
 */
export function Canvas({ design: d, shown, frameRef, marking, command, onAddScreen }: {
  design: DesignMeta;
  /** What the selected frame shows (an older version while previewing one). */
  shown?: Artifact;
  frameRef: RefObject<HTMLIFrameElement | null>;
  marking: boolean;
  command: CanvasCommand;
  onAddScreen(): void;
}) {
  const s = useStudio();
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: TOP, z: 0.3 });
  const [heights, setHeights] = useState<Record<string, { h: number; key: string }>>({});
  const wins = useRef(new Map<string, HTMLIFrameElement | null>());
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  /** True while the view is the "fit all" view, so a window resize refits it. */
  const fitted = useRef(false);

  const group = d.group!;
  const frames = useMemo(
    () => s.designs.filter((x) => x.group?.id === group.id).sort((a, b) => a.group!.index - b.group!.index),
    [s.designs, group.id],
  );

  const artifactOf = (x: DesignMeta) => (x.id === d.id && shown ? shown : s.artifacts[x.id]);
  const heightOf = (x: DesignMeta) => {
    const m = heights[x.id];
    return m && m.key === contentKey(artifactOf(x)) ? m.h : x.frame.height;
  };

  // World layout: frames in a row, top-aligned.
  const layout = useMemo(() => {
    let left = 0;
    return frames.map((x) => {
      const pos = { x: left, w: x.frame.width, h: heightOf(x) };
      left += x.frame.width + GAP;
      return pos;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frames, heights, shown, s.artifacts]);
  const worldW = layout.length ? layout[layout.length - 1].x + layout[layout.length - 1].w : 0;
  const nominalH = Math.max(...frames.map((x) => x.frame.height), 1);

  /** The part of the canvas not covered by the side panel. */
  const rect = () => {
    const r = box.current?.getBoundingClientRect() ?? new DOMRect(0, 0, 1200, 800);
    const side = document.querySelector(".island-side")?.getBoundingClientRect();
    return side && side.left > r.left ? new DOMRect(r.left, r.top, side.left - r.left, r.height) : r;
  };

  const fitAll = useCallback(() => {
    const r = rect();
    // Everything in view: the frames plus the add button after them.
    const span = worldW + GAP / 2;
    const z = clamp(Math.min((r.width - PAD * 2 - ADD_W) / span, (r.height - TOP - PAD) / nominalH), MIN_Z, 1);
    setView({ z, x: (r.width - (span * z + ADD_W)) / 2, y: TOP });
    fitted.current = true;
  }, [worldW, nominalH]);

  const focusFrame = useCallback(
    (i: number, z?: number) => {
      const r = rect();
      const f = layout[i];
      if (!f) return;
      const zz = z ?? clamp(Math.min((r.width - PAD * 2) / f.w, (r.height - TOP - PAD) / frames[i].frame.height), MIN_Z, 2);
      setView({ z: zz, x: r.width / 2 - (f.x + f.w / 2) * zz, y: TOP });
      fitted.current = false;
    },
    [layout, frames],
  );

  // Fit when the canvas opens and whenever a frame is added or removed.
  useLayoutEffect(() => {
    fitAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frames.length]);

  // Keep the fit view fitted while the window (and so the side panel) resizes.
  const refit = useRef(fitAll);
  refit.current = fitAll;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => fitted.current && refit.current());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const selectedIndex = frames.findIndex((x) => x.id === d.id);
  useEffect(() => {
    if (!command.tick) return;
    if (command.kind === "fit") fitAll();
    else focusFrame(selectedIndex, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command.tick]);

  // Figma's shortcuts: Shift+1 fits everything, Shift+0 is 100%, Shift+2 the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.shiftKey || (e.target as HTMLElement)?.closest?.("input, textarea, [contenteditable]")) return;
      if (e.code === "Digit1") fitAll();
      else if (e.code === "Digit0") focusFrame(selectedIndex, 1);
      else if (e.code === "Digit2") focusFrame(selectedIndex);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fitAll, focusFrame, selectedIndex]);

  // Wheel pans; Ctrl/⌘ + wheel (and trackpad pinch) zooms around the pointer.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      fitted.current = false;
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        const cx = e.clientX - r.left;
        const cy = e.clientY - r.top;
        setView((v) => {
          const z = clamp(v.z * Math.exp(-e.deltaY * 0.0022), MIN_Z, MAX_Z);
          const k = z / v.z;
          return { z, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
        });
      } else {
        const dx = e.shiftKey ? e.deltaY : e.deltaX;
        const dy = e.shiftKey ? 0 : e.deltaY;
        setView((v) => ({ ...v, x: v.x - dx, y: v.y - dy }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Each frame reports its page height; trust only reports taken at the nominal viewport.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type !== "dg-size") return;
      for (const x of frames) {
        if (wins.current.get(x.id)?.contentWindow !== e.source) continue;
        if (Math.abs((e.data.vh ?? 0) - x.frame.height) > 1) return;
        const h = clamp(Math.round(e.data.h), x.frame.height, MAX_H);
        const key = contentKey(artifactOf(x));
        setHeights((all) => (all[x.id]?.h === h && all[x.id]?.key === key ? all : { ...all, [x.id]: { h, key } }));
        return;
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frames, shown, s.artifacts]);

  const onPointerDown = (e: React.PointerEvent) => {
    const onFrame = (e.target as HTMLElement).closest(".cframe, .canvas-add");
    if (e.button === 1 || (e.button === 0 && !onFrame)) {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const g = drag.current;
    if (!g) return;
    fitted.current = false;
    setView((v) => ({ ...v, x: g.vx + e.clientX - g.x, y: g.vy + e.clientY - g.y }));
  };
  const endDrag = () => (drag.current = null);

  const flow = group.kind === "flow";
  const last = layout[layout.length - 1];

  return (
    <div
      ref={box}
      className="canvas"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div
        className="canvas-world"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`, ["--z" as string]: view.z }}
      >
        {frames.map((x, i) => (
          <CanvasFrame
            key={x.id}
            design={x}
            artifact={artifactOf(x)}
            pos={layout[i]}
            selected={x.id === d.id}
            marking={marking}
            register={(el) => {
              wins.current.set(x.id, el);
              if (x.id === d.id) frameRef.current = el;
            }}
            onSelect={() => x.id !== d.id && s.open(x.id)}
            onFocus={() => focusFrame(i)}
          />
        ))}
        {last && (
          <button
            type="button"
            className="canvas-add"
            style={{ left: last.x + last.w + GAP / 2 }}
            onClick={() => (flow ? onAddScreen() : s.addVariant(d.id))}
          >
            <span className="canvas-add-label">
              <Plus aria-hidden /> {flow ? "Next screen" : "Variant"}
            </span>
          </button>
        )}
      </div>
      <span className="canvas-zoom" aria-hidden>{Math.round(view.z * 100)}%</span>
    </div>
  );
}

function CanvasFrame({ design: x, artifact, pos, selected, marking, register, onSelect, onFocus }: {
  design: DesignMeta;
  artifact?: Artifact;
  pos: { x: number; w: number; h: number };
  selected: boolean;
  marking: boolean;
  register(el: HTMLIFrameElement | null): void;
  onSelect(): void;
  onFocus(): void;
}) {
  const s = useStudio();
  const urls = s.attachmentUrls[x.id];
  const busy = x.status === "generating";

  // Token edits reach the page over postMessage, so editing never reloads it.
  const latest = useRef(x.overrides);
  latest.current = x.overrides;
  const doc = useMemo(
    () => (artifact ? frameDoc(artifact, latest.current, true, urls) : ""),
    [artifact, urls],
  );
  const iframe = useRef<HTMLIFrameElement | null>(null);
  useEffect(() => {
    iframe.current?.contentWindow?.postMessage({ type: "dg-tokens", css: overrideCss(x.overrides) }, "*");
  }, [x.overrides]);

  return (
    <div
      className={"cframe" + (selected ? " is-selected" : "")}
      data-kind={artifact?.file.endsWith(".svg") ? "graphic" : "screen"}
      style={{ left: pos.x, width: pos.w, height: pos.h }}
    >
      <div className="cframe-label" onClick={onSelect}>
        <b>{x.group?.kind === "flow" ? `Screen ${frameName(x)}` : frameName(x)}</b>
        <span>{x.group?.kind === "flow" ? x.title : x.frame.label}</span>
        {busy && <i className="cframe-busy" aria-label="Working" />}
      </div>

      {artifact ? (
        <iframe
          ref={(el) => {
            iframe.current = el;
            register(el);
          }}
          title={`${siblingName(x)}: ${x.title}`}
          srcDoc={doc}
          sandbox="allow-scripts"
          tabIndex={selected ? 0 : -1}
          style={{ width: pos.w, height: pos.h }}
        />
      ) : busy ? (
        <FrameWorking design={x} />
      ) : (
        <div className="cframe-empty">
          <div className="cframe-center">
            <p>{x.status === "failed" ? "Nothing came back." : "Stopped."}</p>
            <button className="btn btn-primary btn-sm" onClick={() => s.retry(x.id)}>
              <RotateCcw aria-hidden /> Try again
            </button>
          </div>
        </div>
      )}

      {artifact && busy && <FrameRevising design={x} />}

      {/* Clicks select the frame; the page itself only takes clicks while pointing at an element. */}
      {!(selected && marking) && !(!artifact && !busy) && (
        <div className="cframe-hit" onClick={onSelect} onDoubleClick={onFocus} aria-hidden />
      )}
    </div>
  );
}

const turnStart = (x: DesignMeta) => [...x.entries].reverse().find((e) => e.role !== "system")?.at ?? x.updatedAt;

function FrameWorking({ design: x }: { design: DesignMeta }) {
  const elapsed = useElapsed(turnStart(x));
  return (
    <div className="cframe-empty" role="status">
      <div className="cframe-center">
        <span className="build-spin" aria-hidden />
        <p>Designing</p>
        <span className="cframe-clock">{clock(elapsed)}</span>
      </div>
    </div>
  );
}

function FrameRevising({ design: x }: { design: DesignMeta }) {
  const elapsed = useElapsed(turnStart(x));
  return (
    <div className="cframe-revising" role="status">
      <span className="build-spin" aria-hidden />
      Revising <span className="cframe-clock">{clock(elapsed)}</span>
    </div>
  );
}
