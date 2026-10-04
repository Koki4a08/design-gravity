import type { Attachment, DesignKind, FramePreset, NoteTarget } from "./types";
import { systemRoot, systemScale } from "./systems";
import type { SystemSpec } from "./systems";
import { ENTRY } from "./projectFiles";

const DATA_FILE = /\.(csv|tsv|json)$/i;

function attachmentNote(files?: Attachment[]): string {
  if (!files?.length) return "";
  const list = files.map((f) => `- ${f.path}`).join("\n");
  const data = files.some((f) => DATA_FILE.test(f.name))
    ? `
Data files (.csv, .tsv, .json) are the designer's real data. Build the design from them: their actual columns, rows, labels and values. When there are more rows than fit, show a representative slice and say how many there are in total; compute any totals, averages or trends from the data itself. Never replace real values with invented ones.`
    : "";
  return `

## Attached by the designer
${list}
Open each file before you start. Images are visual references for layout, colour, type and mood unless the note asks to place them; to place one, use exactly its relative path (e.g. <img src="attachments/photo.jpg">) and the app resolves it.${data}`;
}

/** What each variant leans towards, so parallel runs don't converge on one layout. */
const VARIANT_LENSES = [
  "the clearest, most direct strong answer to the brief",
  "a bolder, editorial take: stronger type contrast, an asymmetric grid, one confident focal point",
  "an unexpected structure: organise the content around a different idea than the obvious one, such as a timeline, a comparison or a single oversized element",
  "the quietest version: maximum restraint, generous space, as few elements as the job allows",
];

function variantSection(v: { index: number; count: number }): string {
  const letter = String.fromCharCode(65 + v.index);
  return `
## Variant ${letter} of ${v.count}
The designer asked for ${v.count} alternatives to this brief, made separately and compared side by side. Make this one a real alternative, not a small tweak: aim for ${VARIANT_LENSES[v.index % VARIANT_LENSES.length]}. Brief, content and visual language stay the same; composition, hierarchy and layout are where the variants differ.
`;
}

function flowSection(f: { index: number; refs: string[] }): string {
  return `
## Screen ${f.index + 1} of a flow
This screen belongs to the same product as the earlier ${f.refs.length > 1 ? "screens" : "screen"}: ${f.refs.join(", ")}. Open ${f.refs.length > 1 ? "them" : "it"} first. Reuse their header, navigation, footer, components, spacing and type exactly, so the screens read as one product in sequence; only the content and layout that this screen's job needs are new.
`;
}

export interface KindDef {
  id: DesignKind;
  label: string;
  plural: string;
  /** A few words under the illustration in the type menu. */
  description: string;
  /** What the agent writes: a React project rooted at app/page.tsx, or one SVG. */
  file: typeof ENTRY | "design.svg";
  frames: FramePreset[];
  /** Thumbnails: crop a scrolling page from the top, or show a fixed canvas whole. */
  fit: "cover" | "contain";
  placeholder: string;
  samples: string[];
  deliverable(frame: FramePreset): string;
}

/** The project layout every screen and mockup is written in. */
const PROJECT_FILES = `\`\`\`
/app
  page.tsx
/components
  Navbar.tsx
  Hero.tsx
  Features.tsx
  Pricing.tsx
/styles
  globals.css
\`\`\``;

const PROJECT_RULES = `Write the design as a small React + TypeScript project in exactly this layout (the component names are an example; name one component per real section of this design):
${PROJECT_FILES}
- \`app/page.tsx\` default-exports the page component. It imports \`../styles/globals.css\` and composes the sections from \`../components/…\` in order; it holds no styling of its own.
- \`components/\` has one file per section (e.g. Navbar, Hero, Features, Pricing, Footer), PascalCase, each a typed function component with a default export. Repeated parts (cards, rows, plans) are small typed components or mapped arrays with the real copy.
- \`styles/globals.css\` holds all CSS: Google Fonts \`@import url(...)\` first, then the :root tokens, then class-based rules. Components use \`className\` only: no inline styles, no CSS modules, no Tailwind.
- Import only \`react\` and files inside the project: no other packages, no next/font, no icon libraries. Icons and imagery are inline SVG in JSX or CSS.
- The page is rendered statically: no data fetching, effects, timers or browser APIs; any state is shown at its initial value. No app/layout.tsx; the app supplies <html> and <body>, so style html and body from globals.css.`;

