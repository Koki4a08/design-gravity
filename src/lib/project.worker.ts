// Renders a design project (app/page.tsx + components + styles) to static
// HTML. Runs in a worker so agent-written code never touches the app window
// (and its Tauri IPC); the app terminates it if rendering hangs.
import * as React from "react";
import * as ReactDOM from "react-dom";
import { renderToStaticMarkup } from "react-dom/server.browser";
import { transform } from "sucrase";
import { ENTRY, type ProjectFiles } from "./projectFiles";

const EXTS = ["", ".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"];

/** Resolve "./x", "../components/x" or "@/components/x" against the importer. */
function resolve(spec: string, from: string, files: ProjectFiles): string | null {
  let base: string[];
  if (spec.startsWith("@/")) base = spec.slice(2).split("/");
  else if (spec.startsWith(".")) base = [...from.split("/").slice(0, -1), ...spec.split("/")];
  else return null;
  const parts: string[] = [];
  for (const p of base) {
    if (p === "..") parts.pop();
    else if (p && p !== ".") parts.push(p);
  }
  const path = parts.join("/");
  if (/\.css$/i.test(path)) return path;
  return EXTS.map((e) => path + e).find((p) => p in files) ?? null;
}

/** The few framework imports a design may use, mapped to plain markup. */
const Link = ({ href, children, ...rest }: any) => React.createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children);
const Image = ({ src, fill, priority, quality, placeholder, blurDataURL, ...rest }: any) =>
  React.createElement("img", { src: typeof src === "string" ? src : src?.src, ...rest });
const SHIMS: Record<string, unknown> = {
  react: React,
  "react-dom": ReactDOM,
  "next/link": { __esModule: true, default: Link },
  "next/image": { __esModule: true, default: Image },
};

function render(files: ProjectFiles): string {
  const cache = new Map<string, { exports: any }>();
  const load = (path: string): any => {
    const hit = cache.get(path);
    if (hit) return hit.exports;
    const module = { exports: {} as any };
    cache.set(path, module);
    const { code } = transform(files[path], {
      transforms: ["typescript", "jsx", "imports"],
      jsxPragma: "React.createElement",
      jsxFragmentPragma: "React.Fragment",
      filePath: path,
      production: true,
    });
    const require = (spec: string) => {
      if (spec in SHIMS) return SHIMS[spec];
      const target = resolve(spec, path, files);
      if (target && /\.css$/i.test(target)) return {};
      if (!target) throw new Error(`${path} imports "${spec}", which the preview can't load. Use only react and files inside the project.`);
      return load(target);
    };
    new Function("require", "module", "exports", "React", code)(require, module, module.exports, React);
    return module.exports;
  };

  const Page = load(ENTRY).default;
  if (typeof Page !== "function") throw new Error(`${ENTRY} has no default export component.`);
  return renderToStaticMarkup(React.createElement(Page));
}

/** globals.css first, then any other stylesheet, each in its own <style> so @import stays valid. */
function styles(files: ProjectFiles): string {
  return Object.keys(files)
    .filter((p) => /\.css$/i.test(p))
    .sort((a, b) => Number(b === "styles/globals.css") - Number(a === "styles/globals.css") || a.localeCompare(b))
    .map((p) => `<style data-dg-file="${p}">\n${files[p]}\n</style>`)
    .join("\n");
}

self.onmessage = (e: MessageEvent<{ id: number; files: ProjectFiles }>) => {
  const { id, files } = e.data;
  try {
    const body = render(files);
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${styles(files)}
</head>
<body>
${body}
</body>
</html>`;
    self.postMessage({ id, html });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
