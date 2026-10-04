import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Code2, Crosshair, Download, Eye, FileArchive, FileCode, FolderOpen, GitBranch, ListPlus, MoreHorizontal, SwatchBook as Swatch, ScanEye, Settings2, Trash2 } from "lucide-react";
import { projectTitle, useStudio } from "../../lib/state/studio";
import { kindOf } from "../../lib/design/prompts";
import { parseTokens } from "../../lib/design/tokens";
import type { Artifact, DesignMeta, NoteTarget } from "../../lib/types";
import { PageView } from "./PageView";
import { FirstBuild, RevisionPill } from "./DesignProgress";
import { Margin } from "./Margin";
import { SettingsCtx } from "../shell/SettingsButton";
import { Segmented } from "../ui/Segmented";
import { Menu } from "../ui/Menu";
import { Dropdown } from "../ui/Dropdown";
import { AuditBadge } from "./AuditBadge";
import { GroupStrip } from "./GroupStrip";
import { useOpenBuilder } from "../systems/BuilderHost";
import { startStandaloneExport } from "./StandaloneExport";
import { isProject } from "../../lib/project/project";
import { Canvas } from "./Canvas";
import type { CanvasCommand } from "./Canvas";

export type MarginTab = "notes" | "type" | "colour" | "space";

export function Spread({ design: d }: { design: DesignMeta }) {
  const s = useStudio();
  const artifact = s.artifacts[d.id];
  const lines = s.logs[d.id] ?? [];
  const generating = d.status === "generating";
  // Variants and flow screens live on one canvas, like frames on a Figma page.
  const grouped = !!d.group;
  const [canvasCmd, setCanvasCmd] = useState<CanvasCommand>({ kind: "fit", tick: 0 });

  const [view, setView] = useState<"page" | "source">("page");
  const [zoom, setZoom] = useState<"fit" | "actual">("fit");
  const [marking, setMarking] = useState(false);
  const [target, setTarget] = useState<NoteTarget | undefined>();
  const [tab, setTab] = useState<MarginTab>("notes");
  const [title, setTitle] = useState(projectTitle(d));
  const [viewing, setViewing] = useState<number | null>(null);
  const [groupAsk, setGroupAsk] = useState<"borrow" | "screen" | null>(null);
  const openBuilder = useOpenBuilder();
  const [versionArt, setVersionArt] = useState<Artifact | null>(null);
  const frameEl = useRef<HTMLIFrameElement>(null);
  const noteField = useRef<HTMLTextAreaElement>(null);

  // On a canvas, selecting another frame swaps the design under this component.
  useEffect(() => {
    setTitle(projectTitle(d));
    setViewing(null);
    setTarget(undefined);
    setMarking(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.id]);

  useEffect(() => {
    let live = true;
    if (viewing == null) setVersionArt(null);
    else s.readVersion(d.id, viewing).then((a) => live && setVersionArt(a));
    return () => {
      live = false;
    };
  }, [viewing, d.id, s.readVersion]);
  const shown = (viewing != null && versionArt) || artifact;

  const base = useMemo(() => (artifact ? parseTokens(artifact.content) : null), [artifact]);
  const frames = kindOf(d.kind).frames;

  const sendMark = useCallback((on: boolean) => {
    frameEl.current?.contentWindow?.postMessage({ type: "dg-mark", on }, "*");
  }, []);

  useEffect(() => sendMark(marking), [marking, sendMark]);

  // Panels outside the page (the critique) mark elements on it through this.
  useEffect(() => {
    const relay = (e: Event) =>
      frameEl.current?.contentWindow?.postMessage({ type: "dg-flag", items: (e as CustomEvent).detail, scroll: true }, "*");
    window.addEventListener("dg-flag", relay);
    return () => window.removeEventListener("dg-flag", relay);
  }, []);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frameEl.current?.contentWindow) return;
      if (e.data?.type === "dg-pick") {
        setTarget({ selector: e.data.selector, snippet: e.data.snippet, label: e.data.label });
        setMarking(false);
        setTab("notes");
        requestAnimationFrame(() => noteField.current?.focus());
      }
      if (e.data?.type === "dg-escape") setMarking(false);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.("input, textarea, select, [contenteditable]");
      if (e.key === "Escape") {
        if (e.defaultPrevented || document.querySelector("dialog[open]")) return;
        if (marking) setMarking(false);
        else if (!typing) s.open(null);
      }
      if (!typing && (e.key === "m" || e.key === "M") && artifact && !generating) setMarking((m) => !m);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [marking, artifact, generating, s]);

  const clearTarget = () => {
    setTarget(undefined);
    frameEl.current?.contentWindow?.postMessage({ type: "dg-unpin" }, "*");
  };

  const commitTitle = () => {
    const t = title.trim();
    if (!t || t === projectTitle(d)) return setTitle(projectTitle(d));
    if (!d.group) return s.update(d.id, { title: t });
    // A project's name is shared; each frame keeps its letter or number.
    s.designs
      .filter((x) => x.group?.id === d.group!.id)
      .forEach((x) => s.update(x.id, { title: `${t}${x.title.match(/ · [A-Z0-9]+$/)?.[0] ?? ""}` }));
  };

  const settings = useContext(SettingsCtx);

  return (
    <div className="spread">
      <div className={"desk" + (marking ? " is-marking" : "")}>
        {view === "source" && artifact ? (
          isProject(artifact) ? (
            <Source
              text={Object.entries(artifact.files).map(([path, code]) => `// ${path}\n${code.trimEnd()}`).join("\n\n")}
              file={`${Object.keys(artifact.files).length} files`}
            />
          ) : (
            <Source text={artifact.content} file={artifact.file} />
          )
        ) : grouped ? (
          <div className="canvas-wrap">
            {viewing != null && (
              <div className="version-banner" role="status">
                <span>Version {viewing}</span>
                <button className="link" onClick={() => s.restoreVersion(d.id, viewing).then(() => setViewing(null))}>Restore</button>
                <button className="link" onClick={() => setViewing(null)}>Back to current</button>
              </div>
            )}
            <Canvas
              design={d}
              shown={shown ?? undefined}
              frameRef={frameEl}
              marking={marking}
              command={canvasCmd}
              onAddScreen={() => setGroupAsk("screen")}
            />
          </div>
        ) : artifact ? (
          <div className={"desk-stage" + (zoom === "actual" ? " is-actual" : "") + (s.landed.has(d.id) ? " is-landed" : "")}>
            {viewing != null && (
              <div className="version-banner" role="status">
                <span>Version {viewing}</span>
                <button className="link" onClick={() => s.restoreVersion(d.id, viewing).then(() => setViewing(null))}>Restore</button>
                <button className="link" onClick={() => setViewing(null)}>Back to current</button>
              </div>
            )}
            {generating && <RevisionPill design={d} lines={lines} />}
            <PageView
              ref={frameEl}
              artifact={shown!}
              frame={d.frame}
              overrides={d.overrides}
              urls={s.attachmentUrls[d.id]}
              fit="contain"
              interactive
              marks
              zoom={zoom === "actual" ? 1 : null}
              title={`${d.title}, ${d.kind}`}
            />
          </div>
        ) : (
          <div className="desk-stage">
            {generating ? (
              <FirstBuild design={d} lines={lines} onStop={() => s.cancel(d.id)} />
            ) : (
            <div className="blank-sheet" style={{ aspectRatio: `${d.frame.width} / ${d.frame.height}` }}>
              {(
                <div className="blank-msg">
                  <p className="blank-title">{d.status === "failed" ? "Nothing came back." : "Stopped."}</p>
                  {d.error && <p className="blank-detail">{d.error}</p>}
                  <button className="btn btn-primary" onClick={() => s.retry(d.id)}>Try again</button>
                </div>
              )}
            </div>
            )}
          </div>
        )}
      </div>

      <div className="top-row">
      <div className="island island-head">
        <button className="icon-btn island-btn" onClick={() => s.open(null)} aria-label="Back to designs" title="Back to designs">
          <ArrowLeft aria-hidden />
        </button>
        <label className="visually-hidden" htmlFor="title">Design name</label>
        <input
          id="title"
          className="island-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          spellCheck
        />
      </div>
      <GroupStrip design={d} ask={groupAsk} setAsk={setGroupAsk} />
      </div>

      {artifact && (
        <div className="island island-tools">
          <button
            className={"icon-btn island-btn" + (marking ? " is-on" : "")}
            aria-pressed={marking}
            onClick={() => setMarking((m) => !m)}
            disabled={generating || view === "source"}
            aria-label="Point at an element (M)"
            title="Point at an element (M)"
          >
            <Crosshair aria-hidden />
          </button>
          <span className="island-sep" aria-hidden />
          <Segmented
            size="sm"
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: "page", label: <Eye aria-hidden />, title: "Design" },
              { value: "source", label: <Code2 aria-hidden />, title: "Source" },
            ]}
          />
          <Segmented
            size="sm"
            label="Zoom"
            value={zoom}
            onChange={(v) => {
              setZoom(v);
              if (grouped) setCanvasCmd((c) => ({ kind: v, tick: c.tick + 1 }));
            }}
            options={[
              { value: "fit", label: "Fit", disabled: view === "source" },
              { value: "actual", label: "100%", disabled: view === "source" },
            ]}
          />
          <span className="island-sep" aria-hidden />
          <Dropdown
            variant="quiet"
            label="Preview frame"
            title="Preview frame"
            value={d.frame.id}
            onChange={(v) => {
              const f = frames.find((x) => x.id === v);
              if (f) s.update(d.id, { frame: f });
            }}
            // A custom size isn't a preset; keep it in the list so it stays selected.
            options={(frames.some((f) => f.id === d.frame.id) ? frames : [...frames, d.frame]).map((f) => ({
              value: f.id,
              label: f.label,
              hint: `${f.width}×${f.height}`,
            }))}
            menuWidth={220}
          />
          <span className="island-sep" aria-hidden />
          <AuditBadge design={d} artifact={shown!} frame={frameEl} />
        </div>
      )}

      <Margin
        design={d}
        base={base}
        tab={tab}
        setTab={setTab}
        target={target}
        clearTarget={clearTarget}
        noteField={noteField}
        startMarking={() => setMarking(true)}
        marking={marking}
        lines={lines}
        viewing={viewing}
        onView={setViewing}
        actions={
          <>
            <button
              className="icon-btn island-btn"
              onClick={() => {
                setTab("notes");
                s.critique(d.id);
              }}
              disabled={!artifact || generating || s.critiquing.has(d.id)}
              aria-label="Critique this design"
              title="Critique this design"
            >
              <ScanEye aria-hidden />
            </button>
            <Menu
              icon={<Download aria-hidden />}
              label="Export"
              items={
                isProject(artifact)
                  ? [
                      {
                        label: "Export as standalone HTML",
                        icon: <FileCode aria-hidden />,
                        onSelect: () => startStandaloneExport(s, d.id),
                        disabled: generating || s.exports[d.id]?.status === "running",
                      },
                      {
                        label: "Download as ZIP",
                        icon: <FileArchive aria-hidden />,
                        onSelect: () => s.exportZip(d.id),
                      },
                    ]
                  : [
                      {
                        label: artifact?.file.endsWith(".svg") ? "Download SVG" : "Download HTML",
                        icon: <Download aria-hidden />,
                        onSelect: () => s.exportDesign(d.id),
                        disabled: !artifact,
                      },
                    ]
              }
            />
            <Menu
              icon={<MoreHorizontal aria-hidden />}
              label="More"
              items={[
                {
                  label: "Branch this design",
                  icon: <GitBranch aria-hidden />,
                  onSelect: () => s.branch(d.id),
                  disabled: !artifact || generating,
                },
                {
                  label: d.group?.kind === "flow" ? "Add the next screen" : "Start a flow from this",
                  icon: <ListPlus aria-hidden />,
                  onSelect: () => setGroupAsk("screen"),
                  disabled: !artifact || generating,
                },
                {
                  label: "Make a design system from this",
                  icon: <Swatch aria-hidden />,
                  onSelect: () => openBuilder(null, { fromDesign: d.id }),
                  disabled: !artifact,
                },
                { label: "Show in folder", icon: <FolderOpen aria-hidden />, onSelect: () => s.reveal(d.id) },
                { label: "Settings", icon: <Settings2 aria-hidden />, onSelect: () => settings() },
                {
                  label: "Delete design",
                  icon: <Trash2 aria-hidden />,
                  danger: true,
                  confirm: "Click again to delete",
                  onSelect: () => s.remove(d.id),
                },
              ]}
            />
          </>
        }
      />
    </div>
  );
}

function Source({ text, file }: { text: string; file: string }) {
  const lines = text.split("\n");
  const [copied, setCopied] = useState(false);
  return (
    <div className="source">
      <div className="source-head">
        <span className="mono">{file} · {lines.length} lines</span>
        <button
          className="btn btn-quiet"
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          }}
        >
          {copied ? "Copied" : "Copy source"}
        </button>
      </div>
      <pre className="source-body mono">
        {lines.map((l, i) => (
          <span key={i} className="source-line">
            <span className="source-n" aria-hidden>{i + 1}</span>
            {l || " "}
            {"\n"}
          </span>
        ))}
      </pre>
    </div>
  );
}
