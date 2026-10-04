import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { ArrowUp, ChevronRight, Crosshair, Eye, FileText, GitBranch, Paperclip, RotateCcw, X } from "lucide-react";
import { backend } from "../lib/backend";
import { Inline } from "./Inline";
import { Critique } from "./Critique";
import { ProgressMeta } from "./Progress";
import { designChoice, providerOf, useStudio } from "../lib/studio";
import { ModelPicker } from "./ModelPicker";
import { PROVIDERS } from "../lib/providers";
import { parseReply } from "../lib/prompts";
import type { Attachment, DesignMeta, Entry, LogLine, NoteTarget } from "../lib/types";

interface Props {
  design: DesignMeta;
  lines: LogLine[];
  target?: NoteTarget;
  clearTarget(): void;
  field: RefObject<HTMLTextAreaElement | null>;
  marking: boolean;
  startMarking(): void;
  viewing: number | null;
  onView(n: number | null): void;
}

const latestVersion = (d: DesignMeta) =>
  d.entries.reduce((m, e) => (e.version && e.role !== "system" ? Math.max(m, e.version) : m), 0);

/** A live run: one status line, the agent's words streaming in. */
function LiveTurn({ design, lines, onStop }: { design: DesignMeta; lines: LogLine[]; onStop(): void }) {
  const revising = design.entries.filter((e) => e.role !== "system").length > 1;
  const from = [...design.entries].reverse().find((e) => e.role !== "system")?.at ?? design.updatedAt;
  const said = parseReply(lines.filter((l) => l.kind === "say").map((l) => l.detail).join("\n\n")).body;

  return (
    <div className="turn turn-agent is-live" aria-live="polite">
      <span className="avatar" aria-hidden />
      <div className="turn-body">
        <p className="live-status">
          <span className="build-spin" aria-hidden />
          {revising ? "Making the change" : "Designing"}
        </p>
        {said && <p className="agent-text is-streaming"><Inline text={said} /></p>}
        {/* A first build shows its clock and Stop on the desk; don't repeat them here. */}
        {revising && <ProgressMeta from={from} typical="Usually about a minute" slowAfter={150} onStop={onStop} />}
      </div>
    </div>
  );
}

