// On-system audit: a deterministic read of a design's CSS against the token
// contract and, when the design follows one, its design system. No model.

import { systemRoot } from "./systems";
import type { SystemSpec } from "./systems";
import { primaryFamily } from "./tokens";

export type IssueKind = "colour" | "font" | "type" | "space" | "radius" | "token";

export interface Issue {
  kind: IssueKind;
  /** CSS selector of the rule, or the token name for token drift. */
  selector: string;
  property: string;
  value: string;
  /** For token drift: what the system says the value should be. */
  expected?: string;
}

export interface Audit {
  /** 0 to 100: share of checked declarations that follow the contract. */
  score: number;
  checked: number;
  issues: Issue[];
}

export const KIND_LABEL: Record<IssueKind, string> = {
  colour: "Hard-coded colour",
  font: "Font outside the tokens",
  type: "Size off the type scale",
  space: "Spacing off the grid",
  radius: "Radius outside the tokens",
  token: "Token differs from the system",
};

/** Every <style> body in the document (HTML or SVG). */
function styles(source: string): string {
  return [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
}

/** Flat list of [selector, declarations] from a stylesheet, entering @media/@supports blocks. */
function rules(css: string): [string, string][] {
  const out: [string, string][] = [];
  const stack: string[] = [];
  let buf = "";
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const c of src) {
    if (c === "{") {
      stack.push(buf.trim());
      buf = "";
    } else if (c === "}") {
      const sel = stack.pop() ?? "";
      // Keyframes and font faces are not layout: skip their bodies.
      const skip = /^@font-face/i.test(sel) || stack.some((x) => /@keyframes/i.test(x));
      if (buf.includes(":") && !skip) out.push([sel, buf]);
      buf = "";
    } else buf += c;
  }
  return out;
}

function declarations(body: string): [string, string][] {
  return body
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const i = d.indexOf(":");
      return [d.slice(0, i).trim().toLowerCase(), d.slice(i + 1).trim()] as [string, string];
    })
    .filter(([p]) => p && !p.startsWith("--"));
}

const COLOUR_PROP = /^(color|background(-color)?|border(-(top|right|bottom|left))?(-color)?|outline(-color)?|fill|stroke|box-shadow|text-shadow|text-decoration(-color)?|caret-color|accent-color|stop-color|column-rule(-color)?)$/;
const SPACE_PROP = /^(padding|margin)(-(top|right|bottom|left|inline|block)(-(start|end))?)?$|^(row-|column-)?gap$/;
const LITERAL_COLOUR = /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(|\b(white|black)\b/i;
/** Lengths that count as off-grid: any px/rem above 1px. */
const LENGTH = /(\d*\.?\d+)(px|rem)\b/g;

const withoutVars = (v: string) => v.replace(/var\([^()]*(\([^()]*\))?[^()]*\)/g, "");

function hasOffGridLength(value: string): boolean {
  for (const m of withoutVars(value).matchAll(LENGTH)) {
    const n = parseFloat(m[1]) * (m[2] === "rem" ? 16 : 1);
    if (n > 1) return true;
  }
  return false;
}

function check(selector: string, prop: string, value: string): Issue | null | undefined {
  const v = value.replace(/!important/i, "").trim();
  const bare = withoutVars(v);
  if (COLOUR_PROP.test(prop)) {
    return LITERAL_COLOUR.test(bare) ? { kind: "colour", selector, property: prop, value: v } : null;
  }
  if (prop === "font-family") {
    return /var\(--dg-font/.test(v) || /^(inherit|initial|unset)$/i.test(v) ? null : { kind: "font", selector, property: prop, value: v };
  }
  if (prop === "font") {
    // The shorthand names a family: it must come from a font token.
    const namesFamily = /["']|,|\b(serif|sans-serif|monospace|system-ui)\b/i.test(bare);
    return namesFamily && !/var\(--dg-font/.test(v) ? { kind: "font", selector, property: prop, value: v } : null;
  }
  if (prop === "font-size") {
    return hasOffGridLength(v) && !/--dg-scale/.test(v) ? { kind: "type", selector, property: prop, value: v } : null;
  }
  if (SPACE_PROP.test(prop)) {
    return hasOffGridLength(v) && !/--dg-space/.test(v) ? { kind: "space", selector, property: prop, value: v } : null;
  }
  if (/^border(-(top|bottom)-(left|right))?-radius$/.test(prop)) {
    const pill = /\b(999+px|50%|100%)\b/.test(v);
    return !pill && hasOffGridLength(v) && !/--dg-radius/.test(v) ? { kind: "radius", selector, property: prop, value: v } : null;
  }
  return undefined; // not a property the contract governs
}

/** The design's own :root token values, keyed by name. */
function rootTokens(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/:root\s*\{([^}]*)\}/g)) {
    for (const d of m[1].matchAll(/(--dg-[\w-]+)\s*:\s*([^;]+);?/g)) out[d[1]] ??= d[2].trim();
  }
  return out;
}

const same = (name: string, a: string, b: string) => {
  if (name.startsWith("--dg-font")) return primaryFamily(a).toLowerCase() === primaryFamily(b).toLowerCase();
  return a.replace(/\s+/g, "").toLowerCase() === b.replace(/\s+/g, "").toLowerCase();
};

export function audit(source: string, system?: SystemSpec | null): Audit {
  const css = styles(source);
  const issues: Issue[] = [];
  let checked = 0;

  for (const [selector, body] of rules(css)) {
    if (/(^|,)\s*:root\s*($|,)/.test(selector)) continue; // tokens live here
    for (const [prop, value] of declarations(body)) {
      const r = check(selector, prop, value);
      if (r === undefined) continue;
      checked++;
      if (r) issues.push(r);
    }
  }

  const expected = system ? systemRoot(system) : null;
  if (expected) {
    const actual = rootTokens(css);
    for (const m of expected.matchAll(/(--dg-[\w-]+):\s*([^;]+);/g)) {
      const [name, want] = [m[1], m[2].trim()];
      if (name === "--dg-scale") continue;
      checked++;
      const have = actual[name];
      // Missing optional roles are fine; a different value is drift.
      if (have !== undefined && !same(name, have, want)) {
        issues.push({ kind: "token", selector: ":root", property: name, value: have, expected: want });
      }
    }
  }

  const score = checked ? Math.round(100 * (1 - issues.length / checked)) : 100;
  return { score: Math.max(0, score), checked, issues };
}

/** A note the agent can act on: every issue, grouped by kind. */
export function fixNote(a: Audit): string {
  const lines = a.issues.slice(0, 40).map((i) =>
    i.kind === "token"
      ? `- ${i.property} is ${i.value}; the system value is ${i.expected}`
      : `- \`${i.selector}\` ${i.property}: ${i.value} (${KIND_LABEL[i.kind].toLowerCase()})`,
  );
  const more = a.issues.length > 40 ? `\n- …and ${a.issues.length - 40} more of the same kinds` : "";
  return `These declarations bypass the token contract. Route each one through the --dg-* variables (colours through the colour tokens or color-mix() of them, font sizes as calc(<px> * var(--dg-scale)), spacing as calc(var(--dg-space) * n), radii through a radius token), and set any drifted :root token back to its system value. Keep the design looking the same otherwise.
${lines.join("\n")}${more}`;
}
