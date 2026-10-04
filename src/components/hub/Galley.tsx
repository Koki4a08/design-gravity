import { useEffect, useRef } from "react";
import type { LogLine } from "../../lib/types";

/** Merge consecutive steps with the same verb so the log reads as progress. */
function collapse(lines: LogLine[]): (LogLine & { times: number })[] {
  const out: (LogLine & { times: number })[] = [];
  for (const l of lines) {
    const prev = out[out.length - 1];
    if (prev && l.kind === "tool" && prev.kind === "tool" && prev.verb === l.verb) {
      out[out.length - 1] = { ...l, key: prev.key, times: prev.times + 1 };
    } else out.push({ ...l, times: 1 });
  }
  return out;
}

/** The agent's progress as a short list of steps. */
export function Galley({ lines }: { lines: LogLine[] }) {
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    // Scroll only the list itself, never its ancestors.
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const shown = collapse(lines.filter((l) => l.kind !== "say"));
  return (
    <ol ref={list} className="galley" aria-live="polite">
      {shown.length === 0 && (
        <li className="galley-line" data-state="active">
          <span className="galley-verb">Reading your brief</span>
        </li>
      )}
      {shown.map((l) => (
        <li key={l.key} className="galley-line" data-state={l.state}>
          <span className="galley-verb">{l.verb}</span>
          {l.times > 1 && <span className="galley-times">{l.times}×</span>}
        </li>
      ))}
    </ol>
  );
}

/** Card overlay while a design is being made or revised: one steady label, one bar. */
export function CardProgress({ revising }: { lines: LogLine[]; revising: boolean }) {
  return (
    <span className={"card-progress" + (revising ? " is-revising" : "")} role="status">
      <span className="card-progress-text">{revising ? "Revising…" : "Designing…"}</span>
      <span className="card-progress-bar" aria-hidden />
    </span>
  );
}
