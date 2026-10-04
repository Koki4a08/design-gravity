import { Check, X } from "lucide-react";
import { useStudio } from "../lib/studio";
import type { DesignMeta } from "../lib/types";

/** Mark an element on the live page (null clears); Spread relays it into the frame. */
export const flagOnPage = (selector: string | null) =>
  window.dispatchEvent(new CustomEvent("dg-flag", { detail: selector ? [{ selector, tone: "focus" }] : [] }));

/** The critic's notes, each pinned to an element: apply one, apply all, or let them go. */
export function Critique({ design: d }: { design: DesignMeta }) {
  const s = useStudio();
  const busy = d.status === "generating";

  if (s.critiquing.has(d.id)) {
    return (
      <div className="critique is-working" role="status">
        <span className="build-spin" aria-hidden />
        <span>Reviewing the design…</span>
      </div>
    );
  }
  const notes = d.critique ?? [];
  if (!notes.length) return null;

  return (
    <section className="critique" aria-label="Critique" onMouseLeave={() => flagOnPage(null)}>
      <header className="critique-head">
        <span className="critique-title">Critique</span>
        {d.critiqueSummary && <p className="critique-sum">{d.critiqueSummary}</p>}
      </header>
      <ul className="critique-list">
        {notes.map((n) => (
          <li
            key={n.id}
            className="crit"
            data-severity={n.severity}
            onMouseEnter={() => flagOnPage(n.selector)}
          >
            <span className="crit-dot" aria-label={`${n.severity} priority`} />
            <div className="crit-body">
              <p className="crit-label">{n.label}</p>
              <p className="crit-note">{n.note}</p>
            </div>
            <div className="crit-actions">
              <button
                type="button"
                className="icon-btn"
                onClick={() => s.applyNotes(d.id, [n.id])}
                disabled={busy}
                aria-label={`Apply: ${n.label}`}
                title="Apply this note"
              >
                <Check aria-hidden />
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={() => s.dismissNotes(d.id, [n.id])}
                aria-label={`Dismiss: ${n.label}`}
                title="Dismiss"
              >
                <X aria-hidden />
              </button>
            </div>
          </li>
        ))}
      </ul>
      <footer className="critique-foot">
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => s.dismissNotes(d.id, notes.map((n) => n.id))}>
          Dismiss all
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => s.applyNotes(d.id, notes.map((n) => n.id))}
          disabled={busy}
        >
          Apply {notes.length > 1 ? `all ${notes.length}` : "it"}
        </button>
      </footer>
    </section>
  );
}
