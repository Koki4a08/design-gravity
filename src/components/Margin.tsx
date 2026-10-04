import { useEffect, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { providerOf, useStudio } from "../lib/studio";
import { CURATED_FONTS, primaryFamily } from "../lib/tokens";
import type { DesignMeta, LogLine, NoteTarget, TokenOverrides, Tokens } from "../lib/types";
import type { MarginTab } from "./Spread";
import { Chat } from "./Chat";
import { Dropdown } from "./Dropdown";
import { ColorPicker } from "./ColorPicker";
import { Tabs } from "./Segmented";

interface Props {
  design: DesignMeta;
  base: { tokens: Tokens; contract: boolean } | null;
  tab: MarginTab;
  setTab(t: MarginTab): void;
  target?: NoteTarget;
  clearTarget(): void;
  noteField: RefObject<HTMLTextAreaElement | null>;
  startMarking(): void;
  marking: boolean;
  lines: LogLine[];
  viewing: number | null;
  onView(n: number | null): void;
  actions?: ReactNode;
}

const TABS: { id: MarginTab; label: string }[] = [
  { id: "notes", label: "Chat" },
  { id: "type", label: "Type" },
  { id: "colour", label: "Colour" },
  { id: "space", label: "Space" },
];

export function Margin(p: Props) {
  const { design: d, base } = p;
  const s = useStudio();
  const tokens: Tokens | null = base ? { ...base.tokens, ...d.overrides } : null;
  const set = (patch: TokenOverrides) => s.update(d.id, { overrides: { ...d.overrides, ...patch } });
  const reset = (keys: (keyof Tokens)[]) => {
    const next = { ...d.overrides };
    keys.forEach((k) => delete next[k]);
    s.update(d.id, { overrides: next });
  };

  return (
    <aside className="island island-side" aria-label="Design panel">
      <div className="side-head">
        <Tabs
          label="Panel"
          idPrefix="tab"
          value={p.tab}
          onChange={p.setTab}
          tabs={TABS.map((t) => ({ value: t.id, label: t.label, disabled: t.id !== "notes" && !tokens }))}
        />
        <div className="side-actions">{p.actions}</div>
      </div>

      <div className="side-panel" key={p.tab} role="tabpanel" id="tab-panel" aria-labelledby={`tab-${p.tab}`}>
        {p.tab === "notes" ? (
          <Chat
            design={d}
            lines={p.lines}
            target={p.target}
            clearTarget={p.clearTarget}
            field={p.noteField}
            marking={p.marking}
            startMarking={p.startMarking}
            viewing={p.viewing}
            onView={p.onView}
          />
        ) : (
          <div className="margin-scroll">
            {tokens && base && !base.contract && <ContractWarning design={d} />}
            {p.tab === "type" && tokens && base && <TypePanel tokens={tokens} agent={base.tokens} o={d.overrides} set={set} reset={reset} />}
            {p.tab === "colour" && tokens && base && <ColourPanel tokens={tokens} agent={base.tokens} o={d.overrides} set={set} reset={reset} />}
            {p.tab === "space" && tokens && base && <SpacePanel tokens={tokens} agent={base.tokens} o={d.overrides} set={set} reset={reset} />}
          </div>
        )}
      </div>
    </aside>
  );
}

function ContractWarning({ design }: { design: DesignMeta }) {
  const s = useStudio();
  return (
    <div className="contract-warn">
      <p>
        This page wasn’t set on the token contract, so these controls may barely move it.
      </p>
      <button
        className="btn"
        disabled={design.status === "generating" || !s.providers[providerOf(design)].status?.authenticated}
        onClick={() =>
          s.revise(
            design.id,
            "Rebuild this page on the Design Gravity token contract: declare all --dg-* tokens on :root and drive every colour, font, size, spacing value and radius through them. Keep the design visually identical.",
          )
        }
      >
        Ask the agent to rebuild on tokens
      </button>
    </div>
  );
}

// ---- Token panels ---------------------------------------------------------

interface PanelProps {
  tokens: Tokens;
  agent: Tokens;
  o: TokenOverrides;
  set(p: TokenOverrides): void;
  reset(keys: (keyof Tokens)[]): void;
}

function PanelHead({ title, dirty, onReset }: { title: string; dirty: boolean; onReset(): void }) {
  return (
    <div className="panel-head">
      <h3 className="panel-title">{title}</h3>
      {dirty && (
        <button className="link" onClick={onReset}>
          Back to the agent’s values
        </button>
      )}
    </div>
  );
}

function useGoogleFont(stack: string) {
  useEffect(() => {
    const fam = primaryFamily(stack);
    if (!CURATED_FONTS.some((f) => f.family === fam)) return;
    const id = "gf-" + fam.replace(/\s+/g, "-");
    if (document.getElementById(id)) return;
    const link = Object.assign(document.createElement("link"), {
      id,
      rel: "stylesheet",
      href: `https://fonts.googleapis.com/css2?family=${fam.replace(/\s+/g, "+")}:wght@400..800&display=swap`,
    });
    document.head.appendChild(link);
  }, [stack]);
}

function FontPicker(props: { id: string; label: string; value: string; agent: string; onPick(stack: string): void; role: "display" | "text" }) {
  const fam = primaryFamily(props.value);
  const agentFam = primaryFamily(props.agent);
  const list = CURATED_FONTS.filter((f) => f.role === props.role || f.role === "both");
  const known = fam === agentFam || list.some((f) => f.family === fam);
  useGoogleFont(props.value);
  return (
    <div className="font-picker">
      <label className="field-label" htmlFor={props.id}>{props.label}</label>
      <Dropdown
        id={props.id}
        label={props.label}
        value={fam === agentFam ? "__agent" : known ? fam : "__custom"}
        onChange={(v) => {
          if (v === "__agent") props.onPick(props.agent);
          else if (v !== "__custom") props.onPick(list.find((f) => f.family === v)!.stack);
        }}
        options={[
          { value: "__agent", label: agentFam, hint: "Agent’s choice", style: { fontFamily: props.agent } },
          ...list.filter((f) => f.family !== agentFam).map((f) => ({ value: f.family, label: f.family, style: { fontFamily: f.stack } })),
          ...(known ? [] : [{ value: "__custom", label: fam, style: { fontFamily: props.value } }]),
        ]}
      />
      <p className={"specimen" + (props.role === "text" ? " specimen-text" : "")} style={{ fontFamily: props.value }}>
        {props.role === "display" ? "Handgloves 1984" : "The quick brown fox jumps over the lazy dog, 1234567890."}
      </p>
    </div>
  );
}

function TypePanel({ tokens, agent, o, set, reset }: PanelProps) {
  // One stylesheet for every curated family, so the menus preview each face.
  useEffect(() => {
    if (document.getElementById("gf-curated")) return;
    const q = CURATED_FONTS.map((f) => "family=" + f.family.replace(/\s+/g, "+")).join("&");
    document.head.appendChild(
      Object.assign(document.createElement("link"), {
        id: "gf-curated",
        rel: "stylesheet",
        href: `https://fonts.googleapis.com/css2?${q}&display=swap`,
      }),
    );
  }, []);
  return (
    <div className="panel">
      <PanelHead
        title="Type"
        dirty={o.fontDisplay !== undefined || o.fontBody !== undefined || o.scale !== undefined}
        onReset={() => reset(["fontDisplay", "fontBody", "scale"])}
      />
      <FontPicker id="font-display" label="Display face" role="display" value={tokens.fontDisplay} agent={agent.fontDisplay} onPick={(v) => set({ fontDisplay: v === agent.fontDisplay ? undefined : v })} />
      <FontPicker id="font-body" label="Text face" role="text" value={tokens.fontBody} agent={agent.fontBody} onPick={(v) => set({ fontBody: v === agent.fontBody ? undefined : v })} />
      <Slider id="scale" label="Type scale" min={0.75} max={1.5} step={0.05} value={tokens.scale} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => set({ scale: v })} />
      <p className="panel-note">Scale multiplies every size the agent set, so the hierarchy keeps its proportions.</p>
    </div>
  );
}

