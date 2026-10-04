import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ImagePlus, Link2, Minus, RotateCcw, Sparkles, X } from "lucide-react";
import { backend } from "../lib/backend";
import { Dropdown } from "./Dropdown";
import { systemChoice, useStudio } from "../lib/studio";
import { useSystems } from "../lib/systemsStore";
import { REVIEW_TWEAKS, parseSpec, swatchesOf } from "../lib/systems";
import type { Question, QuestionOption, SystemMeta } from "../lib/systems";
import type { LogLine } from "../lib/types";
import { clock, useElapsed } from "./Progress";
import { Inline } from "./Inline";

type Step = "brief" | "asking" | "questions" | "building" | "review";

/** Load Google Fonts named by type options so the cards preview them. */
function useFonts(families: string[]) {
  const key = families.join("|");
  useEffect(() => {
    const fams = [...new Set(families.filter(Boolean))];
    if (!fams.length) return;
    const id = "gf-sys-" + fams.join("-").replace(/\W+/g, "");
    if (document.getElementById(id)) return;
    const q = fams.map((f) => "family=" + f.replace(/\s+/g, "+") + ":wght@400;600;700").join("&");
    document.head.appendChild(
      Object.assign(document.createElement("link"), { id, rel: "stylesheet", href: `https://fonts.googleapis.com/css2?${q}&display=swap` }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

const RADII = [0, 6, 12, 999];
const DENSITY = [4, 8, 12];

function radiusOf(opt: QuestionOption, i: number): number {
  if (/pill|full|round(ed)? controls/i.test(opt.label + (opt.hint ?? ""))) return 999;
  const n = parseInt(opt.hint?.match(/\d+/)?.[0] ?? "", 10);
  return Number.isNaN(n) ? RADII[Math.min(i, RADII.length - 1)] : n;
}

function spacingOf(opt: QuestionOption, i: number): number {
  const n = parseInt(opt.hint?.match(/\d+/)?.[0] ?? "", 10);
  return Number.isNaN(n) ? DENSITY[Math.min(i, DENSITY.length - 1)] : n;
}

function OptionArt({ q, o, i }: { q: Question; o: QuestionOption; i: number }) {
  if (q.visual === "palette" && o.swatches?.length) {
    return (
      <span className="opt-palette" aria-hidden>
        {o.swatches.slice(0, 5).map((c, k) => (
          <i key={k} style={{ background: c }} />
        ))}
      </span>
    );
  }
  if (q.visual === "type" && o.display) {
    return (
      <span className="opt-type" aria-hidden>
        <span className="opt-type-display" style={{ fontFamily: `"${o.display}", serif` }}>Aa</span>
        <span className="opt-type-body" style={{ fontFamily: `"${o.body || o.display}", sans-serif` }}>
          The quick brown fox
        </span>
      </span>
    );
  }
  if (q.visual === "shape") {
    const r = radiusOf(o, i);
    return (
      <span className="opt-shape" aria-hidden>
        <i style={{ borderRadius: Math.min(r, 20) }} />
        <b style={{ borderRadius: Math.min(r, 14) }}>Button</b>
      </span>
    );
  }
  if (q.visual === "density") {
    const g = spacingOf(o, i);
    return (
      <span className="opt-density" aria-hidden style={{ gap: g * 0.75, padding: g }}>
        <i />
        <i />
        <i />
      </span>
    );
  }
  return null;
}

function QuestionStep({ q, picked, onPick }: { q: Question; picked: string[]; onPick(ids: string[]): void }) {
  useFonts(q.visual === "type" ? q.options.flatMap((o) => [o.display ?? "", o.body ?? ""]) : []);
  const visual = q.visual !== "text";
  return (
    <div className="q" key={q.id}>
      <h3 className="q-title">{q.title}</h3>
      {q.why && <p className="q-why">{q.why}{q.multi && " Pick any."}</p>}
      <div className={"q-options" + (visual ? " is-visual" : "")} role={q.multi ? "group" : "radiogroup"} aria-label={q.title}>
        {q.options.map((o, i) => {
          const on = picked.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              role={q.multi ? "checkbox" : "radio"}
              aria-checked={on}
              className={"q-opt" + (visual ? " is-visual" : "")}
              onClick={() => onPick(q.multi ? (on ? picked.filter((x) => x !== o.id) : [...picked, o.id]) : [o.id])}
            >
              {visual && <OptionArt q={q} o={o} i={i} />}
              <span className="q-opt-text">
                <span className="q-opt-label">{o.label}</span>
                {o.hint && <span className="q-opt-hint">{o.hint}</span>}
              </span>
              <span className="q-opt-check" aria-hidden>{on && <Check />}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}


/** Files the agent has finished writing in this run, from its tool steps. */
function writtenFiles(lines: LogLine[]): Set<string> {
  const out = new Set<string>();
  lines.forEach((l) => {
    if (l.kind === "tool" && l.state === "done" && l.detail) out.add(l.detail.toLowerCase());
  });
  return out;
}

const BUILD_STEPS = [
  { file: "", label: "Reading your choices" },
  { file: "system.json", label: "Defining colour, type and spacing tokens" },
  { file: "design.md", label: "Writing rules for every component" },
  { file: "preview.html", label: "Rendering the specimen page" },
  { file: "*", label: "Checking contrast and consistency" },
];

/** Where a system build is: each milestone ticks when the agent writes its file. */
export function buildProgress(meta: SystemMeta, lines: LogLine[]) {
  const written = writtenFiles(lines);
  const started = lines.length > 0;
  const revising = meta.turns[meta.turns.length - 1]?.kind === "revise";
  const extracting = meta.source === "reference" && meta.turns.length === 1;
  const doneAt = (i: number) => {
    const st = BUILD_STEPS[i];
    if (!st.file) return started;
    if (st.file === "*") return false;
    return written.has(st.file);
  };
  const steps = BUILD_STEPS.map((st, i) => ({
    label: i === 0 && revising ? "Reading your feedback" : i === 0 && extracting ? "Reading your references" : st.label,
    done: doneAt(i),
  }));
  const active = steps.findIndex((st) => !st.done);
  return { steps, active, done: steps.filter((st) => st.done).length, written };
}

/**
 * The wait while the agent builds a system: real milestones (each ticks when
 * its file is written), a clock, and the designer's own choices, replaced by
 * the actual tokens as soon as they exist.
 */
function BuildScreen({ meta, label, onStop }: { meta: SystemMeta; label: string; onStop(): void }) {
  const s = useStudio();
  const sys = useSystems();
  const lines = s.logs[meta.id] ?? [];
  const turn = meta.turns[meta.turns.length - 1];
  const elapsed = useElapsed(turn?.at ?? Date.now());
  const { steps, active, written } = buildProgress(meta, lines);

  // Pull the tokens in as soon as the agent has written them.
  const hasTokens = written.has("system.json");
  useEffect(() => {
    if (hasTokens) sys.load(meta.id);
  }, [hasTokens, meta.id, sys]);
  const spec = hasTokens ? parseSpec(sys.files[meta.id]?.spec) : null;


  // What the designer picked, until real tokens arrive.
  const qs = meta.questionnaire?.questions ?? [];
  const pick = (visual: string) => {
    const q = qs.find((x) => x.visual === visual);
    const id = q && meta.answers?.[q.id]?.[0];
    return q?.options.find((o) => o.id === id);
  };
  const palette = spec ? swatchesOf(spec) : pick("palette")?.swatches ?? [];
  const typeOpt = pick("type");
  const display = spec?.typography?.display?.family ?? typeOpt?.display;
  const body = spec?.typography?.body?.family ?? typeOpt?.body;
  useFonts([display ?? "", body ?? ""]);
  const chips = qs
    .filter((q) => q.visual !== "palette" && q.visual !== "type")
    .flatMap((q) => (meta.answers?.[q.id] ?? []).map((id) => q.options.find((o) => o.id === id)?.label))
    .filter(Boolean)
    .slice(0, 8) as string[];

  return (
    <div className="build">
      <div className="build-main">
        <p className="build-kicker" aria-live="polite">
          <span className="build-dot" aria-hidden />
          {label}
        </p>
        <ol className="build-steps">
          {steps.map((st, i) => {
            const state = st.done ? "done" : i === active ? "active" : "todo";
            return (
              <li key={st.label} className="build-stepline" data-state={state}>
                <span className="build-mark" aria-hidden>
                  {state === "done" ? <Check /> : state === "active" ? <span className="build-spin" /> : null}
                </span>
                <span className={state === "active" ? "shimmer" : undefined}>{st.label}</span>
                <span className="visually-hidden">{state === "done" ? " (done)" : state === "active" ? " (in progress)" : ""}</span>
              </li>
            );
          })}
        </ol>
        <div className="build-meta">
          <span className="build-clock">{clock(elapsed)}</span>
          <span>{elapsed < 150 ? "Usually 1–2 minutes" : "Taking longer than usual, still working"}</span>
          <button className="btn btn-quiet btn-sm" onClick={onStop}>Stop</button>
        </div>
      </div>

      <aside className="build-recap" aria-label={spec ? "Tokens so far" : "Your choices"}>
        <p className="build-recap-title">{spec ? "Tokens are in" : "Your choices"}</p>
        {palette.length > 0 && (
          <div className="build-palette">
            {palette.map((c, i) => (
              <i key={i} style={{ background: c }} />
            ))}
          </div>
        )}
        {display && (
          <div className="build-type">
            <span style={{ fontFamily: `"${display}", serif` }}>Aa</span>
            <span className="build-type-names">
              <b>{display}</b>
              {body && body !== display && <em>{body}</em>}
            </span>
          </div>
        )}
        {chips.length > 0 && (
          <div className="build-chips">
            {chips.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}

function Review({ meta, onDone }: { meta: SystemMeta; onDone(): void }) {
  const sys = useSystems();
  const files = sys.files[meta.id];
  const spec = useMemo(() => parseSpec(files?.spec), [files?.spec]);
  const [tweaks, setTweaks] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const busy = meta.status === "generating";
  const last = [...meta.turns].reverse().find((t) => t.outcome === "done");

  useEffect(() => {
    if (!files) sys.load(meta.id);
  }, [files, meta.id, sys]);

  const apply = () => {
    const parts = [...tweaks, note.trim()].filter(Boolean);
    if (!parts.length) return;
    sys.revise(meta.id, parts.map((p) => `- ${p}`).join("\n"));
    setTweaks([]);
    setNote("");
  };

  const light = spec?.colors?.light ?? {};
  return (
    <div className="review">
      <div className="review-stage">
        {files?.preview ? (
          <ScaledFrame title={`${meta.name} preview`} doc={files.preview} />
        ) : (
          <div className="review-empty">{meta.error ?? "No preview yet."}</div>
        )}
        {busy && (
          <div className="review-veil">
            <BuildScreen meta={meta} label="Applying your changes" onStop={() => sys.cancel(meta.id)} />
          </div>
        )}
      </div>

      <aside className="review-side">
        <div className="review-scroll">
          <label className="visually-hidden" htmlFor="sys-name">System name</label>
          <input
            id="sys-name"
            className="review-name"
            value={meta.name}
            onChange={(e) => sys.rename(meta.id, e.target.value)}
            spellCheck={false}
          />
          {last?.reply && <p className="review-reply"><Inline text={last.reply} /></p>}
          {meta.error && !busy && (
            <p className="review-error">
              {meta.error}{" "}
              <button className="link" onClick={() => sys.generate(meta.id)}>Try again</button>
            </p>
          )}

          <dl className="review-facts">
            {Object.keys(light).length > 0 && (
              <div className="review-fact is-wide">
                <dt>Colour</dt>
                <dd className="review-colors">
                  {Object.entries(light).slice(0, 10).map(([role, hex]) => (
                    <span key={role} className="review-color" title={`${role} ${hex}`}>
                      <i style={{ background: hex }} />
                      <em>{role}</em>
                    </span>
                  ))}
                </dd>
              </div>
            )}
            {spec?.typography && (
              <div className="review-fact">
                <dt>Type</dt>
                <dd>{[spec.typography.display?.family, spec.typography.body?.family].filter(Boolean).join(" / ")}</dd>
              </div>
            )}
            {spec?.radius && (
              <div className="review-fact">
                <dt>Radius</dt>
                <dd>{Object.values(spec.radius).filter((v) => v < 999).join(" · ")} px</dd>
              </div>
            )}
            {spec?.spacing?.base && (
              <div className="review-fact">
                <dt>Spacing</dt>
                <dd>{spec.spacing.base} px base</dd>
              </div>
            )}
            {!!spec?.components?.length && (
              <div className="review-fact is-wide">
                <dt>Covers</dt>
                <dd>{spec.components.join(", ")}</dd>
              </div>
            )}
          </dl>

          <div className="review-change">
            <p className="review-h">Want something different?</p>
            <div className="review-tweaks">
              {REVIEW_TWEAKS.map((t) => {
                const on = tweaks.includes(t);
                return (
                  <button
                    key={t}
                    className={"chip" + (on ? " is-on" : "")}
                    aria-pressed={on}
                    onClick={() => setTweaks((all) => (on ? all.filter((x) => x !== t) : [...all, t]))}
                    disabled={busy}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
            <label className="visually-hidden" htmlFor="sys-note">Describe a change</label>
            <textarea
              id="sys-note"
              className="review-note"
              rows={3}
              placeholder="Or describe it…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={busy}
            />
          </div>
        </div>

        <div className="review-actions">
          <button className="btn" onClick={apply} disabled={busy || (!tweaks.length && !note.trim())}>
            <RotateCcw aria-hidden /> Apply changes
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              sys.save(meta.id);
              onDone();
            }}
            disabled={busy || !files?.preview}
          >
            <Check aria-hidden /> {meta.saved ? "Done" : "Save system"}
          </button>
        </div>
      </aside>
    </div>
  );
}

/**
 * Design-system builder: a short brief, a tailored questionnaire answered only
 * by picking, the agent builds tokens + rules + specimen, then review and refine.
 */
export function SystemBuilder({ editId, fromDesign, onClose, onMinimize, onSaved }: {
  editId: string | null;
  /** Start by extracting the system from this design. */
  fromDesign?: string;
  onClose(): void;
  /** Hide the builder while the agent keeps working; progress moves to a toast. */
  onMinimize(id: string): void;
  onSaved(id: string): void;
}) {
  const sys = useSystems();
  const s = useStudio();
  const ref = useRef<HTMLDialogElement>(null);
  const [id, setId] = useState<string | null>(editId);
  const [brief, setBrief] = useState("");
  const [asking, setAsking] = useState<null | "questions" | "extract">(null);
  // References to extract a system from, instead of a questionnaire.
  const [refFiles, setRefFiles] = useState<{ source: string | File; name: string }[]>([]);
  const [refDesign, setRefDesign] = useState(fromDesign ?? "");
  const [refUrl, setRefUrl] = useState("");
  const hasRefs = refFiles.length > 0 || !!refDesign || /^https?:\/\/\S+\.\S+/.test(refUrl.trim());
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const meta = sys.systems.find((m) => m.id === id);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const step: Step = !meta
    ? asking ? "asking" : "brief"
    : meta.status === "draft"
      ? "questions"
      : meta.status === "generating" && !meta.turns.some((t) => t.outcome === "done")
        ? "building"
        : "review";

  const building = meta?.status === "generating";
  const close = () => {
    // A build keeps going in the background; closing just tucks it away.
    if (meta && building) return onMinimize(meta.id);
    // Throw away drafts that were never saved and aren't being built.
    if (meta && !meta.saved) sys.remove(meta.id);
    onClose();
  };

  const ask = async () => {
    setError(null);
    setAsking("questions");
    try {
      const m = await sys.start(brief);
      setId(m.id);
      setIndex(0);
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ""));
    } finally {
      setAsking(null);
    }
  };

  const extract = async () => {
    setError(null);
    setAsking("extract");
    try {
      const m = await sys.extract(brief, {
        files: refFiles.map((f) => f.source),
        designId: refDesign || undefined,
        url: refUrl.trim() || undefined,
      });
      setId(m.id);
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ""));
    } finally {
      setAsking(null);
    }
  };

  const addRefFiles = (list: (string | File)[]) =>
    setRefFiles((all) => [
      ...all,
      ...list.map((f) => ({ source: f, name: typeof f === "string" ? f.split(/[\\/]/).pop() || f : f.name || "pasted.png" })),
    ]);
  const designsToRead = s.designs.filter((d) => s.artifacts[d.id]);

  const qs = meta?.questionnaire?.questions ?? [];
  const q = qs[index];
  const answers = meta?.answers ?? {};
  const picked = q ? answers[q.id] ?? [] : [];
  const ready = !!s.providers[systemChoice(s.settings).provider].status?.authenticated;

  return (
    <dialog
      ref={ref}
      className="modal builder"
      aria-label="Design system builder"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header className="builder-head">
        <div className="builder-crumbs">
          <Sparkles aria-hidden />
          <span>{meta?.name ?? "New design system"}</span>
          {step === "questions" && (
            <span className="builder-count">
              {index + 1} / {qs.length}
            </span>
          )}
        </div>
        <div className="builder-tools">
          {meta && building && (
            <button className="btn btn-quiet btn-sm" onClick={() => onMinimize(meta.id)}>
              <Minus aria-hidden /> Minimize
            </button>
          )}
          <button className="icon-btn" onClick={close} aria-label={building ? "Minimize builder" : "Close builder"}>
            <X aria-hidden />
          </button>
        </div>
      </header>

      {step === "questions" && (
        <div className="builder-dots" aria-hidden>
          {qs.map((qq, i) => (
            <i key={qq.id} data-state={i < index ? "done" : i === index ? "now" : "todo"} />
          ))}
        </div>
      )}

      <div className="builder-body">
        {step === "brief" && (
          <div className="builder-brief">
            <h2 className="builder-title">What is this system for?</h2>
            <p className="builder-lede">One line about the product and who uses it. The agent tailors every question to it.</p>
            <textarea
              className="builder-input"
              rows={3}
              autoFocus
              value={brief}
              placeholder="A budgeting app for young families, used on phones in the evening…"
              onChange={(e) => setBrief(e.target.value)}
              onPaste={(e) => {
                const pasted = [...e.clipboardData.files];
                if (!pasted.length) return;
                e.preventDefault();
                addRefFiles(pasted);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) (hasRefs ? extract : ask)();
              }}
            />

            <section className="builder-refs" aria-labelledby="refs-title">
              <p id="refs-title" className="builder-refs-title">Or start from something that exists</p>
              <p className="builder-refs-lede">
                Screenshots, a page’s HTML, one of your designs or a link. The agent reads the visual language straight from them.
              </p>
              <div className="builder-refs-row">
                <button type="button" className="btn btn-sm" onClick={async () => addRefFiles(await backend.pickFiles())}>
                  <ImagePlus aria-hidden /> Add screenshots or files
                </button>
                {designsToRead.length > 0 && (
                  <Dropdown
                    variant="quiet"
                    label="From a design"
                    value={refDesign}
                    onChange={setRefDesign}
                    options={[
                      { value: "", label: "None of my designs" },
                      ...designsToRead.map((d) => ({ value: d.id, label: d.title })),
                    ]}
                    menuWidth={300}
                  />
                )}
              </div>
              <label className="builder-url">
                <Link2 aria-hidden />
                <span className="visually-hidden">Link to a live page</span>
                <input
                  type="url"
                  value={refUrl}
                  onChange={(e) => setRefUrl(e.target.value)}
                  placeholder="https://… a live page to learn from (optional)"
                  spellCheck={false}
                />
              </label>
              {refFiles.length > 0 && (
                <ul className="builder-ref-list" aria-label="References">
                  {refFiles.map((f, i) => (
                    <li key={i}>
                      <span>{f.name}</span>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => setRefFiles((all) => all.filter((_, j) => j !== i))}
                        aria-label={`Remove ${f.name}`}
                      >
                        <X aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {error && <p className="builder-error">{error}</p>}
            <div className="builder-nav">
              {hasRefs ? (
                <button className="btn btn-quiet" onClick={ask} disabled={!ready}>
                  Ask me questions instead
                </button>
              ) : (
                <span />
              )}
              {hasRefs ? (
                <button className="btn btn-primary" onClick={extract} disabled={!ready}>
                  <Sparkles aria-hidden /> Extract the system
                </button>
              ) : (
                <button className="btn btn-primary" onClick={ask} disabled={!ready}>
                  Ask me questions <ArrowRight aria-hidden />
                </button>
              )}
            </div>
          </div>
        )}

        {step === "asking" && (
          <div className="builder-center">
            <div className="build-progress" role="status">
              <span className="build-orbit" aria-hidden />
              <p className="build-title">{asking === "extract" ? "Gathering references" : "Preparing questions"}</p>
              <p className="build-step">
                <span className="shimmer">{asking === "extract" ? "Copying them where the agent can read them…" : "Thinking about your product…"}</span>
              </p>
              <span className="card-progress-bar build-bar" aria-hidden />
            </div>
          </div>
        )}

        {step === "questions" && q && meta && (
          <div className="builder-questions">
            <QuestionStep
              q={q}
              picked={picked}
              onPick={(ids) => {
                sys.setAnswers(meta.id, { ...answers, [q.id]: ids });
                if (!q.multi && index < qs.length - 1) setTimeout(() => setIndex((i) => i + 1), 260);
              }}
            />
            <div className="builder-nav">
              <button className="btn btn-quiet" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0}>
                <ArrowLeft aria-hidden /> Back
              </button>
              {index < qs.length - 1 ? (
                <button className="btn" onClick={() => setIndex((i) => i + 1)}>
                  {picked.length ? "Next" : "Skip"} <ArrowRight aria-hidden />
                </button>
              ) : (
                <button className="btn btn-primary" onClick={() => sys.generate(meta.id)} disabled={!ready}>
                  <Sparkles aria-hidden /> Build the system
                </button>
              )}
            </div>
          </div>
        )}

        {step === "building" && meta && (
          <BuildScreen meta={meta} label={`Building ${meta.name}`} onStop={() => sys.cancel(meta.id)} />
        )}

        {step === "review" && meta && (
          <Review
            meta={meta}
            onDone={() => {
              onSaved(meta.id);
              onClose();
            }}
          />
        )}
      </div>
    </dialog>
  );
}

/** The narrowest width a system preview is laid out at; a smaller stage scales it down. */
const PREVIEW_MIN_W = 720;

/** The preview at full width, or at PREVIEW_MIN_W scaled to fit when the stage is narrower. */
function ScaledFrame({ title, doc }: { title: string; doc: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = size.w && size.w < PREVIEW_MIN_W ? size.w / PREVIEW_MIN_W : 1;
  return (
    <div ref={box} className="review-frame-box">
      <iframe
        className="review-frame"
        title={title}
        srcDoc={doc}
        sandbox=""
        style={scale < 1 ? { width: PREVIEW_MIN_W, height: size.h / scale, transform: `scale(${scale})` } : undefined}
      />
    </div>
  );
}