/** Every kind of design the app can make. Add new kinds here. */
export const KINDS: KindDef[] = [
  {
    id: "screen",
    label: "Screen",
    plural: "Screens",
    description: "A web page or app screen",
    file: ENTRY,
    fit: "cover",
    frames: [
      { id: "desktop", label: "Desktop", width: 1440, height: 900, group: "Desktop" },
      { id: "desktop-hd", label: "Desktop HD", width: 1920, height: 1080, group: "Desktop" },
      { id: "desktop-wide", label: "Wide 2K", width: 2560, height: 1440, group: "Desktop" },
      { id: "macbook-air", label: "MacBook Air", width: 1280, height: 832, group: "Desktop" },
      { id: "laptop", label: "Laptop", width: 1280, height: 800, group: "Desktop" },
      { id: "macbook-pro", label: "MacBook Pro 14", width: 1512, height: 982, group: "Desktop" },
      { id: "ipad-pro", label: "iPad Pro 13", width: 1032, height: 1376, group: "Tablet" },
      { id: "tablet", label: "Tablet", width: 834, height: 1112, group: "Tablet" },
      { id: "ipad-air", label: "iPad Air", width: 820, height: 1180, group: "Tablet" },
      { id: "ipad-mini", label: "iPad mini", width: 744, height: 1133, group: "Tablet" },
      { id: "tablet-landscape", label: "Tablet landscape", width: 1194, height: 834, group: "Tablet" },
      { id: "iphone-pro-max", label: "iPhone 16 Pro Max", width: 440, height: 956, group: "Phone" },
      { id: "iphone-pro", label: "iPhone 16 Pro", width: 402, height: 874, group: "Phone" },
      { id: "phone", label: "Phone", width: 390, height: 844, group: "Phone" },
      { id: "iphone-se", label: "iPhone SE", width: 375, height: 667, group: "Phone" },
      { id: "pixel", label: "Pixel 9", width: 412, height: 923, group: "Phone" },
      { id: "android-small", label: "Android small", width: 360, height: 800, group: "Phone" },
      { id: "watch", label: "Watch", width: 205, height: 251, group: "Other" },
      { id: "tv", label: "TV 1080p", width: 1920, height: 1080, group: "Other" },
    ],
    placeholder: "A pricing page for a letterpress studio that rents press time by the day…",
    samples: [
      "Pricing page for a letterpress studio in Lisbon that rents press time by the day",
      "Settings screen for a field-recording app: storage, input gain, file naming",
      "Timetable page for a night-train operator between Vienna and Venice",
    ],
    deliverable: (f) =>
      `${PROJECT_RULES}

It is one screen designed for a ${f.width}×${f.height} viewport (${f.label}): it must look right at exactly that width and may scroll vertically when the content needs it.`,
  },
  {
    id: "mockup",
    label: "UI Mockup",
    plural: "Mockups",
    description: "Screens shown in devices",
    file: ENTRY,
    fit: "contain",
    frames: [
      { id: "shot", label: "Shot 4:3", width: 1600, height: 1200, group: "Presentation" },
      { id: "wide", label: "Wide 16:9", width: 1920, height: 1080, group: "Presentation" },
      { id: "wide-4k", label: "Wide 4K", width: 3840, height: 2160, group: "Presentation" },
      { id: "square", label: "Square", width: 1200, height: 1200, group: "Presentation" },
      { id: "portrait", label: "Portrait 4:5", width: 1080, height: 1350, group: "Presentation" },
      { id: "ultrawide", label: "Ultrawide 21:9", width: 2520, height: 1080, group: "Presentation" },
      { id: "dribbble", label: "Dribbble", width: 1600, height: 1200, group: "Showcase" },
      { id: "behance", label: "Behance", width: 1400, height: 1050, group: "Showcase" },
      { id: "product-hunt", label: "Product Hunt", width: 1270, height: 760, group: "Showcase" },
      { id: "app-store", label: "App Store", width: 1290, height: 2796, group: "Showcase" },
      { id: "og", label: "Link preview", width: 1200, height: 630, group: "Social" },
      { id: "x-post", label: "X post", width: 1600, height: 900, group: "Social" },
      { id: "linkedin", label: "LinkedIn post", width: 1200, height: 627, group: "Social" },
      { id: "insta-story", label: "Story 9:16", width: 1080, height: 1920, group: "Social" },
    ],
    placeholder: "A banking app for freelancers: phone home screen and a laptop dashboard…",
    samples: [
      "Banking app for freelancers: phone home screen with invoices beside a laptop dashboard",
      "Onboarding flow for a recipe app, three phone screens side by side",
      "Monitoring dashboard for a solar farm in a browser window, with a phone companion",
    ],
    deliverable: (f) =>
      `${PROJECT_RULES}

The page presents the product on a fixed ${f.width}×${f.height} canvas (${f.label}): body is exactly that size with overflow hidden; nothing scrolls. Name the components for what they draw (e.g. PhoneFrame, BrowserFrame, HomeScreen, Dashboard, Caption).
Inside it, show one to three real product screens, each in a device drawn with CSS or inline SVG (a phone with bezel and status bar, a browser window with toolbar, or a laptop) chosen for where the product actually lives. Give one device the lead and let the others support it through scale, overlap and soft shadows, with every device fully inside the canvas. The screens are legible, detailed interfaces with real copy and data, components that match across screens, and true device proportions (a phone screen is about 390×844). The canvas behind them is a calm ground made from the tokens, optionally with the product name and a one-line caption. Imagery is inline SVG or CSS.`,
  },
  {
    id: "graphic",
    label: "Graphic",
    plural: "Graphics",
    description: "Posters, cards and labels",
    file: "design.svg",
    fit: "contain",
    frames: [
      { id: "portrait", label: "Portrait 4:5", width: 1080, height: 1350, group: "Social" },
      { id: "square", label: "Square", width: 1080, height: 1080, group: "Social" },
      { id: "story", label: "Story 9:16", width: 1080, height: 1920, group: "Social" },
      { id: "landscape", label: "Landscape 16:9", width: 1600, height: 900, group: "Social" },
      { id: "og", label: "Link preview", width: 1200, height: 630, group: "Social" },
      { id: "linkedin", label: "LinkedIn post", width: 1200, height: 627, group: "Social" },
      { id: "youtube", label: "YouTube thumbnail", width: 1280, height: 720, group: "Social" },
      { id: "fb-cover", label: "Facebook cover", width: 1640, height: 624, group: "Social" },
      { id: "x-header", label: "X header", width: 1500, height: 500, group: "Social" },
      { id: "a-poster", label: "Poster A2", width: 1190, height: 1684, group: "Print" },
      { id: "a3", label: "A3", width: 842, height: 1191, group: "Print" },
      { id: "a4", label: "A4", width: 595, height: 842, group: "Print" },
      { id: "a5", label: "A5", width: 420, height: 595, group: "Print" },
      { id: "letter", label: "US Letter", width: 612, height: 792, group: "Print" },
      { id: "tabloid", label: "Tabloid", width: 792, height: 1224, group: "Print" },
      { id: "business-card", label: "Business card", width: 1050, height: 600, group: "Print" },
      { id: "postcard", label: "Postcard", width: 1800, height: 1200, group: "Print" },
      { id: "label", label: "Round label", width: 1000, height: 1000, group: "Print" },
      { id: "app-icon", label: "App icon", width: 1024, height: 1024, group: "Brand" },
      { id: "logo", label: "Logo mark", width: 800, height: 800, group: "Brand" },
      { id: "banner", label: "Web banner", width: 1456, height: 180, group: "Brand" },
      { id: "email-header", label: "Email header", width: 1200, height: 400, group: "Brand" },
    ],
    placeholder: "A poster for a typography lecture series, six Thursday evenings…",
    samples: [
      "Poster for a typography lecture series, six Thursday evenings in November",
      "Label for a small-batch hot sauce made with smoked Bulgarian peppers",
      "Announcement card for a neighbourhood bike repair café, every first Saturday",
    ],
    deliverable: (f) =>
      `Write one file, \`design.svg\`: a standalone SVG with width="${f.width}" height="${f.height}" viewBox="0 0 ${f.width} ${f.height}" and xmlns="http://www.w3.org/2000/svg". All styling lives in one <style> element inside the SVG (there, :root targets the <svg> element; fonts load with @import from Google Fonts). Text stays live <text>, never outlined, and everything is drawn as vector with no external images.`,
  },
];