const COLOURS: { key: keyof Tokens; label: string; note: string }[] = [
  { key: "paper", label: "Paper", note: "Page ground" },
  { key: "ink", label: "Ink", note: "Primary text" },
  { key: "muted", label: "Muted", note: "Secondary text" },
  { key: "surface", label: "Surface", note: "Panels and fills" },
  { key: "accent", label: "Accent", note: "The one highlight" },
];

function toHex(value: string): string {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return "#000000";
  ctx.fillStyle = "#000";
  ctx.fillStyle = value;
  const v = ctx.fillStyle;
  if (v.startsWith("#")) return v;
  const m = v.match(/\d+(\.\d+)?/g);
  if (!m) return "#000000";
  return "#" + m.slice(0, 3).map((n) => Math.round(+n).toString(16).padStart(2, "0")).join("");
}

function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) =>
      v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [x, y] = [lum(toHex(a)), lum(toHex(b))].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

function ColourPanel({ tokens, o, set, reset }: PanelProps) {
  const ratio = contrast(tokens.ink, tokens.paper);
  const mutedRatio = contrast(tokens.muted, tokens.paper);
  return (
    <div className="panel">
      <PanelHead title="Colour" dirty={COLOURS.some((c) => o[c.key] !== undefined)} onReset={() => reset(COLOURS.map((c) => c.key))} />
      <ul className="swatch-list">
        {COLOURS.map((c) => {
          const v = String(tokens[c.key]);
          const hex = toHex(v);
          return (
            <li key={c.key} className="swatch-row">
              <ColorPicker value={hex} label={c.label} onChange={(h) => set({ [c.key]: h })} />
              <span className="swatch-name">
                {c.label}
                <span className="swatch-note">{c.note}</span>
              </span>
              <HexInput value={hex} onCommit={(h) => set({ [c.key]: h })} label={`${c.label} hex`} />
              {o[c.key] !== undefined && <span className="edited" title="Edited by you" aria-label="Edited" />}
            </li>
          );
        })}
      </ul>
      <dl className="contrast">
        <dt>Ink on paper</dt>
        <dd className={ratio < 4.5 ? "is-bad" : ""}>{ratio.toFixed(1)} : 1{ratio < 4.5 && " · below 4.5"}</dd>
        <dt>Muted on paper</dt>
        <dd className={mutedRatio < 4.5 ? "is-bad" : ""}>{mutedRatio.toFixed(1)} : 1{mutedRatio < 4.5 && " · below 4.5"}</dd>
      </dl>
    </div>
  );
}

