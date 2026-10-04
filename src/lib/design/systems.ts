// Design systems: questionnaire schema, agent prompts and spec parsing.
import type { Provider } from "../types";

export type SystemStatus = "draft" | "generating" | "ready" | "failed";

export interface QuestionOption {
  id: string;
  label: string;
  hint?: string;
  /** Palette questions: 4 to 6 hex colours that show the direction. */
  swatches?: string[];
  /** Type questions: Google Fonts families for display and body. */
  display?: string;
  body?: string;
}

export interface Question {
  id: string;
  title: string;
  why?: string;
  multi: boolean;
  visual: "palette" | "type" | "shape" | "density" | "text";
  options: QuestionOption[];
}

export interface Questionnaire {
  name: string;
  questions: Question[];
}

export interface SystemTurn {
  id: string;
  kind: "generate" | "revise";
  text: string;
  at: number;
  outcome?: "done" | "failed" | "cancelled";
  reply?: string;
}

export interface SystemMeta {
  id: string;
  name: string;
  brief: string;
  summary?: string;
  status: SystemStatus;
  /** False until the user approves it in review; drafts stay out of the picker. */
  saved: boolean;
  createdAt: number;
  updatedAt: number;
  conversationId?: string;
  /** Harness that owns `conversationId`; absent means Antigravity. */
  provider?: Provider;
  questionnaire?: Questionnaire;
  answers?: Record<string, string[]>;
  turns: SystemTurn[];
  swatches?: string[];
  fonts?: string;
  error?: string;
  /** How it started: a questionnaire, or references it was extracted from. */
  source?: "questions" | "reference";
}

export interface SystemSpec {
  name?: string;
  summary?: string;
  colors?: {
    light?: Record<string, string>;
    dark?: Record<string, string> | null;
  };
  typography?: {
    display?: { family?: string };
    body?: { family?: string };
    mono?: { family?: string } | null;
    scale?: { name: string; size: number; lineHeight?: number; weight?: number }[];
  };
  radius?: Record<string, number>;
  spacing?: { base?: number; scale?: number[] };
  shadows?: Record<string, string>;
  motion?: { duration?: string; easing?: string };
  components?: string[];
}

export function parseSpec(raw?: string | null): SystemSpec | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Five colours that stand for the system in lists. */
export function swatchesOf(spec: SystemSpec | null): string[] {
  const c = spec?.colors?.light ?? spec?.colors?.dark ?? {};
  const order = ["background", "surface", "text", "primary", "accent", "muted", "border"];
  const picked = order.map((k) => c[k]).filter(Boolean);
  const rest = Object.values(c).filter((v) => !picked.includes(v));
  return [...picked, ...rest].filter((v) => typeof v === "string" && v.startsWith("#")).slice(0, 5);
}

export const fontsOf = (spec: SystemSpec | null) =>
  [spec?.typography?.display?.family, spec?.typography?.body?.family].filter(Boolean).join(" / ");

// ---- Questionnaire -----------------------------------------------------------

export const QUESTION_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          why: { type: "string" },
          multi: { type: "boolean" },
          visual: { type: "string", enum: ["palette", "type", "shape", "density", "text"] },
          options: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                label: { type: "string" },
                hint: { type: "string" },
                swatches: { type: "array", items: { type: "string" } },
                display: { type: "string" },
                body: { type: "string" },
              },
              required: ["id", "label"],
            },
          },
        },
        required: ["id", "title", "multi", "visual", "options"],
      },
    },
  },
  required: ["name", "questions"],
};

export function questionsPrompt(brief: string): string {
  return `You are a senior design-systems lead helping a designer start a design system. They answer your questionnaire only by picking options, so every option has to be a real, good choice for this product; generic options make a generic system.

Product: ${brief.trim() || "(not described; keep the options broad and distinct)"}

Answer directly in this reply with only a JSON object. You have everything you need here, so answer without using tools, reading files or running commands:
- name: a short working name for the system, one or two words, without "Design System".
- questions: exactly these 8, in this order, each tailored to the product:
  1. id "personality", visual "text", multi true, 5 options: character adjectives for the brand.
  2. id "theme", visual "text", multi false, 3 options: light, dark, or both.
  3. id "palette", visual "palette", multi false, 4 options. Each option has "swatches": exactly 5 hex colours in the order background, surface, text, primary, accent, forming an accessible palette (text on background at least 4.5:1). Four genuinely different directions, not four shades of one idea.
  4. id "typography", visual "type", multi false, 4 options. Each option has "display" and "body": real Google Fonts family names that pair well. The label names the pairing's character.
  5. id "shape", visual "shape", multi false, 4 options from sharp to fully rounded; hint gives the radius in px, e.g. "4px".
  6. id "density", visual "density", multi false, 3 options: compact, comfortable, spacious; hint gives the base spacing unit, e.g. "8px base".
  7. id "depth", visual "text", multi false, 4 options: flat with borders, soft shadows, layered elevation, bold outlines.
  8. id "components", visual "text", multi true, 8 options: the component groups this product needs first.
- Every question has title (a plain question, under 60 characters) and why (one short sentence on what it decides). Every option has id (snake_case), label (under 28 characters) and hint (under 60 characters).

The bar for tailoring, for a budgeting app used by young families:
- Weak palette label: "Modern Blue". Strong: "Kitchen-table calm", warm paper with a sage primary.
- Weak type pairing: Inter + Inter. Strong: "Friendly ledger", Fraunces over Public Sans, with tabular figures that suit money.`;
}