export const kindOf = (id: DesignKind): KindDef => KINDS.find((k) => k.id === id) ?? KINDS[0];

export const artifactName = (kind: DesignKind) => kindOf(kind).file;

/** The ten tokens the app edits live (Type, Colour, Space panels). */
const TOKEN_LIST = `  --dg-paper         page background
  --dg-ink           primary text and strokes
  --dg-muted         secondary text
  --dg-surface       panels and fills
  --dg-accent        the accent colour and primary action
  --dg-font-display  heading font-family stack
  --dg-font-body     body font-family stack
  --dg-scale         unitless type multiplier, always 1
  --dg-radius        corner radius, e.g. 6px
  --dg-space         base spacing unit, e.g. 8px`;

/** How the tokens must be used, so the app's live edits restyle the whole design. */
const TOKEN_USAGE = `Drive the whole design from these variables, because the designer restyles it live by editing them: every colour is var(--dg-…) (color-mix() between them is fine for tints and hover states), every font-family is a font token, every font-size is calc(<px> * var(--dg-scale)), every padding, margin and gap is calc(var(--dg-space) * n), and every border-radius is a radius token (999px is fine for pills). Nothing visual is hard-coded outside :root.`;

function tokenContract(system?: SystemSpec): string {
  if (system && systemRoot(system)) {
    return `## Token contract (required)
Declare the design system's :root block exactly as given above, then:
${TOKEN_USAGE}`;
  }
  const source = system ? "with the design system's values, mapped as described above" : "with values you choose for this brief";
  return `## Token contract (required)
Declare these custom properties on :root, ${source}:
${TOKEN_LIST}
${TOKEN_USAGE}`;
}

