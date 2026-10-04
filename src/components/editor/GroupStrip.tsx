import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, Plus } from "lucide-react";
import { siblingName, useStudio, variantLetter } from "../../lib/state/studio";
import type { DesignMeta } from "../../lib/types";

type Ask = "borrow" | "screen" | null;

/**
 * The design's siblings: variants of one brief (compare, borrow parts across)
 * or screens of one flow (step through, add the next screen).
 */
export function GroupStrip({ design: d, ask, setAsk }: { design: DesignMeta; ask: Ask; setAsk(a: Ask): void }) {
  const s = useStudio();
  const group = d.group;
  const siblings = group
    ? s.designs.filter((x) => x.group?.id === group.id).sort((a, b) => a.group!.index - b.group!.index)
    : [d];
  const flow = !group || group.kind === "flow";
  const others = siblings.filter((x) => x.id !== d.id && s.artifacts[x.id]);
  const busy = d.status === "generating";

  const [from, setFrom] = useState<string | null>(null);
  const [text, setText] = useState("");
  const pop = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!ask) return;
    setText("");
    setFrom(others[0]?.id ?? null);
    requestAnimationFrame(() => field.current?.focus());
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!pop.current?.contains(t) && !t.closest?.(".island-group")) setAsk(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setAsk(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask]);

  if (!group && !ask) return null;

  const submit = async () => {
    const t = text.trim();
    if (!t) return;
    setAsk(null);
    if (ask === "screen") await s.nextScreen(d.id, t);
    else if (ask === "borrow" && from) await s.borrow(d.id, from, t);
  };

  return (
    <div className="island island-group">
      <span className="group-label">{flow ? "Flow" : "Variants"}</span>
      {siblings.map((x) => (
        <button
          key={x.id}
          type="button"
          className={"group-chip" + (x.id === d.id ? " is-on" : "")}
          aria-current={x.id === d.id ? "page" : undefined}
          onClick={() => s.open(x.id)}
          title={`${siblingName(x)}: ${x.title}`}
          data-status={x.status}
        >
          {flow ? (x.group?.index ?? 0) + 1 : variantLetter(x.group?.index ?? 0)}
        </button>
      ))}
      <span className="island-sep" aria-hidden />
      {flow ? (
        <button type="button" className="group-action" onClick={() => setAsk(ask === "screen" ? null : "screen")} disabled={busy}>
          <Plus aria-hidden /> Next screen
        </button>
      ) : (
        <button
          type="button"
          className="group-action"
          onClick={() => setAsk(ask === "borrow" ? null : "borrow")}
          disabled={busy || !others.length || !s.artifacts[d.id]}
          title="Bring part of another variant into this one"
        >
          <ArrowDownToLine aria-hidden /> Borrow
        </button>
      )}

      {ask && (
        <div ref={pop} className="group-pop" role="dialog" aria-label={ask === "screen" ? "Next screen" : "Borrow from a variant"}>
          {ask === "borrow" && (
            <div className="group-from" role="radiogroup" aria-label="Take from">
              <span>Take from</span>
              {others.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  role="radio"
                  aria-checked={from === x.id}
                  className={"group-chip" + (from === x.id ? " is-on" : "")}
                  onClick={() => setFrom(x.id)}
                >
                  {variantLetter(x.group?.index ?? 0)}
                </button>
              ))}
            </div>
          )}
          <label className="group-q" htmlFor="group-text">
            {ask === "screen" ? "What is the next screen?" : "What should come over?"}
          </label>
          <textarea
            id="group-text"
            ref={field}
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={ask === "screen" ? "Checkout: pay for the chosen plan and confirm the booking" : "The pricing table and its heading"}
          />
          <div className="group-pop-foot">
            <span className="kbd">Ctrl ↵</span>
            <button className="btn btn-primary btn-sm" onClick={submit} disabled={!text.trim() || (ask === "borrow" && !from)}>
              {ask === "screen" ? "Design the screen" : "Bring it over"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
