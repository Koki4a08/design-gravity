import type { Artifact, TokenOverrides } from "./types";
import { overrideCss } from "./tokens";

// Runs inside the sandboxed page. Mark mode lets the designer pick an
// element; the pick travels back to the app over postMessage.
const PICKER = `(() => {
  let marking = false, hovered = null;
  const style = document.createElement("style");
  style.textContent = ".dg-hover{outline:2px solid #d6006e!important;outline-offset:2px!important;cursor:crosshair!important}.dg-pinned{outline:2px solid #d6006e!important;outline-offset:2px!important}[data-dg-flag]{outline:2px dashed #ff8a5c!important;outline-offset:3px!important}[data-dg-flag=focus]{outline:2px solid #ff8a5c!important;box-shadow:0 0 0 6px rgba(255,138,92,.22)!important}";
  (document.head || document.documentElement).appendChild(style);
  const path = (el) => {
    const parts = [];
    while (el && el.nodeType === 1 && el !== document.documentElement && parts.length < 7) {
      let part = el.localName;
      if (el.id) { parts.unshift(part + "#" + CSS.escape(el.id)); break; }
      const parent = el.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.localName === el.localName);
        if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(el) + 1) + ")";
      }
      parts.unshift(part);
      el = parent;
    }
    return parts.join(" > ");
  };
  const label = (el) => {
    const text = (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 48);
    return "<" + el.localName + ">" + (text ? " " + text : "");
  };
  const clear = () => { if (hovered) hovered.classList.remove("dg-hover"); hovered = null; };
  addEventListener("message", (e) => {
    const d = e.data || {};
    if (d.type === "dg-mark") { marking = !!d.on; if (!marking) clear(); }
    if (d.type === "dg-unpin") document.querySelectorAll(".dg-pinned").forEach((n) => n.classList.remove("dg-pinned"));
    if (d.type === "dg-flag") {
      document.querySelectorAll("[data-dg-flag]").forEach((n) => n.removeAttribute("data-dg-flag"));
      let first = null;
      (d.items || []).forEach((it) => {
        let found = [];
        try { found = [...document.querySelectorAll(it.selector)].slice(0, 12); } catch (err) {}
        found.forEach((n) => { n.setAttribute("data-dg-flag", it.tone || "issue"); if (!first && it.tone === "focus") first = n; });
      });
      if (first && d.scroll) first.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    if (d.type === "dg-tokens") {
      let t = document.getElementById("dg-live-tokens");
      if (!t) { t = document.createElement("style"); t.id = "dg-live-tokens"; (document.head || document.documentElement).appendChild(t); }
      document.querySelectorAll('style[data-design-gravity="tokens"]').forEach((n) => n.remove());
      t.textContent = d.css || "";
    }
  });
  document.addEventListener("mouseover", (e) => {
    if (!marking) return;
    clear(); hovered = e.target; if (hovered && hovered.classList) hovered.classList.add("dg-hover");
  }, true);
  document.addEventListener("click", (e) => {
    if (!marking) { const a = e.target.closest && e.target.closest("a[href]"); if (a) e.preventDefault(); return; }
    e.preventDefault(); e.stopPropagation();
    const el = e.target; clear();
    document.querySelectorAll(".dg-pinned").forEach((n) => n.classList.remove("dg-pinned"));
    if (el.classList) el.classList.add("dg-pinned");
    const snippet = el.outerHTML.replace(/ class="([^"]*)"/, (m, c) => { const k = c.replace(/\\bdg-(hover|pinned)\\b/g, "").trim(); return k ? ' class="' + k + '"' : ""; }).slice(0, 700);
    parent.postMessage({ type: "dg-pick", selector: path(el), snippet, label: label(el) }, "*");
  }, true);
  document.addEventListener("submit", (e) => e.preventDefault(), true);
  // Full page height for the canvas, with the viewport it was measured at
  // (the canvas trusts only measurements taken at the frame's nominal size).
  const report = () => parent.postMessage({ type: "dg-size", h: Math.ceil(document.documentElement.scrollHeight), vh: innerHeight }, "*");
  addEventListener("load", report);
  if (window.ResizeObserver) new ResizeObserver(report).observe(document.documentElement);
  addEventListener("keydown", (e) => { if (e.key === "Escape") parent.postMessage({ type: "dg-escape" }, "*"); });
})();`;

/** Compose the iframe document: agent source + live token overrides + picker. */
/** Point attachments/... references at data URLs the sandbox can load. */
export function resolveAttachments(source: string, urls?: Record<string, string>): string {
  if (!urls) return source;
  let out = source;
  for (const [path, url] of Object.entries(urls)) out = out.split(path).join(url);
  return out;
}

export function frameDoc(
  artifact: Artifact,
  overrides: TokenOverrides,
  interactive = true,
  urls?: Record<string, string>,
): string {
  if (urls && Object.keys(urls).length) artifact = { ...artifact, content: resolveAttachments(artifact.content, urls) };
  const css = overrideCss(overrides);
  const tokenStyle = css ? `<style data-design-gravity="tokens">${css}</style>` : "";
  const script = interactive ? `<script>${PICKER}</script>` : "";

  if (artifact.file.endsWith(".svg")) {
    const svg = artifact.content.replace(/<\?xml[^>]*\?>/, "");
    const withTokens = css
      ? svg.replace(/(<svg\b[^>]*>)/i, `$1<style data-design-gravity="tokens">${css}</style>`)
      : svg;
    return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;overflow:hidden;background:transparent}svg{display:block;width:100%;height:100%}</style></head><body>${withTokens}${script}</body></html>`;
  }

  let doc = artifact.content;
  const inject = tokenStyle + script;
  if (/<\/head>/i.test(doc)) doc = doc.replace(/<\/head>/i, `${tokenStyle}</head>`);
  else doc = tokenStyle + doc;
  if (script) {
    if (/<\/body>/i.test(doc)) doc = doc.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${script}</body>`);
    else doc += script;
  }
  return inject ? doc : artifact.content;
}
