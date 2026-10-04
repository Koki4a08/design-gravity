import type { Artifact, TokenOverrides, Tokens } from "./types";

export const DEFAULT_TOKENS: Tokens = {
  paper: "#ffffff",
  ink: "#111111",
  muted: "#666666",
  surface: "#f2f2f2",
  accent: "#d6006e",
  fontDisplay: "Georgia, serif",
  fontBody: "system-ui, sans-serif",
  scale: 1,
  radius: 4,
  space: 8,
};

const VAR: Record<keyof Tokens, string> = {
  paper: "--dg-paper",
  ink: "--dg-ink",
  muted: "--dg-muted",
  surface: "--dg-surface",
  accent: "--dg-accent",
  fontDisplay: "--dg-font-display",
  fontBody: "--dg-font-body",
  scale: "--dg-scale",
  radius: "--dg-radius",
  space: "--dg-space",
};

/** Read the agent's own token values from the first :root block. */
export function parseTokens(source: string): { tokens: Tokens; contract: boolean } {
  const tokens = { ...DEFAULT_TOKENS };
  const block = source.match(/:root\s*\{([^}]*)\}/)?.[1] ?? "";
  let found = 0;
  (Object.keys(VAR) as (keyof Tokens)[]).forEach((key) => {
    const m = block.match(new RegExp(`${VAR[key]}\\s*:\\s*([^;]+);`));
    if (!m) return;
    found++;
    const raw = m[1].trim();
    if (key === "scale" || key === "radius" || key === "space") {
      const n = parseFloat(raw);
      if (!Number.isNaN(n)) (tokens as any)[key] = n;
    } else {
      (tokens as any)[key] = raw;
    }
  });
  return { tokens, contract: found >= 6 };
}

/** First family name in a font stack, unquoted. */
export const primaryFamily = (stack: string) =>
  stack.split(",")[0].trim().replace(/^["']|["']$/g, "");

const SYSTEM_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "system-ui", "georgia", "arial", "helvetica",
  "times new roman", "courier new", "ui-serif", "ui-sans-serif", "ui-monospace",
]);

function fontImport(overrides: TokenOverrides): string {
  const fams = [overrides.fontDisplay, overrides.fontBody]
    .filter(Boolean)
    .map((s) => primaryFamily(s!))
    .filter((f) => f && !SYSTEM_FAMILIES.has(f.toLowerCase()));
  if (!fams.length) return "";
  const q = [...new Set(fams)]
    .map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@300..900`)
    .join("&");
  return `@import url("https://fonts.googleapis.com/css2?${q}&display=swap");\n`;
}

export function overrideCss(overrides: TokenOverrides): string {
  const decls = (Object.keys(overrides) as (keyof Tokens)[])
    .filter((k) => overrides[k] !== undefined && overrides[k] !== "")
    .map((k) => {
      const v = overrides[k]!;
      const value = k === "radius" || k === "space" ? `${v}px` : String(v);
      return `  ${VAR[k]}: ${value} !important;`;
    });
  if (!decls.length) return "";
  return `${fontImport(overrides)}:root:root {\n${decls.join("\n")}\n}`;
}

/** Bake overrides into the source so exports match what the user sees. */
export function bake(artifact: Artifact, overrides: TokenOverrides): string {
  const css = overrideCss(overrides);
  if (!css) return artifact.content;
  const tag = `<style data-design-gravity="tokens">\n${css}\n</style>`;
  const src = artifact.content;
  if (artifact.file.endsWith(".svg")) {
    // @import must lead a stylesheet, so this goes in its own <style>.
    return src.replace(/(<svg\b[^>]*>)/i, `$1\n${tag}`);
  }
  if (/<\/head>/i.test(src)) return src.replace(/<\/head>/i, `${tag}\n</head>`);
  return tag + "\n" + src;
}

export const CURATED_FONTS: { family: string; stack: string; role: "display" | "text" | "both" }[] = [
  { family: "Bricolage Grotesque", stack: '"Bricolage Grotesque", sans-serif', role: "display" },
  { family: "Schibsted Grotesk", stack: '"Schibsted Grotesk", sans-serif', role: "both" },
  { family: "Familjen Grotesk", stack: '"Familjen Grotesk", sans-serif', role: "both" },
  { family: "Hanken Grotesk", stack: '"Hanken Grotesk", sans-serif', role: "both" },
  { family: "Archivo", stack: '"Archivo", sans-serif', role: "both" },
  { family: "Unbounded", stack: '"Unbounded", sans-serif', role: "display" },
  { family: "Big Shoulders Display", stack: '"Big Shoulders Display", sans-serif', role: "display" },
  { family: "Anybody", stack: '"Anybody", sans-serif', role: "display" },
  { family: "Gloock", stack: '"Gloock", serif', role: "display" },
  { family: "Young Serif", stack: '"Young Serif", serif', role: "display" },
  { family: "Libre Caslon Display", stack: '"Libre Caslon Display", serif', role: "display" },
  { family: "Bodoni Moda", stack: '"Bodoni Moda", serif', role: "display" },
  { family: "Source Serif 4", stack: '"Source Serif 4", serif', role: "both" },
  { family: "Literata", stack: '"Literata", serif', role: "text" },
  { family: "Spectral", stack: '"Spectral", serif', role: "text" },
  { family: "EB Garamond", stack: '"EB Garamond", serif', role: "text" },
  { family: "Atkinson Hyperlegible", stack: '"Atkinson Hyperlegible", sans-serif', role: "text" },
  { family: "Public Sans", stack: '"Public Sans", sans-serif', role: "text" },
  { family: "Geist", stack: '"Geist", sans-serif', role: "both" },
  { family: "JetBrains Mono", stack: '"JetBrains Mono", monospace', role: "both" },
];