// ---- Generation ----------------------------------------------------------------

const SPEC_SHAPE = `{
  "name": string, "summary": string (one sentence),
  "colors": {
    "light": { "background","surface","surfaceAlt","text","muted","border","primary","primaryText","accent","success","warning","danger","focus": hex },
    "dark": same keys, or null
  },
  "typography": {
    "display": { "family": string, "weights": number[] },
    "body": { "family": string, "weights": number[] },
    "mono": { "family": string } or null,
    "scale": [ { "name": "display|h1|h2|h3|body|small|caption", "size": number, "lineHeight": number (unitless), "weight": number, "tracking": number (em) } ]
  },
  "radius": { "sm","md","lg","full" },
  "spacing": { "base": number, "scale": number[] },
  "shadows": { "sm","md","lg": CSS box-shadow strings },
  "motion": { "duration": string, "easing": string },
  "components": string[]
}`;

export function generatePrompt(meta: SystemMeta): string {
  const q = meta.questionnaire?.questions ?? [];
  const answers = q
    .map((question) => {
      const picked = (meta.answers?.[question.id] ?? [])
        .map((id) => question.options.find((o) => o.id === id))
        .filter(Boolean)
        .map((o) => {
          const extra = o!.swatches?.length ? ` [${o!.swatches.join(", ")}]` : o!.display ? ` [${o!.display} + ${o!.body}]` : "";
          return `${o!.label}${o!.hint ? ` (${o!.hint})` : ""}${extra}`;
        });
      return `- ${question.title}: ${picked.length ? picked.join("; ") : "no preference; decide what serves the product"}`;
    })
    .join("\n");

  return `You are a senior design-systems lead inside Design Gravity. Build the design system "${meta.name}" so that every design generated from it later looks unmistakably like one product. Work only in the current workspace folder and do not run shell commands.

Product: ${meta.brief.trim() || "(not described)"}

The designer's choices. Treat them as decisions, and fill every gap with judgment that fits them:
${answers}

${THREE_FILES}`;
}

/** The files every system run writes, and the reply that closes it. */
const THREE_FILES = `Write exactly these three files.

1. system.json: the tokens. Strict JSON, no comments, exactly this shape; every colour is a 6-digit hex and numbers are px unless noted.
${SPEC_SHAPE}
Contrast: text on background, text on surface and primaryText on primary each reach at least 4.5:1.

2. DESIGN.md: the rules another designer, or an agent, follows to design with this system. Cover 3 to 5 principles; each colour role and when to use it; the type pairing, why it fits and how the scale is used; spacing and layout grid; shape and elevation; and for each component group its anatomy, variants and states (default, hover, focus, active, disabled, error, loading), with short do/don't notes. Keep it specific: a rule that could sit in any system's docs adds nothing.

3. preview.html: one self-contained specimen page that shows the system at work. Inline CSS only, Google Fonts via <link>, no scripts, no external images. Declare the tokens as CSS custom properties named after the system.json roles and build everything from them, so the page is a faithful picture of system.json. Show the palette with role names and hex values, the type scale in real words, spacing and radius samples, and every component group in all its states, on a clear grid with section titles. If there is a dark theme, add a dark section.

Then reply to the designer in two or three plain sentences: the system's character and the choices that define it. They read this in a chat, so leave out files, paths and code.`;

/**
 * Build a system from what already exists: screenshots, files, one of the
 * designer's designs, or a live page. The references are in refs/.
 */
