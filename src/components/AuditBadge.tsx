import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import { createPortal } from "react-dom";
import { Wand2 } from "lucide-react";
import { audit, fixNote, KIND_LABEL } from "../lib/audit";
import type { Issue, IssueKind } from "../lib/audit";
import { backend } from "../lib/backend";
import { parseSpec } from "../lib/systems";
import type { SystemSpec } from "../lib/systems";
import { useStudio } from "../lib/studio";
import type { Artifact, DesignMeta } from "../lib/types";
import { layerFor } from "./Dropdown";

/** The chosen system's parsed tokens, or null while loading / without one. */
export function useSystemSpec(systemId?: string): SystemSpec | null {
  const [spec, setSpec] = useState<SystemSpec | null>(null);
  useEffect(() => {
    let live = true;
    setSpec(null);
    if (systemId) backend.systemRead(systemId).then((f) => live && setSpec(parseSpec(f.spec))).catch(() => {});
    return () => {
      live = false;
    };
  }, [systemId]);
  return spec;
}

const ORDER: IssueKind[] = ["token", "colour", "font", "type", "space", "radius"];
const PER_GROUP = 6;

/**
 * Score for how faithfully the design follows its tokens (and system), with
 * the offending rules marked on the page and a one-click fix by the agent.
 */
export function AuditBadge({ design: d, artifact, frame }: {
  design: DesignMeta;
  artifact: Artifact;
  frame: RefObject<HTMLIFrameElement | null>;
}) {
  const s = useStudio();
  const spec = useSystemSpec(d.systemId);
  const result = useMemo(() => audit(artifact.content, spec), [artifact.content, spec]);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties>({});
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const busy = d.status === "generating";
  const tone = result.score >= 95 ? "ok" : result.score >= 80 ? "warn" : "bad";
  const label = d.systemId ? "On-system" : "On-token";

  const flag = (items: { selector: string; tone?: string }[], scroll = false) =>
    frame.current?.contentWindow?.postMessage({ type: "dg-flag", items, scroll }, "*");
  const flagAll = () => flag(result.issues.filter((i) => i.kind !== "token").map((i) => ({ selector: i.selector })));

  useLayoutEffect(() => {
    if (!open) return;
    const r = btn.current!.getBoundingClientRect();
    setPos({ bottom: window.innerHeight - r.top + 10, left: Math.max(12, r.left + r.width / 2 - 180) });
  }, [open]);

  // Mark every offending element while the list is open.
  useEffect(() => {
    if (!open) return;
    flagAll();
    return () => flag([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, result]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      btn.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const groups = ORDER.map((k) => [k, result.issues.filter((i) => i.kind === k)] as [IssueKind, Issue[]]).filter(([, l]) => l.length);

  const fix = () => {
    setOpen(false);
    const n = result.issues.length;
    s.revise(d.id, `Bring the design back on-system (${n} ${n === 1 ? "issue" : "issues"})`, undefined, undefined, fixNote(result));
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        className="audit-badge"
        data-tone={tone}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title={`${label}: ${result.score}% of checked styles follow the tokens`}
      >
        <span className="audit-dot" aria-hidden />
        <span className="audit-label">{label}</span> <b>{result.score}%</b>
      </button>
      {open &&
        createPortal(
          <div ref={pop} className="audit-pop" role="dialog" aria-label={`${label} audit`} style={pos}>
            <div className="audit-head">
              <span className="audit-score" data-tone={tone}>{result.score}%</span>
              <p className="audit-sum">
                {result.issues.length
                  ? `${result.issues.length} of ${result.checked} checked styles bypass the ${d.systemId ? "design system" : "tokens"}.`
                  : `All ${result.checked} checked styles run through the ${d.systemId ? "design system" : "tokens"}.`}
              </p>
            </div>
            {groups.length > 0 && (
              <div className="audit-list" onMouseLeave={flagAll}>
                {groups.map(([kind, list]) => (
                  <section key={kind} className="audit-group">
                    <h4>
                      {KIND_LABEL[kind]} <span>{list.length}</span>
                    </h4>
                    <ul>
                      {list.slice(0, PER_GROUP).map((i, n) => (
                        <li key={n}>
                          <button
                            type="button"
                            className="audit-item"
                            disabled={kind === "token"}
                            onMouseEnter={() => kind !== "token" && flag([{ selector: i.selector, tone: "focus" }], true)}
                            onFocus={() => kind !== "token" && flag([{ selector: i.selector, tone: "focus" }], true)}
                          >
                            <code>{kind === "token" ? i.property : i.selector}</code>
                            <span>
                              {kind === "token" ? `${i.value} → ${i.expected}` : `${i.property}: ${i.value}`}
                            </span>
                          </button>
                        </li>
                      ))}
                      {list.length > PER_GROUP && <li className="audit-more">+{list.length - PER_GROUP} more</li>}
                    </ul>
                  </section>
                ))}
              </div>
            )}
            {result.issues.length > 0 && (
              <div className="audit-foot">
                <button className="btn btn-primary btn-sm" onClick={fix} disabled={busy}>
                  <Wand2 aria-hidden /> Fix with the agent
                </button>
              </div>
            )}
          </div>,
          layerFor(btn.current),
        )}
    </>
  );
}
