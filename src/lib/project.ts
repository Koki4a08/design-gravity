import type { Artifact, TokenOverrides } from "./types";
import { overrideCss } from "./tokens";
import type { ProjectFiles } from "./projectFiles";

export { ENTRY } from "./projectFiles";
export type { ProjectFiles } from "./projectFiles";

/** A design made of project files rather than one design.html / design.svg. */
export const isProject = (a: Artifact | null | undefined): a is Artifact & { files: ProjectFiles } => !!a?.files;

const RENDER_TIMEOUT = 8000;

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { ok(html: string): void; fail(e: Error): void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./project.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<{ id: number; html?: string; error?: string }>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.html != null) p.ok(e.data.html);
    else p.fail(new Error(e.data.error ?? "The preview could not render."));
  };
  worker.onerror = (e) => reset(new Error(e.message || "The preview worker crashed."));
  return worker;
}

/** Drop the worker (e.g. a component looping forever) and fail everything in flight. */
function reset(err: Error) {
  worker?.terminate();
  worker = null;
  for (const p of pending.values()) p.fail(err);
  pending.clear();
}

/** Render the project to one static HTML document for the canvas. */
export function renderProject(files: ProjectFiles): Promise<string> {
  return new Promise((ok, fail) => {
    const id = ++seq;
    const timer = setTimeout(() => reset(new Error("The design took too long to render; a component may loop forever.")), RENDER_TIMEOUT);
    pending.set(id, {
      ok: (html) => (clearTimeout(timer), ok(html)),
      fail: (e) => (clearTimeout(timer), fail(e)),
    });
    getWorker().postMessage({ id, files });
  });
}

/** Shown on the canvas when the project doesn't compile, so the designer can ask for a fix. */
export function errorDoc(message: string): string {
  const esc = message.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:48px;font:15px/1.5 system-ui,sans-serif;color:#7a1f1f;background:#fff6f5}h1{font-size:18px;margin:0 0 12px}pre{white-space:pre-wrap;font:13px/1.5 ui-monospace,monospace}</style></head><body><h1>This design doesn’t render</h1><pre>${esc}</pre><p>Leave a note asking the agent to fix it.</p></body></html>`;
}

/** Project files with the designer's live token edits written into styles/globals.css. */
export function bakeProject(files: ProjectFiles, overrides: TokenOverrides): ProjectFiles {
  const css = overrideCss(overrides);
  const path = "styles/globals.css";
  if (!css || !(path in files)) return files;
  // @import has to lead the stylesheet, so a font import goes on top.
  const imports = css.match(/^@import[^;]+;\n?/gm)?.join("") ?? "";
  const rules = css.replace(/^@import[^;]+;\n?/gm, "");
  return { ...files, [path]: `${imports}${files[path].trimEnd()}\n\n/* Token edits from Design Gravity */\n${rules}\n` };
}

// ---- ZIP (stored, no compression; design projects are a few KB of text) -----

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** A .zip of the files, paths kept as given (e.g. "components/Hero.tsx"). */
export function zipFiles(files: ProjectFiles): Uint8Array {
  const enc = new TextEncoder();
  const { time, date } = dosTime(new Date());
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const path of Object.keys(files).sort()) {
    const name = enc.encode(path);
    const data = enc.encode(files[path]);
    const crc = crc32(data);

    const local = new Uint8Array(30 + name.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);

    offset += local.length;
  }

  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + centralSize + end.length);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