function HexInput({ value, onCommit, label }: { value: string; onCommit(v: string): void; label: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    const t = text.trim().startsWith("#") ? text.trim() : "#" + text.trim();
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(t)) onCommit(t.toLowerCase());
    else setText(value);
  };
  return (
    <input
      className="input hex mono"
      aria-label={label}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      spellCheck={false}
    />
  );
}

function SpacePanel({ tokens, o, set, reset }: PanelProps) {
  return (
    <div className="panel">
      <PanelHead title="Space" dirty={o.radius !== undefined || o.space !== undefined} onReset={() => reset(["radius", "space"])} />
      <Slider id="space" label="Spacing unit" min={2} max={16} step={1} value={tokens.space} format={(v) => `${v}px`} onChange={(v) => set({ space: v })} />
      <div className="space-demo" aria-hidden style={{ gap: tokens.space }}>
        {[1, 2, 3].map((n) => (
          <span key={n} style={{ padding: tokens.space, borderRadius: tokens.radius }} />
        ))}
      </div>
      <Slider id="radius" label="Corner radius" min={0} max={40} step={1} value={tokens.radius} format={(v) => `${v}px`} onChange={(v) => set({ radius: v })} />
      <p className="panel-note">Every margin, gap and padding on the page is a multiple of the spacing unit.</p>
    </div>
  );
}

function Slider(props: {
  id: string; label: string; min: number; max: number; step: number; value: number;
  format(v: number): string; onChange(v: number): void;
}) {
  return (
    <div className="slider">
      <div className="slider-head">
        <label className="field-label" htmlFor={props.id}>{props.label}</label>
        <output htmlFor={props.id} className="mono">{props.format(props.value)}</output>
      </div>
      <input
        id={props.id}
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(parseFloat(e.target.value))}
        style={{ ["--fill" as string]: `${((props.value - props.min) / (props.max - props.min)) * 100}%` }}
      />
    </div>
  );
}
