// Browser-only stand-in for the Tauri backend, so the UI can be previewed
// with `npm run dev` outside the desktop shell. Never used inside Tauri.
import type { Backend } from "./backend";
import type { AgentExit, Artifact, DesignMeta } from "./types";
import type { SystemMeta } from "./systems";
import { MOCK_QUESTIONS, MOCK_SPEC, MOCK_PREVIEW } from "./mockSystem";

const MOCK_CRITIQUE = {
  summary: "Strong type-led page; the offer and the action compete for attention.",
  notes: [
    { selector: "section.hero > h1", label: "Hero headline", note: "The headline and the plans both shout; cut the headline to about 72px so the featured plan wins.", severity: "high" },
    { selector: "section.plans > div.plan:nth-of-type(2) > button", label: "Resident button", note: "The primary action has no hover or focus state; add a visible focus ring from the accent.", severity: "medium" },
    { selector: "header > nav", label: "Navigation", note: "Nav links sit at body size with no current-page state; mark where the visitor is.", severity: "low" },
  ],
};

const KEY = "dg-mock-designs";
const params = new URLSearchParams(typeof location !== "undefined" ? location.search : "");

const SAMPLE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Tipografia Oficina</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Literata:opsz,wght@7..72,400;7..72,600&display=swap" rel="stylesheet">
<style>
:root {
  --dg-paper: #f3efe6; --dg-ink: #1d1a16; --dg-muted: #6b6358; --dg-surface: #e7e0d2; --dg-accent: #c2410c;
  --dg-font-display: "Bricolage Grotesque", sans-serif; --dg-font-body: "Literata", serif;
  --dg-scale: 1; --dg-radius: 2px; --dg-space: 8px;
}
* { box-sizing: border-box; margin: 0; }
body { background: var(--dg-paper); color: var(--dg-ink); font-family: var(--dg-font-body); font-size: calc(1rem * var(--dg-scale)); line-height: 1.55; }
header { display: flex; justify-content: space-between; padding: calc(var(--dg-space) * 3) calc(var(--dg-space) * 8); border-bottom: 1px solid var(--dg-ink); font-family: var(--dg-font-display); font-weight: 600; }
nav a { color: inherit; text-decoration: none; margin-left: calc(var(--dg-space) * 4); font-weight: 400; }
.hero { padding: calc(var(--dg-space) * 10) calc(var(--dg-space) * 8) calc(var(--dg-space) * 6); display: grid; grid-template-columns: 1.4fr 1fr; gap: calc(var(--dg-space) * 8); align-items: end; }
h1 { font-family: var(--dg-font-display); font-weight: 750; font-size: calc(5.5rem * var(--dg-scale)); line-height: .92; letter-spacing: -0.035em; }
h1 em { font-style: normal; color: var(--dg-accent); }
.hero p { color: var(--dg-muted); max-width: 34ch; font-size: calc(1.15rem * var(--dg-scale)); }
.plans { display: grid; grid-template-columns: repeat(3, 1fr); margin: 0 calc(var(--dg-space) * 8); border-top: 1px solid var(--dg-ink); }
.plan { padding: calc(var(--dg-space) * 4) calc(var(--dg-space) * 3) calc(var(--dg-space) * 5) 0; border-right: 1px solid color-mix(in srgb, var(--dg-ink) 20%, transparent); }
.plan + .plan { padding-left: calc(var(--dg-space) * 3); }
.plan:last-child { border-right: 0; }
.plan h2 { font-family: var(--dg-font-display); font-size: calc(1.6rem * var(--dg-scale)); font-weight: 650; }
.price { font-family: var(--dg-font-display); font-size: calc(3.2rem * var(--dg-scale)); font-weight: 700; letter-spacing: -0.03em; margin: calc(var(--dg-space) * 2) 0; font-variant-numeric: tabular-nums; }
.price small { font-size: .35em; font-weight: 400; color: var(--dg-muted); letter-spacing: 0; }
.plan ul { padding-left: 1.1em; color: var(--dg-muted); font-size: 15px; }
nav a:hover { color: #9a3412; }
.plan button { margin-top: calc(var(--dg-space) * 3); font: 600 calc(1rem * var(--dg-scale)) var(--dg-font-display); padding: calc(var(--dg-space) * 1.5) calc(var(--dg-space) * 3); border: 1px solid var(--dg-ink); background: transparent; color: var(--dg-ink); border-radius: var(--dg-radius); }
.plan.featured button { background: var(--dg-accent); border-color: var(--dg-accent); color: var(--dg-paper); }
</style></head><body>
<header><span>Tipografia Oficina</span><nav><a href="#">Press</a><a href="#">Type cases</a><a href="#">Visit Lisbon</a></nav></header>
<section class="hero"><h1>Set by hand, <em>printed</em> by Friday.</h1><p>A working letterpress studio in Alfama. Book the press by the day, or bring a job and let our compositors set it for you.</p></section>
<section class="plans">
<div class="plan"><h2>Visitor</h2><div class="price">€40<small> / half day</small></div><ul><li>Press time on the Vandercook</li><li>House wood type</li></ul><button>Book a morning</button></div>
<div class="plan featured"><h2>Resident</h2><div class="price">€320<small> / month</small></div><ul><li>Twelve press days</li><li>Your own type drawer</li><li>Paper at cost</li></ul><button>Apply for a drawer</button></div>
<div class="plan"><h2>Commission</h2><div class="price">€190<small> / job from</small></div><ul><li>We set, proof and print</li><li>Up to 250 sheets</li></ul><button>Send a job</button></div>
</section></body></html>`;

function load(): DesignMeta[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}
function persist(list: DesignMeta[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* preview only */
  }
}

export function mockBackend(): Backend {
  const eventCbs: ((id: string, e: any) => void)[] = [];
  const exitCbs: ((e: AgentExit) => void)[] = [];
  const artifacts = new Map<string, Artifact>();
  const timers = new Map<string, number[]>();
  const versions = new Map<string, Artifact[]>();
  const blobs = new Map<string, Record<string, string>>();
  const systems = new Map<string, SystemMeta>();
  const systemFiles = new Map<string, { spec: string; guide: string; preview: string }>();
  let signedIn = params.get("auth") !== "out";
  // Both CLIs start a release behind so the update notice can be previewed; ?updates=off hides it.
  const installed: Record<string, string> = { antigravity: "1.2.12", codex: "0.157.1" };
  const latest: Record<string, string> =
    params.get("updates") === "off" ? { ...installed } : { antigravity: "1.2.16", codex: "0.160.0" };

  const emit = (id: string, event: any) => eventCbs.forEach((cb) => cb(id, event));

  return {
    async agyStatus(_path, provider) {
      await new Promise((r) => setTimeout(r, 450));
      if (provider === "codex") {
        return {
          installed: true,
          path: "C:\\Users\\you\\AppData\\Roaming\\npm\\codex.cmd",
          version: installed.codex,
          authenticated: true,
          models: [
            { id: "gpt-6-astra", label: "GPT-6-Astra" },
            { id: "gpt-6-sol", label: "GPT-6-Sol" },
            { id: "gpt-6-luna", label: "GPT-6-Luna" },
            { id: "gpt-5.6-sol", label: "GPT-5.6-Sol", legacy: true },
            { id: "gpt-5.6-terra", label: "GPT-5.6-Terra", legacy: true },
            { id: "gpt-5.6-luna", label: "GPT-5.6-Luna", legacy: true },
            { id: "gpt-5.5", label: "GPT-5.5", legacy: true },
          ],
          detail: null,
          checkedAt: Date.now(),
          account: null,
          authMethod: "chatgpt",
        };
      }
      return {
        installed: true,
        path: "C:\\Users\\you\\AppData\\Local\\agy\\bin\\agy.exe",
        version: installed.antigravity,
        authenticated: signedIn,
        models: signedIn
          ? [
              { id: "gemini-3.1-pro-high", label: "Gemini 3.1 Pro (High)" },
              { id: "gemini-3.8-flash-high", label: "Gemini 3.8 Flash (High)" },
              { id: "claude-opus-4-6-thinking", label: "Claude Opus 4.6 (Thinking)" },
            ]
          : [],
        detail: signedIn ? null : "Antigravity returned no models. The CLI is most likely signed out.",
        checkedAt: Date.now(),
        account: signedIn ? "designer@example.com" : null,
        authMethod: signedIn ? "consumer" : null,
      };
    },
    async agyPing(_p, model) {
      await new Promise((r) => setTimeout(r, 900));
      return { ok: signedIn, latencyMs: 2140, model, detail: signedIn ? null : "Not signed in." };
    },
    async cliLatest(provider) {
      await new Promise((r) => setTimeout(r, 300));
      return latest[provider] ?? null;
    },
    async cliUpdate(_path, provider) {
      await new Promise((r) => setTimeout(r, 2500));
      installed[provider] = latest[provider];
      return `Updated to ${latest[provider]}`;
    },
    async openSignIn() {
      setTimeout(() => (signedIn = true), 2500);
    },
    async agentRun({ designId, prompt, scope }) {
      if (scope === "dir") {
        const w = (i: number, t: number, file: string, done: boolean): [number, any] => [
          t,
          { event: "step_update", step_update: { step_index: i, state: done ? "DONE" : "ACTIVE", step_type: "tool", tool_name: "write_to_file", duration_seconds: done ? 1 : undefined, tool_info: { parameters: { TargetFile: file } } } },
        ];
        [w(1, 600, "tokens.css", false), w(1, 1400, "tokens.css", true), w(2, 1600, "PricingPage.tsx", false), w(2, 3200, "PricingPage.tsx", true)]
          .forEach(([t, e]) => window.setTimeout(() => emit(designId, e), t));
        window.setTimeout(() => exitCbs.forEach((cb) => cb({
          designId, ok: true, cancelled: false, code: 0, authLost: false, usage: { total_tokens: 9000 },
          response: "Wrote tokens.css and PricingPage.tsx: three plan cards built from your existing Button, typed props for the plans.",
        })), 3600);
        return;
      }
      if (scope === "system") {
        const w = (i: number, t: number, file: string, done: boolean): [number, any] => [
          t,
          { event: "step_update", step_update: { step_index: i, state: done ? "DONE" : "ACTIVE", step_type: "tool", tool_name: "write_to_file", duration_seconds: done ? 1 : undefined, tool_info: { parameters: { TargetFile: file } } } },
        ];
        const steps: [number, any][] = [
          [200, { event: "init", conversation_id: "sys-" + designId }],
          w(1, 800, "system.json", false), w(1, 2600, "system.json", true),
          w(2, 2800, "DESIGN.md", false), w(2, 4600, "DESIGN.md", true),
          w(3, 4800, "preview.html", false), w(3, 6600, "preview.html", true),
        ];
        steps.forEach(([t, e]) => window.setTimeout(() => emit(designId, e), t));
        window.setTimeout(() => systemFiles.set(designId, { spec: MOCK_SPEC, guide: "", preview: "" }), 2500);
        window.setTimeout(() => {
          systemFiles.set(designId, { spec: MOCK_SPEC, guide: "# Rules", preview: MOCK_PREVIEW });
          exitCbs.forEach((cb) =>
            cb({
              designId, ok: true, cancelled: false, code: 0, authLost: false, conversationId: "sys-" + designId,
              usage: { total_tokens: 42000 },
              response: "A warm, editorial system: ink on paper, one clay accent, Fraunces for display over Public Sans. Corners stay small and shadows barely there, so content leads.",
            }),
          );
        }, 7600);
        return;
      }
      const conv = "mock-" + designId;
      const steps: [number, any][] = [
        [200, { event: "init", conversation_id: conv }],
        [700, { event: "step_update", step_update: { step_index: 1, state: "DONE", step_type: "agent_response", text_delta: "Reading the brief and choosing a type pairing. " } }],
        [1300, { event: "step_update", step_update: { step_index: 2, state: "ACTIVE", step_type: "tool", tool_name: "view_file", tool_info: { parameters: { AbsolutePath: prompt.includes("left a note on the design") ? "design.html" : "design-system/DESIGN.md" } } } }],
        [1600, { event: "step_update", step_update: { step_index: 2, state: "DONE", step_type: "tool", tool_name: "view_file", duration_seconds: 0.02, tool_info: { parameters: { AbsolutePath: prompt.includes("left a note on the design") ? "design.html" : "design-system/DESIGN.md" } } } }],
        [2100, { event: "step_update", step_update: { step_index: 3, state: "ACTIVE", step_type: "tool", tool_name: "write_to_file", tool_info: { parameters: { TargetFile: "design.html" } } } }],
        [3600, { event: "step_update", step_update: { step_index: 3, state: "DONE", step_type: "tool", tool_name: "write_to_file", duration_seconds: 1.4, tool_info: { parameters: { TargetFile: "design.html" } } } }],
        [4000, { event: "step_update", step_update: { step_index: 4, state: "DONE", step_type: "agent_response", text_delta: "A pricing page for a letterpress studio, set in Bricolage Grotesque over Literata." } }],
      ];
      const ids = steps.map(([t, e]) => window.setTimeout(() => emit(designId, e), t));
      ids.push(
        window.setTimeout(() => {
          // Variants get their own accent so the preview shows them apart.
          const letter = prompt.match(/variant ([A-D]) of/i)?.[1];
          const accent = { A: "#c2410c", B: "#1d4ed8", C: "#15803d", D: "#7e22ce" }[letter ?? "A"] ?? "#c2410c";
          artifacts.set(designId, { file: "design.html", content: SAMPLE_HTML.replace("#c2410c", accent), modifiedMs: Date.now() });
          exitCbs.forEach((cb) =>
            cb({
              designId,
              ok: true,
              cancelled: false,
              code: 0,
              authLost: false,
              conversationId: conv,
              usage: { total_tokens: 18420 },
              model: "gemini-3.1-pro-high",
              response: prompt.includes("left a note on the design")
                ? "Tightened the headline and gave the featured plan more weight, so the eye lands on the resident offer first.\nNEXT: Add a short FAQ under the plans\nNEXT: Try a darker, inky colour scheme\nNEXT: Make the prices larger"
                : "A pricing page that reads like a type specimen: Bricolage Grotesque does the shouting, Literata keeps the details calm, and one burnt-orange accent marks the plan most people should pick.\nNEXT: Make the headline even bigger\nNEXT: Add a visit section with opening hours\nNEXT: Try a cooler paper tone",
            }),
          );
          timers.delete(designId);
        }, 4300),
      );
      timers.set(designId, ids);
    },
    async agentCancel(designId) {
      const ids = timers.get(designId);
      if (!ids) return false;
      ids.forEach(clearTimeout);
      timers.delete(designId);
      exitCbs.forEach((cb) => cb({ designId, ok: false, cancelled: true, authLost: false }));
      return true;
    },
    async onAgentEvent(cb) {
      eventCbs.push(cb);
      return () => {
        const i = eventCbs.indexOf(cb);
        if (i >= 0) eventCbs.splice(i, 1);
      };
    },
    async onAgentExit(cb) {
      exitCbs.push(cb);
      return () => {
        const i = exitCbs.indexOf(cb);
        if (i >= 0) exitCbs.splice(i, 1);
      };
    },
    async listDesigns() {
      const list = load();
      list.forEach((d) => {
        if (d.status === "ready" && !artifacts.has(d.id))
          artifacts.set(d.id, { file: "design.html", content: SAMPLE_HTML, modifiedMs: d.updatedAt });
      });
      return list;
    },
    async saveMeta(meta) {
      const list = load().filter((d) => d.id !== meta.id);
      list.push(meta);
      persist(list);
    },
    async readArtifact(id) {
      return artifacts.get(id) ?? null;
    },
    async deleteDesign(id) {
      persist(load().filter((d) => d.id !== id));
      artifacts.delete(id);
    },
    async revealDesign() {},
    async revealPath() {},
    async agyAsk(_prompt, schema: any) {
      await new Promise((r) => setTimeout(r, 1400));
      if (schema?.properties?.notes) return { data: MOCK_CRITIQUE, conversationId: "ask-crit" };
      return { data: MOCK_QUESTIONS, conversationId: "ask-1" };
    },
    async systemsList() {
      return [...systems.values()];
    },
    async systemSaveMeta(meta) {
      systems.set(meta.id, meta);
    },
    async systemRead(id) {
      return systemFiles.get(id) ?? {};
    },
    async systemDelete(id) {
      systems.delete(id);
      systemFiles.delete(id);
    },
    async useSystem() {
      return true;
    },
    async pickFiles() {
      return [];
    },
    async attachFile(_id, source) {
      const name = source.split(/[\\/]/).pop() || "file";
      return { path: `attachments/${name}`, name, size: 0 };
    },
    async attachBytes(id, name, bytes) {
      const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
      blobs.set(id, { ...(blobs.get(id) ?? {}), [`attachments/${name}`]: url });
      return { path: `attachments/${name}`, name, size: bytes.length };
    },
    async attachmentUrls(id) {
      return blobs.get(id) ?? {};
    },
    async snapshot(id) {
      const a = artifacts.get(id);
      if (!a) throw new Error("Nothing to snapshot");
      const list = versions.get(id) ?? [];
      list.push({ ...a });
      versions.set(id, list);
      return list.length;
    },
    async readVersion(id, n) {
      const v = versions.get(id)?.[n - 1] ?? artifacts.get(id);
      if (!v) throw new Error("That version no longer exists.");
      return v;
    },
    async restoreVersion(id, n) {
      const v = versions.get(id)?.[n - 1] ?? artifacts.get(id);
      if (!v) throw new Error("That version no longer exists.");
      const a = { ...v, modifiedMs: Date.now() };
      artifacts.set(id, a);
      return a;
    },
    async forkDesign(fromId, toId, _version, withArtifact = true) {
      const a = artifacts.get(fromId);
      if (a && withArtifact) artifacts.set(toId, { ...a, modifiedMs: Date.now() });
      return artifacts.get(toId) ?? null;
    },
    async importDesign(_id, _fromId, asName) {
      return asName;
    },
    async systemRefFile(_id, source) {
      return "refs/" + (source.split(/[\\/]/).pop() || "file");
    },
    async systemRefBytes(_id, name) {
      return "refs/" + name;
    },
    async systemRefDesign() {
      return "refs/design.html";
    },
    async readDesignFile(id, path) {
      return path === "export/standalone.html" ? (artifacts.get(id)?.content ?? null) : null;
    },
    async designDir(id) {
      return String.raw`C:\Users\you\AppData\Roaming\design-gravity\designs` + "\\" + id;
    },
    async exportFile(name, _ext, content) {
      const url = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: name });
      a.click();
      URL.revokeObjectURL(url);
      return name;
    },
    async exportBytes(name, _ext, bytes) {
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/zip" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: name });
      a.click();
      URL.revokeObjectURL(url);
      return name;
    },
  };
}
