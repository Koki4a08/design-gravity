import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { frameDoc } from "../../lib/project/frame";
import { overrideCss } from "../../lib/design/tokens";
import type { Artifact, FramePreset, TokenOverrides } from "../../lib/types";

interface Props {
  artifact: Artifact;
  frame: FramePreset;
  overrides: TokenOverrides;
  /** cover: fill width and crop from the top (thumbnails); contain: whole page. */
  fit: "cover" | "contain";
  interactive?: boolean;
  zoom?: number | null;
  title: string;
  marks?: boolean;
  /** attachments/... path -> data URL, so the sandbox can show attached images. */
  urls?: Record<string, string>;
  onScale?(scale: number): void;
}

/** A design rendered at its true frame size, scaled into its container. */
export const PageView = forwardRef<HTMLIFrameElement, Props>(function PageView(
  { artifact, frame, overrides, fit, interactive = false, zoom = null, title, marks = false, urls, onScale },
  ref,
) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const setRefs = (el: HTMLIFrameElement | null) => {
    frameRef.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) ref.current = el;
  };
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Thumbnails bake overrides into srcdoc. The live page keeps its document
  // and receives token edits over postMessage, so edits restyle in lockstep
  // without reloading the page.
  const latest = useRef(overrides);
  latest.current = overrides;
  const doc = useMemo(
    () => frameDoc(artifact, interactive ? latest.current : overrides, interactive, urls),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [artifact, interactive, urls, interactive ? null : overrides],
  );
  useEffect(() => {
    if (!interactive) return;
    frameRef.current?.contentWindow?.postMessage({ type: "dg-tokens", css: overrideCss(overrides) }, "*");
  }, [overrides, interactive]);

  const fitScale =
    size.w === 0
      ? 0
      : fit === "cover"
        ? size.w / frame.width
        : Math.min(size.w / frame.width, size.h / frame.height, 1);
  const scale = zoom ?? fitScale;

  useEffect(() => {
    if (fitScale) onScale?.(fitScale);
  }, [fitScale, onScale]);

  return (
    <div ref={box} className={`pageview pageview-${fit}`}>
      {scale > 0 && (
        <div
          className="pageview-sheet"
          style={{ width: frame.width * scale, height: frame.height * scale }}
          data-kind={artifact.file.endsWith(".svg") ? "graphic" : "screen"}
        >
          {marks && (
            <span className="crop-marks" aria-hidden>
              <i className="tl" /><i className="tr" /><i className="bl" /><i className="br" />
            </span>
          )}
          <iframe
            ref={setRefs}
            title={title}
            srcDoc={doc}
            sandbox={interactive ? "allow-scripts" : ""}
            tabIndex={interactive ? 0 : -1}
            aria-hidden={interactive ? undefined : true}
            style={{
              width: frame.width,
              height: frame.height,
              transform: `scale(${scale})`,
            }}
          />
        </div>
      )}
    </div>
  );
});