export function extractPrompt(meta: SystemMeta, refs: string[], url?: string): string {
  const list = [...refs.map((r) => `- ${r}`), ...(url ? [`- The live page at ${url}`] : [])].join("\n");
  return `You are a senior design-systems lead inside Design Gravity. The designer wants a design system that captures the visual language of something that already exists, so that every new design made with it looks like it belongs next to the original. Work only in the current workspace folder and do not run shell commands.

What it's for: ${meta.brief.trim() || "(not described; infer it from the references)"}

## References
${list}
Open every reference before writing anything. From screenshots and images, read colours, type, spacing, corner shapes, elevation and component styling as precisely as you can; from HTML and CSS files, read the actual values.${url ? " Open the live page with your web tool if you have one; if you can't reach it, work from the other references and say so in your reply." : ""}

Extract rather than invent: every token should trace back to something you saw. Where the references are silent (for example, no error state is shown), extend the system in the same spirit and mark it as an extension in DESIGN.md. Name the fonts you recognise; when a face isn't on Google Fonts, use the closest Google Fonts family and say in DESIGN.md which face it stands in for. In system.json, "name" is a short name for the system (one or two words) and "components" lists the component groups you found.

${THREE_FILES}`;
}

export function revisePrompt(feedback: string): string {
  return `The designer reviewed the design system and asks for these changes:

${feedback.trim()}

Read system.json, DESIGN.md and preview.html in this folder, apply the changes, and update all three so they still agree with each other. Keep everything the feedback doesn't touch. Recheck contrast: text on background and on surface, and primaryText on primary, at least 4.5:1. Do not run shell commands.

Reply in two or three plain sentences on what changed and why it works. Leave out files, paths and code.`;
}

export const REVIEW_TWEAKS = [
  "Warmer colours",
  "Cooler colours",
  "More contrast",
  "Softer, quieter palette",
  "A different type pairing",
  "More rounded",
  "Sharper corners",
  "More compact",
  "More spacious",
  "Add a dark theme",
  "Stronger elevation",
  "Flatter, fewer shadows",
];

// ---- Using a system in a design -------------------------------------------------

const SERIFS = /serif|garamond|fraunces|playfair|lora|merriweather|baskerville|caslon|literata|newsreader|crimson|spectral|bodoni|cormorant/i;

/** A CSS font stack for a family, with a fallback of the right kind. */
function stack(family: string | undefined, fallback = "system-ui, sans-serif"): string | undefined {
  if (!family) return undefined;
  const generic = SERIFS.test(family) && !/sans/i.test(family) ? "Georgia, serif" : fallback;
  return `"${family}", ${generic}`;
}

const px = (n?: number) => (typeof n === "number" ? `${n}px` : undefined);

/**
 * The system's tokens mapped onto the app's --dg-* contract, as a literal
 * :root block the agent copies verbatim. Mapping here, instead of asking the
 * agent to translate system.json itself, is what keeps designs on-system.
 */
export function systemRoot(spec: SystemSpec, theme: "light" | "dark" = "light"): string | null {
  const c = theme === "dark" ? spec.colors?.dark : spec.colors?.light;
  if (!c) return null;
  const t = spec.typography;
  const r = spec.radius ?? {};
  const decls: [string, string | number | undefined][] = [
    ["--dg-paper", c.background],
    ["--dg-ink", c.text],
    ["--dg-muted", c.muted],
    ["--dg-surface", c.surface],
    ["--dg-accent", c.primary],
    ["--dg-font-display", stack(t?.display?.family)],
    ["--dg-font-body", stack(t?.body?.family)],
    ["--dg-scale", 1],
    ["--dg-radius", px(r.md)],
    ["--dg-space", px(spec.spacing?.base)],
    ["--dg-surface-alt", c.surfaceAlt],
    ["--dg-border", c.border],
    ["--dg-on-accent", c.primaryText],
    ["--dg-accent-2", c.accent],
    ["--dg-success", c.success],
    ["--dg-warning", c.warning],
    ["--dg-danger", c.danger],
    ["--dg-focus", c.focus],
    ["--dg-font-mono", stack(t?.mono?.family, "ui-monospace, monospace")],
    ["--dg-radius-sm", px(r.sm)],
    ["--dg-radius-lg", px(r.lg)],
    ["--dg-shadow-sm", spec.shadows?.sm],
    ["--dg-shadow-md", spec.shadows?.md],
    ["--dg-shadow-lg", spec.shadows?.lg],
  ];
  const lines = decls.filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `  ${k}: ${v};`);
  return `:root {\n${lines.join("\n")}\n}`;
}

/** The system's type scale, one role per line, for the prompt. */
export function systemScale(spec: SystemSpec): string | null {
  const scale = spec.typography?.scale;
  if (!scale?.length) return null;
  return scale
    .map((s) => `  ${s.name}: ${s.size}px${s.lineHeight ? ` / ${s.lineHeight}` : ""}${s.weight ? `, weight ${s.weight}` : ""}`)
    .join("\n");
}
