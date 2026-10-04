import { useContext, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { FileSpreadsheet, Layers, LayoutGrid, List, Paperclip, Search, Trash2, X } from "lucide-react";
import { backend } from "../../lib/backend/backend";
import { projectTitle, useStudio } from "../../lib/state/studio";
import { PROVIDERS } from "../../lib/providers";
import { ModelPicker } from "../ui/ModelPicker";
import { KINDS, kindOf } from "../../lib/design/prompts";
import { timeAgo } from "../../lib/format";
import type { DesignKind, DesignMeta, FramePreset } from "../../lib/types";
import { PageView } from "../editor/PageView";
import { CardProgress } from "./Galley";
import { SettingsCtx } from "../shell/SettingsButton";
import { Dropdown } from "../ui/Dropdown";
import { AmbientField } from "../shell/AmbientField";
import { TypePicker } from "./TypePicker";
import { SystemPicker } from "../systems/SystemPicker";
import { useOpenBuilder } from "../systems/BuilderHost";
import { KindIcon } from "../ui/KindIcon";

type Section = "all" | DesignKind;
type Sort = "edited" | "created" | "name";

function Composer({ boxRef, energy }: { boxRef: RefObject<HTMLDivElement | null>; energy: RefObject<number> }) {
  const s = useStudio();
  const [kind, setKind] = useState<DesignKind>("screen");
  const [frameSel, setFrameSel] = useState<Partial<Record<DesignKind, FramePreset>>>({});
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [variants, setVariants] = useState("1");
  /** References and data for the first brief: picked paths or pasted files. */
  const [files, setFiles] = useState<{ source: string | File; name: string }[]>([]);
  const field = useRef<HTMLTextAreaElement>(null);
  const openSettings = useContext(SettingsCtx);
  const openBuilder = useOpenBuilder();
  const idle = useRef(0);
  const stir = (level: number) => {
    energy.current = Math.max(energy.current ?? 0, level);
    window.clearTimeout(idle.current);
    idle.current = window.setTimeout(() => {
      if ((energy.current ?? 0) < 1) energy.current = 0;
    }, 900);
  };

  const ready = !!s.status?.authenticated;
  const frames = kindOf(kind).frames;
  const frame = frameSel[kind] ?? frames[0];
  const canSend = ready && brief.trim().length >= 8 && !busy;

  const submit = async () => {
    if (!canSend) return;
    setBusy(true);
    energy.current = 1;
    const id = await s.create(brief, kind, frame, s.settings.systemId || undefined, {
      variants: Number(variants),
      files: files.map((f) => f.source),
    });
    setBusy(false);
    if (id) {
      setBrief("");
      setFiles([]);
    }
  };

  const addPaths = (paths: string[]) =>
    setFiles((all) => [...all, ...paths.map((p) => ({ source: p, name: p.split(/[\\/]/).pop() || p }))]);
  const onPaste = (e: React.ClipboardEvent) => {
    const pasted = [...e.clipboardData.files];
    if (!pasted.length) return;
    e.preventDefault();
    setFiles((all) => [...all, ...pasted.map((f) => ({ source: f, name: f.name || "pasted.png" }))]);
  };

  return (
    <section className="prompt" aria-labelledby="prompt-title">
      <h1 id="prompt-title" className="prompt-title">What should we design?</h1>
      <div className="prompt-box" ref={boxRef}>
        <label className="visually-hidden" htmlFor="brief">Brief</label>
        <textarea
          id="brief"
          ref={field}
          className="prompt-field"
          rows={2}
          value={brief}
          placeholder={kindOf(kind).placeholder}
          onChange={(e) => {
            setBrief(e.target.value);
            stir(0.6);
          }}
          onFocus={() => stir(0.3)}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          spellCheck
        />
        {files.length > 0 && (
          <ul className="prompt-files" aria-label="Attached files">
            {files.map((f, i) => (
              <li key={i} className="prompt-file">
                {/\.(csv|tsv|json)$/i.test(f.name) ? <FileSpreadsheet aria-hidden /> : <Paperclip aria-hidden />}
                <span>{f.name}</span>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setFiles((all) => all.filter((_, j) => j !== i))}
                  aria-label={`Remove ${f.name}`}
                >
                  <X aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        {/* What to make on the left; who makes it and the action on the right. */}
        <div className="prompt-bar">
          <button
            type="button"
            className="icon-btn prompt-attach"
            onClick={async () => addPaths(await backend.pickFiles())}
            aria-label="Attach references or data"
            title="Attach references or data (images, CSV, JSON)"
          >
            <Paperclip aria-hidden />
          </button>
          <TypePicker
            value={kind}
            onChange={setKind}
            frame={frame}
            onFrame={(f) => setFrameSel((all) => ({ ...all, [kind]: f }))}
          />
          <SystemPicker
            value={s.settings.systemId}
            onChange={(v) => s.setSettings({ systemId: v })}
            onCreate={() => openBuilder(null)}
            onEdit={openBuilder}
          />
          <span className="prompt-spacer" />
          {ready ? (
            <ModelPicker
              variant="quiet"
              label="Model"
              value={{ provider: s.settings.provider, model: s.settings.model }}
              onChange={(c) => c && s.setChoice(c)}
            />
          ) : (
            <button className="link notice" onClick={() => openSettings("providers")}>
              {s.status ? `${PROVIDERS[s.settings.provider].name} isn’t ready` : `Checking ${PROVIDERS[s.settings.provider].name}…`}
            </button>
          )}
          <div className="send-split">
            <button
              className="btn btn-primary btn-send"
              onClick={submit}
              disabled={!canSend}
              title={variants === "1" ? "Generate (Ctrl+Enter)" : `Generate ${variants} variants side by side (Ctrl+Enter)`}
            >
              {busy ? "Sending…" : variants === "1" ? "Generate" : `Generate ${variants}`}
            </button>
            <Dropdown
              variant="quiet"
              bare
              triggerClass="btn btn-primary send-more"
              label="Variants"
              title="How many variants"
              value={variants}
              onChange={setVariants}
              disabled={busy}
              options={[
                { value: "1", label: "One design" },
                { value: "2", label: "2 variants" },
                { value: "3", label: "3 variants" },
                { value: "4", label: "4 variants" },
              ]}
              menuWidth={180}
            />
          </div>
        </div>
      </div>
      <div className="samples">
        {kindOf(kind).samples.map((b) => (
          <button
            key={b}
            className="sample"
            onClick={() => {
              setBrief(b);
              field.current?.focus();
            }}
          >
            {b}
          </button>
        ))}
      </div>
    </section>
  );
}

function statusOf(d: DesignMeta, hasArtifact: boolean): { label: string; tone?: "ok" | "busy" | "bad" } {
  if (d.status === "generating") return { label: hasArtifact ? "Revising" : "Generating", tone: "busy" };
  if (d.status === "failed") return { label: "Failed", tone: "bad" };
  if (d.status === "empty") return { label: "Stopped" };
  return { label: "Ready", tone: "ok" };
}

function Card({ d, members, layout }: { d: DesignMeta; members: DesignMeta[]; layout: "grid" | "list" }) {
  const s = useStudio();
  // The first frame that has something to show stands for the project.
  const face = members.find((m) => s.artifacts[m.id]) ?? d;
  const artifact = s.artifacts[face.id];
  const busy = members.find((m) => m.status === "generating");
  const lines = busy ? s.logs[busy.id] ?? [] : [];
  const st = busy ? statusOf(busy, !!s.artifacts[busy.id]) : statusOf(face, !!artifact);
  const title = projectTitle(d);
  const updated = Math.max(...members.map((m) => m.updatedAt));
  const [confirm, setConfirm] = useState(false);

  return (
    <li className={"card" + (layout === "list" ? " card-row" : "")} data-status={busy ? "generating" : face.status}>
      <button className="card-hit" onClick={() => s.open(face.id)} aria-label={`Open ${title}, ${st.label}`} />
      <div className={"card-thumb" + (members.some((m) => s.landed.has(m.id)) ? " is-landed" : "")} data-kind={d.kind}>
        {artifact ? (
          <PageView
            artifact={artifact}
            frame={face.frame}
            overrides={face.overrides}
            fit={kindOf(d.kind).fit}
            urls={s.attachmentUrls[face.id]}
            title={title}
          />
        ) : busy ? null : (
          <span className="card-blank">{face.status === "failed" ? "Nothing came back" : "Empty"}</span>
        )}
        {busy && <CardProgress lines={lines} revising={!!artifact} />}
        {members.length > 1 && (
          <span className="card-frames" aria-hidden>
            <Layers /> {members.length}
          </span>
        )}
      </div>
      <div className="card-info">
        <span className="card-icon" aria-hidden>
          <KindIcon kind={d.kind} />
        </span>
        <span className="card-text">
          <span className="card-title">{title}</span>
          <span className="card-meta">
            {st.tone !== "ok" && (
              <span className="status" data-tone={st.tone}>{st.label}</span>
            )}
            {d.group && (
              <span className="card-group">
                {members.length} {d.group.kind === "flow" ? (members.length === 1 ? "screen" : "screens") : members.length === 1 ? "frame" : "frames"}
              </span>
            )}
            <span>Edited {timeAgo(updated)}</span>
          </span>
        </span>
        {confirm ? (
          <span className="card-confirm">
            <button className="btn btn-danger btn-xs" onClick={() => members.forEach((m) => s.remove(m.id))}>
              {members.length > 1 ? `Delete ${members.length}` : "Delete"}
            </button>
            <button className="btn btn-quiet btn-xs" onClick={() => setConfirm(false)} autoFocus>Keep</button>
          </span>
        ) : (
          <button className="icon-btn card-menu" onClick={() => setConfirm(true)} aria-label={`Delete ${title}`} title="Delete">
            <Trash2 aria-hidden />
          </button>
        )}
      </div>
    </li>
  );
}

/** Designs as the wall shows them: a group's frames are one project. */
function projects(designs: DesignMeta[]) {
  const byGroup = new Map<string, DesignMeta[]>();
  const out: { d: DesignMeta; members: DesignMeta[]; createdAt: number; updatedAt: number }[] = [];
  for (const d of designs) {
    if (!d.group) {
      out.push({ d, members: [d], createdAt: d.createdAt, updatedAt: d.updatedAt });
      continue;
    }
    const list = byGroup.get(d.group.id);
    if (list) list.push(d);
    else byGroup.set(d.group.id, [d]);
  }
  for (const members of byGroup.values()) {
    members.sort((a, b) => a.group!.index - b.group!.index);
    out.push({
      d: members[0],
      members,
      createdAt: Math.min(...members.map((m) => m.createdAt)),
      updatedAt: Math.max(...members.map((m) => m.updatedAt)),
    });
  }
  return out;
}

const SECTIONS: { id: Section; label: string }[] = [
  { id: "all", label: "All" },
  ...KINDS.map((k) => ({ id: k.id as Section, label: k.plural })),
];

export function Wall() {
  const s = useStudio();
  const [section, setSection] = useState<Section>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("edited");
  const [layout, setLayout] = useState<"grid" | "list">("grid");

  const all = useMemo(() => projects(s.designs), [s.designs]);
  const counts = useMemo<Record<Section, number>>(
    () => ({
      all: all.length,
      ...(Object.fromEntries(KINDS.map((k) => [k.id, all.filter((p) => p.d.kind === k.id).length])) as Record<DesignKind, number>),
    }),
    [all],
  );

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all
      .filter((p) => section === "all" || p.d.kind === section)
      .filter((p) => !q || p.members.some((d) => d.title.toLowerCase().includes(q) || d.entries[0]?.text.toLowerCase().includes(q)))
      .sort((a, b) =>
        sort === "name" ? projectTitle(a.d).localeCompare(projectTitle(b.d))
          : sort === "created" ? b.createdAt - a.createdAt
            : b.updatedAt - a.updatedAt,
      );
  }, [all, section, query, sort]);

  const box = useRef<HTMLDivElement>(null);
  const energy = useRef(0);
  const producing = s.designs.some((d) => d.status === "generating");
  useEffect(() => {
    energy.current = producing ? 1 : 0;
  }, [producing]);

  return (
    <div className="hub">
      <div className="hub-hero">
        <AmbientField anchor={box} energy={energy} still={!s.settings.motion} />
        <Composer boxRef={box} energy={energy} />
      </div>

      <section className="files" aria-label="Your designs">
        <header className="files-head">
          <div className="filters" role="group" aria-label="Show">
            {SECTIONS.map(({ id, label }) => (
              <button key={id} className="filter" aria-pressed={section === id} onClick={() => setSection(id)}>
                {label}
                <span className="filter-count">{counts[id]}</span>
              </button>
            ))}
          </div>
          <div className="files-tools">
            <div className="search">
              <Search aria-hidden />
              <label className="visually-hidden" htmlFor="search">Search designs</label>
              <input
                id="search"
                placeholder="Search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                spellCheck={false}
              />
            </div>
            <Dropdown
              variant="quiet"
              label="Sort"
              value={sort}
              onChange={(v) => setSort(v as Sort)}
              options={[
                { value: "edited", label: "Last edited" },
                { value: "created", label: "Date created" },
                { value: "name", label: "Alphabetical" },
              ]}
              menuWidth={180}
            />
            <div className="toggle" role="group" aria-label="Layout">
              <button aria-pressed={layout === "grid"} onClick={() => setLayout("grid")} aria-label="Grid">
                <LayoutGrid aria-hidden />
              </button>
              <button aria-pressed={layout === "list"} onClick={() => setLayout("list")} aria-label="List">
                <List aria-hidden />
              </button>
            </div>
          </div>
        </header>

        {s.loaded && list.length === 0 ? (
          <div className="files-empty">
            <p className="files-empty-title">{s.designs.length === 0 ? "Nothing here yet." : "Nothing matches."}</p>
            <p>
              {s.designs.length === 0
                ? "Describe something above. Every design lands here and stays editable."
                : "Try another search."}
            </p>
          </div>
        ) : (
          <ul className={layout === "grid" ? "cards" : "cards cards-list"}>
            {list.map((p) => (
              <Card key={p.d.group?.id ?? p.d.id} d={p.d} members={p.members} layout={layout} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