/** The chosen system as hard constraints: literal token values plus where to read its rules. */
function systemSection(system: SystemSpec): string {
  const light = systemRoot(system, "light");
  const dark = systemRoot(system, "dark");
  const scale = systemScale(system);
  const name = system.name ? `"${system.name}"` : "the chosen system";
  return `## Design system: ${name} (the authority on visual language)
The designer chose this design system. It decides colour, type, shape, spacing, elevation and how components look; the brief decides content, structure and layout. A design that ignores it is wrong even if it looks good.

Before designing, read design-system/DESIGN.md (principles, colour roles, component anatomy and states) and open design-system/preview.html (what the components look like in practice). Build buttons, inputs, cards, navigation and every other component the way they are specified and shown there.
${
  light
    ? `
Copy this :root block into the design verbatim. It is the system's tokens already mapped to the app's variables; do not change, drop or re-derive any value:
\`\`\`css
${light}
\`\`\`${
        dark
          ? `
If the brief asks for a dark interface, use the system's dark values instead:
\`\`\`css
${dark}
\`\`\``
          : ""
      }
The extra variables (--dg-border, --dg-on-accent, --dg-surface-alt, --dg-accent-2, the status colours, radii and shadows) are the system's remaining roles: use them for exactly those roles, e.g. text on an accent button is var(--dg-on-accent).`
    : `
Read the tokens from design-system/system.json and map them: paper = background, ink = text, muted, surface, accent = primary, font tokens = display and body families, radius = the md radius, space = the spacing base.`
}${
  scale
    ? `

Set type on the system's scale (multiply each size by var(--dg-scale)):
${scale}`
    : ""
}

If the brief asks for a colour, font or style the system doesn't have, stay within the system: use the closest role, and name the conflict in one sentence of your reply so the designer can decide.`;
}

const CRAFT = `## Quality bar
Design what a senior product designer would ship for this exact subject, not a template with the nouns swapped. Write real, specific copy from the brief; never lorem ipsum, placeholder brands, or invented testimonials and statistics presented as real.

The difference, for a letterpress studio's pricing page:
- Weak: a centred hero saying "Welcome to Our Studio", three identical icon cards, a blue-to-purple gradient.
- Strong: the headline "Book the press by the day", rates set like a type specimen, the most popular tier inverted in ink so the eye lands there first.

Typography carries the design: a clear scale with real contrast between roles, body at 16px or more with a comfortable measure, tabular figures for numbers. Give each view one focal point and one primary action, and let spacing do the grouping. Icons, when needed, are simple inline SVG with one stroke weight.`;

