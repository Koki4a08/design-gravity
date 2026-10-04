import { useEffect, useRef } from "react";
import type { RefObject } from "react";

interface Props {
  /** The element the contours surround (the prompt box). */
  anchor: RefObject<HTMLElement | null>;
  /** 0 idle, ~0.5 typing, 1 generating. Read every frame. */
  energy: RefObject<number>;
  /** Draw one frame and stop (setting off, or reduced motion). */
  still?: boolean;
}

const RINGS = 14;

/**
 * Hairline contours around the prompt, spaced wider as they move out, like
 * the isolines of a gravity well. A single pulse travels outward now and
 * then; typing sends pulses more often, generating keeps them coming.
 */
export function AmbientField({ anchor, energy, still = false }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = canvas.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const reduced = still || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    let raf = 0;
    let last = performance.now();
    let level = 0;
    let sinceWave = 0;
    const waves: number[] = []; // positions in ring units, travelling outward

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = cv.clientWidth;
      h = cv.clientHeight;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cv);

    const roundRect = (x: number, y: number, rw: number, rh: number, r: number) => {
      ctx.beginPath();
      ctx.roundRect(x, y, rw, rh, Math.min(r, rh / 2, rw / 2));
      ctx.stroke();
    };

    const frame = (now: number) => {
      const dt = Math.min(64, now - last) / 1000;
      last = now;
      level += ((energy.current ?? 0) - level) * Math.min(1, dt * 3);

      // Emit a wave: every ~7s idle, ~1.6s typing, ~0.9s generating.
      sinceWave += dt;
      const interval = 7 - level * 6.1;
      if (sinceWave > interval) {
        waves.push(0);
        sinceWave = 0;
      }
      const speed = 2.2 + level * 2.5; // rings per second
      for (let i = waves.length - 1; i >= 0; i--) {
        waves[i] += speed * dt;
        if (waves[i] > RINGS + 2) waves.splice(i, 1);
      }

      ctx.clearRect(0, 0, w, h);
      const box = anchor.current?.getBoundingClientRect();
      const host = cv.getBoundingClientRect();
      if (box) {
        const x0 = box.left - host.left;
        const y0 = box.top - host.top;
        ctx.lineWidth = 1;
        const ink = getComputedStyle(cv).getPropertyValue("--ink-rgb").trim().split(/\s+/).join(", ") || "236, 234, 242";
        for (let i = 1; i <= RINGS; i++) {
          // Spacing grows outward: tight near the brief, loose at the edge.
          const gap = 10 * i + 2.2 * i * i;
          const fade = 1 - i / (RINGS + 1);
          let alpha = 0.055 * fade;
          for (const wv of waves) {
            const d = Math.abs(wv - i);
            if (d < 1.2) alpha += (1 - d / 1.2) * 0.16 * fade;
          }
          ctx.strokeStyle = `rgba(${ink}, ${alpha.toFixed(3)})`;
          roundRect(x0 - gap, y0 - gap * 0.62, box.width + gap * 2, box.height + gap * 1.24, 16 + gap * 0.9);
        }
      }
      if (!reduced) raf = requestAnimationFrame(frame);
    };

    const onVis = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [anchor, energy, still]);

  return <canvas ref={canvas} className="ambient" aria-hidden />;
}