function AgentTurn(props: {
  e: Entry;
  isLast: boolean;
  error?: string;
  latest: number;
  viewing: number | null;
  onView(n: number | null): void;
  onRetry(): void;
  onRestore(n: number): void;
  onBranch(n: number): void;
}) {
  const { e } = props;
  const [open, setOpen] = useState(false);

  if (e.outcome === "cancelled") {
    return <p className="turn-note">Stopped. The design is as it was before this message.</p>;
  }
  if (e.outcome === "failed") {
    return (
      <div className="turn turn-agent is-failed">
        <span className="avatar" aria-hidden />
        <div className="turn-body">
          <p className="agent-text">That didn’t work.</p>
          {props.isLast && props.error && <p className="agent-error">{props.error}</p>}
          {props.isLast && (
            <button className="chip" onClick={props.onRetry}>
              <RotateCcw aria-hidden /> Try again
            </button>
          )}
        </div>
      </div>
    );
  }
  if (e.outcome !== "done") return null;

  const isViewing = props.viewing === e.version;
  const isLatest = e.version === props.latest;
  return (
    <div className="turn turn-agent">
      <span className="avatar" aria-hidden />
      <div className="turn-body">
        {e.steps && e.steps.length > 0 && (
          <div className="steps">
            <button className="steps-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              <ChevronRight aria-hidden />
              Worked for {e.seconds ? `${e.seconds}s` : "a moment"}
            </button>
            {open && (
              <ul className="steps-list">
                {e.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <p className="agent-text"><Inline text={e.reply || "Done. Take a look."} /></p>
        {e.version && (
          <div className={"version" + (isViewing ? " is-viewing" : "")}>
            <span className="version-label">
              Version {e.version}
              {isLatest && <span className="version-tag">Current</span>}
            </span>
            {!isLatest && (
              <>
                <button className="version-btn" onClick={() => props.onView(isViewing ? null : e.version!)}>
                  <Eye aria-hidden /> {isViewing ? "Hide" : "Preview"}
                </button>
                <button className="version-btn" onClick={() => props.onRestore(e.version!)}>
                  <RotateCcw aria-hidden /> Restore
                </button>
                <button className="version-btn" onClick={() => props.onBranch(e.version!)} title="Keep this version as a separate design">
                  <GitBranch aria-hidden /> Branch
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Thumbs({ files, urls, onRemove }: { files: Attachment[]; urls?: Record<string, string>; onRemove?(f: Attachment): void }) {
  return (
    <div className="thumbs">
      {files.map((f) => {
        const src = urls?.[f.path];
        return (
          <span key={f.path} className="thumb" title={f.name}>
            {src ? <img src={src} alt="" /> : <FileText aria-hidden />}
            {!src && <span className="thumb-name">{f.name}</span>}
            {onRemove && (
              <button className="thumb-x" onClick={() => onRemove(f)} aria-label={`Remove ${f.name}`}>
                <X aria-hidden />
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}

export function Chat(p: Props) {
  const s = useStudio();
  const d = p.design;
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const generating = d.status === "generating";
  const ready = !!s.providers[providerOf(d)].status?.authenticated;
  const latest = latestVersion(d);
  const lastEntry = d.entries[d.entries.length - 1];
  const suggestions = !generating && lastEntry?.outcome === "done" ? lastEntry.suggestions ?? [] : [];
  const can = ready && !generating && text.trim().length >= 2;
  const urls = s.attachmentUrls[d.id];
  const choice = designChoice(d, s.settings);

  const scrollKey = useMemo(
    () => d.entries.length + ":" + p.lines.length + ":" + (p.lines[p.lines.length - 1]?.detail?.length ?? 0) + d.status,
    [d.entries.length, d.status, p.lines],
  );
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [scrollKey]);

  useEffect(() => {
    const el = p.field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  }, [text, p.field]);

  const add = async (items: (string | File)[]) => {
    if (!items.length) return;
    const added = await s.attach(d.id, items);
    setFiles((f) => [...f, ...added.filter((a) => !f.some((x) => x.path === a.path))]);
  };

  const send = async (message = text) => {
    if (!ready || generating || message.trim().length < 2) return;
    const ok = await s.revise(d.id, message, p.target, files);
    if (ok) {
      setText("");
      setFiles([]);
      p.clearTarget();
      p.onView(null);
    }
  };

  return (
    <div className="chat">
      <div className="chat-scroll" ref={scroller}>
        <ol className="thread">
          {d.entries.map((e, i) => {
            const isLast = i === d.entries.length - 1;
            if (e.role === "system") {
              return (
                <li key={e.id} className="turn-note">
                  {e.text}
                </li>
              );
            }
            return (
              <li key={e.id} className="exchange">
                <div className="turn turn-user">
                  {e.target && (
                    <span className="turn-target" title={e.target.selector}>
                      <Crosshair aria-hidden /> <span>{e.target.label}</span>
                    </span>
                  )}
                  {e.attachments && <Thumbs files={e.attachments} urls={urls} />}
                  <p>{e.text}</p>
                </div>
                {isLast && generating ? (
                  <LiveTurn design={d} lines={p.lines} onStop={() => s.cancel(d.id)} />
                ) : (
                  <AgentTurn
                    e={e}
                    isLast={isLast}
                    error={d.error}
                    latest={latest}
                    viewing={p.viewing}
                    onView={p.onView}
                    onRetry={() => s.retry(d.id)}
                    onRestore={(n) => {
                      p.onView(null);
                      s.restoreVersion(d.id, n);
                    }}
                    onBranch={(n) => {
                      p.onView(null);
                      s.branch(d.id, n);
                    }}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <div className="chat-foot">
        <Critique design={d} />
        {suggestions.length > 0 && !d.critique?.length && (
          <div className="suggestions" aria-label="Suggested next steps">
            {suggestions.map((sug) => (
              <button key={sug} className="chip" onClick={() => send(sug)} disabled={!ready} title={sug}>
                {sug}
              </button>
            ))}
          </div>
        )}
        <div
          className={"composer" + (p.marking ? " is-marking" : "") + (dragging ? " is-dropping" : "")}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("Files")) {
              e.preventDefault();
              setDragging(true);
            }
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            add([...e.dataTransfer.files]);
          }}
        >
          {p.target && (
            <div className="composer-target">
              <Crosshair aria-hidden />
              <span title={p.target.selector}>{p.target.label}</span>
              <button className="icon-btn" onClick={p.clearTarget} aria-label="Unpin element">
                <X aria-hidden />
              </button>
            </div>
          )}
          {files.length > 0 && (
            <Thumbs files={files} urls={urls} onRemove={(f) => setFiles((all) => all.filter((x) => x.path !== f.path))} />
          )}
          <label className="visually-hidden" htmlFor="chat-input">Message</label>
          <textarea
            id="chat-input"
            ref={p.field}
            rows={1}
            value={text}
            placeholder={!ready ? `${PROVIDERS[choice.provider].name} isn’t ready` : p.target ? "What should change here?" : "Ask for a change…"}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const pasted = [...e.clipboardData.files];
              if (pasted.length) {
                e.preventDefault();
                add(pasted);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            disabled={!ready}
          />
          <div className="composer-row">
            <button
              className="icon-btn composer-icon"
              onClick={async () => add(await backend.pickFiles())}
              disabled={generating}
              title="Attach files or images"
              aria-label="Attach files or images"
            >
              <Paperclip aria-hidden />
            </button>
            <button
              className={"icon-btn composer-icon" + (p.marking ? " is-on" : "")}
              onClick={p.startMarking}
              disabled={generating || !s.artifacts[d.id]}
              aria-pressed={p.marking}
              title="Point at an element (M)"
              aria-label="Point at an element"
            >
              <Crosshair aria-hidden />
            </button>
            <ModelPicker
              variant="quiet"
              label="Model"
              value={choice}
              onChange={(c) => c && s.update(d.id, { provider: c.provider, model: c.model || undefined })}
            />
            <span className="composer-spacer" />
            <button className="send" onClick={() => send()} disabled={!can} aria-label="Send">
              <ArrowUp aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