const CRAFT_FREE = `${CRAFT}
Choose a type pairing and palette that belong to this subject.`;

const CRAFT_SYSTEM = `${CRAFT}
Type, colour, shape and spacing come from the design system, so your craft goes into layout, hierarchy, copy and composition.`;

const REPLY_FORMAT = `## Reply
The designer reads your reply in a chat, so write like a design partner. Start with two or three sentences of plain prose: what you made or changed, and the one or two decisions that matter. Leave out files, paths, tools, tokens and code.
Then add exactly three lines, each starting with "NEXT: ", each a refinement specific to this design that the designer could ask for next, as an instruction under 60 characters, e.g. "NEXT: Make the headline twice as large".`;

const SCOPE = "Work only in the current workspace folder. Do not run shell commands or create any file other than the deliverable.";

export function firstBrief(opts: {
  brief: string;
  kind: DesignKind;
  frame: FramePreset;
  attachments?: Attachment[];
  system?: SystemSpec;
  /** One of several alternatives generated in parallel. */
  variant?: { index: number; count: number };
  /** A later screen of a flow; refs are the earlier screens copied into the workspace. */
  flow?: { index: number; refs: string[] };
}): string {
  const { brief, kind, frame, system } = opts;
  return `You are the designer inside Design Gravity, a studio app where a designer writes a brief and you turn it into a finished design they keep refining. ${SCOPE}

## Brief
${brief.trim()}${attachmentNote(opts.attachments)}
${opts.variant ? variantSection(opts.variant) : ""}${opts.flow ? flowSection(opts.flow) : ""}
## Deliverable
${kindOf(kind).deliverable(frame)}
${system ? `\n${systemSection(system)}\n` : ""}
${tokenContract(system)}

${system ? CRAFT_SYSTEM : CRAFT_FREE}

${REPLY_FORMAT}`;
}

export function revision(opts: {
  note: string;
  kind: DesignKind;
  /** The design is a project (app/page.tsx, components/, styles/) rather than one file. */
  project?: boolean;
  target?: NoteTarget;
  attachments?: Attachment[];
  system?: SystemSpec;
  /** Specifics behind the note, e.g. the audit's list of off-system declarations. */
  detail?: string;
}): string {
  const file = artifactName(opts.kind);
  const where = opts.target
    ? `The note is pinned to ${opts.target.snippet ? "this element" : `the element ${opts.target.label ? `“${opts.target.label}” ` : ""}`}(CSS path \`${opts.target.selector}\`)${
        opts.target.snippet
          ? `:
\`\`\`html
${opts.target.snippet}
\`\`\``
          : "."
      }
Change that element and whatever has to move with it; leave the rest of the design as it is.${opts.project ? " The path and markup come from the rendered page; find the component that renders it." : ""}`
    : "The note applies to the design as a whole.";
  const system = opts.system
    ? `

## Design system
This design follows the design system in design-system/ (DESIGN.md, system.json, preview.html). Keep the :root values and component styles on-system. When the note explicitly asks for something outside the system, do what the note asks for that one thing and keep everything else on-system.`
    : "";
  const source = opts.project
    ? "The design is the React project in this folder: `app/page.tsx`, the components in `components/` and `styles/globals.css`. Read the page, the components it uses and the stylesheet first; they may have changed since your last turn."
    : `The design is in \`${file}\`. Read the current file first; they may have edited it since your last turn.`;
  return `The designer left a note on the design. ${source} ${SCOPE}

## Note
${opts.note.trim()}${opts.detail ? `

${opts.detail.trim()}` : ""}${attachmentNote(opts.attachments)}

## Scope
${where}
${
  opts.project
    ? `Edit the files in place, keeping the same project layout and frame:
${PROJECT_FILES}
Add a component file only for a new section; keep all CSS in \`styles/globals.css\` and import only \`react\` and project files.`
    : `Edit \`${file}\` in place, keeping the same format and frame.`
}${system}

## Token contract (required)
Keep the --dg-* variables on :root and every var(--dg-…) usage, and use them for anything you add. Add a new variable only when no existing one fits.

${REPLY_FORMAT}`;
}


export function titleFromBrief(brief: string): string {
  const clean = brief.trim().replace(/\s+/g, " ").replace(/[.!?]+$/, "");
  const words = clean.split(" ");
  const short = words.slice(0, 7).join(" ");
  const title = words.length > 7 ? short + "…" : short;
  return title.charAt(0).toUpperCase() + title.slice(1);
}

/** Split the agent's reply into prose and its NEXT: suggestions. */
export function parseReply(text: string | undefined | null): { body: string; suggestions: string[] } {
  if (!text) return { body: "", suggestions: [] };
  const suggestions: string[] = [];
  const body: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*[-*]?\s*NEXT:\s*(.+)$/i);
    if (m) suggestions.push(m[1].trim().replace(/^["“]|["”]$/g, ""));
    else body.push(line);
  }
  return {
    body: body.join("\n").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").trim(),
    suggestions: suggestions.slice(0, 3),
  };
}

// ---- Critique ---------------------------------------------------------------------

export const CRITIQUE_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    notes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          selector: { type: "string" },
          label: { type: "string" },
          note: { type: "string" },
          severity: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["selector", "label", "note", "severity"],
      },
    },
  },
  required: ["summary", "notes"],
};

/** A design director's read of the current design, as notes pinned to elements. */
export function critiquePrompt(opts: { kind: DesignKind; brief: string; system?: boolean; project?: boolean }): string {
  const file = artifactName(opts.kind);
  return `You are a design director reviewing a design before the designer sees it. Your notes are pinned to elements on the page, and the designer can send each one to the design agent as-is, so every note must name a specific change.

The brief was: ${opts.brief.trim()}

${opts.project ? "Open the React project in this folder (`app/page.tsx`, every component it imports from `components/`, and `styles/globals.css`) and read it closely, as the page it renders:" : `Open \`${file}\` in this folder and read it closely:`} layout and hierarchy, typography, colour and contrast, copy, spacing, states and accessibility.${opts.system ? " The design follows the design system in design-system/; read design-system/DESIGN.md too and flag anything that breaks it." : ""} Read files with your file viewer only; don't run commands or edit anything.

Answer directly with only a JSON object:
- summary: one sentence, your overall verdict.
- notes: the 3 to 6 changes that would improve the design most, most important first. Each has:
  - selector: a CSS selector that matches the element in the ${opts.project ? "rendered page, built from the classNames, ids and tags the components actually output" : "file, built from the ids, classes and tags that are actually there"} (e.g. "section.plans > div.featured button").
  - label: the element in two to four words, e.g. "Hero headline".
  - note: one or two sentences with what is wrong and the exact change to make.
  - severity: high, medium or low.

The bar for a note:
- Weak: "Improve the typography."
- Strong: "The headline and the plan prices are the same size, so nothing leads; drop the prices to about 40px so the headline wins."`;
}

// ---- Standalone HTML export -------------------------------------------------------

/** Where the standalone build lands, relative to the design workspace. */
export const STANDALONE_FILE = "export/standalone.html";

/** Flatten the project into one HTML file a browser opens directly. */
export function standalonePrompt(): string {
  return `You are a senior front-end engineer. This folder holds a finished design written as a small React project: \`app/page.tsx\`, the components in \`components/\` and \`styles/globals.css\`. The designer wants it as one standalone HTML file.

## Task
Read \`app/page.tsx\`, every component it imports and \`styles/globals.css\`. Then write \`${STANDALONE_FILE}\`: a complete HTML document that renders exactly what the page renders.

## Rules
- Static semantic HTML with the components' real output: the same elements, classes, copy and inline SVG, in the same order. Turn \`className\` into \`class\` and JSX expressions into their values; mapped arrays become their repeated markup.
- All CSS from \`styles/globals.css\` goes into one <style> in <head>, unchanged, including its Google Fonts @import and the :root tokens.
- No scripts, no React, no build step, and no external files other than Google Fonts. Keep \`attachments/…\` paths as written; the app inlines them.
- Write only \`${STANDALONE_FILE}\`. Don't change the project files and don't run shell commands.

## Reply
One plain sentence saying the file is written. No code.`;
}
