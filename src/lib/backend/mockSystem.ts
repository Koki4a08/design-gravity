// Sample data for the browser-only preview of the design-system builder.
export const MOCK_QUESTIONS = {
  name: "Harbor",
  questions: [
    { id: "personality", title: "How should the brand feel?", why: "Sets the tone for every choice after it.", multi: true, visual: "text",
      options: [
        { id: "calm", label: "Calm", hint: "Quiet, unhurried" },
        { id: "precise", label: "Precise", hint: "Exact, engineered" },
        { id: "warm", label: "Warm", hint: "Human, approachable" },
        { id: "bold", label: "Bold", hint: "Confident, loud" },
        { id: "playful", label: "Playful", hint: "Light, surprising" },
      ] },
    { id: "theme", title: "Light, dark, or both?", why: "Decides how many colour sets to build.", multi: false, visual: "text",
      options: [
        { id: "light", label: "Light", hint: "Daylight reading" },
        { id: "dark", label: "Dark", hint: "Low light, focus" },
        { id: "both", label: "Both", hint: "Follows the system" },
      ] },
    { id: "palette", title: "Which colour direction?", why: "Colour carries most of the identity.", multi: false, visual: "palette",
      options: [
        { id: "clay", label: "Clay & ink", hint: "Warm paper, one earthy accent", swatches: ["#f6f1ea", "#ece4d8", "#1f1b16", "#b4532a", "#2f6f62"] },
        { id: "harbor", label: "Harbor", hint: "Sea blues with a signal orange", swatches: ["#f3f6f8", "#e2e9ee", "#0f2230", "#1c5d8c", "#f08a24"] },
        { id: "forest", label: "Forest night", hint: "Deep greens, soft cream", swatches: ["#0f1a15", "#18261f", "#eef0e6", "#6fbf8e", "#e0b95b"] },
        { id: "mono", label: "Monochrome", hint: "Greys with electric lime", swatches: ["#fafafa", "#ededed", "#111111", "#222222", "#c6f432"] },
      ] },
    { id: "type", title: "Which type pairing?", why: "Type is most of what people read.", multi: false, visual: "type",
      options: [
        { id: "fraunces", label: "Editorial", hint: "Soft serif display, clean sans", display: "Fraunces", body: "Public Sans" },
        { id: "grotesk", label: "Swiss", hint: "One precise grotesk", display: "Schibsted Grotesk", body: "Schibsted Grotesk" },
        { id: "humanist", label: "Friendly", hint: "Round, open shapes", display: "Bricolage Grotesque", body: "Atkinson Hyperlegible" },
        { id: "classic", label: "Classic", hint: "Book serif throughout", display: "Young Serif", body: "Literata" },
      ] },
    { id: "shape", title: "What corner language?", why: "Shape changes how soft or strict it feels.", multi: false, visual: "shape",
      options: [
        { id: "sharp", label: "Sharp", hint: "0-2px" },
        { id: "subtle", label: "Subtle", hint: "4-6px" },
        { id: "rounded", label: "Rounded", hint: "10-14px" },
        { id: "pill", label: "Pill", hint: "Fully round controls" },
      ] },
    { id: "density", title: "How dense is the interface?", why: "Density trades overview against calm.", multi: false, visual: "density",
      options: [
        { id: "compact", label: "Compact", hint: "4px base" },
        { id: "comfortable", label: "Comfortable", hint: "8px base" },
        { id: "spacious", label: "Spacious", hint: "12px base" },
      ] },
    { id: "depth", title: "How do surfaces separate?", why: "Depth tells people what sits above what.", multi: false, visual: "text",
      options: [
        { id: "flat", label: "Flat with borders", hint: "Hairlines, no shadows" },
        { id: "soft", label: "Soft shadows", hint: "Gentle lift" },
        { id: "layered", label: "Layered", hint: "Clear elevation steps" },
        { id: "outline", label: "Bold outlines", hint: "Thick strokes, graphic" },
      ] },
    { id: "components", title: "What should it cover first?", why: "We build these in every state.", multi: true, visual: "text",
      options: [
        { id: "buttons", label: "Buttons" }, { id: "forms", label: "Forms & inputs" }, { id: "nav", label: "Navigation" },
        { id: "cards", label: "Cards" }, { id: "tables", label: "Data tables" }, { id: "modals", label: "Modals" },
        { id: "feedback", label: "Alerts & toasts" }, { id: "charts", label: "Charts" },
      ] },
  ],
};

export const MOCK_SPEC = JSON.stringify({
  name: "Harbor",
  summary: "Warm editorial system with one clay accent.",
  colors: { light: { background: "#f6f1ea", surface: "#ece4d8", text: "#1f1b16", primary: "#b4532a", accent: "#2f6f62", muted: "#6b6258", border: "#d9cfc1" }, dark: null },
  typography: { display: { family: "Fraunces" }, body: { family: "Public Sans" }, scale: [] },
  radius: { sm: 4, md: 6, lg: 10, full: 999 },
  spacing: { base: 8, scale: [4, 8, 12, 16, 24, 32, 48] },
  components: ["Buttons", "Forms", "Cards"],
});

export const MOCK_PREVIEW = `<!doctype html><html><head><link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=Public+Sans:wght@400;600&display=swap" rel="stylesheet"><style>
:root{--bg:#f6f1ea;--surface:#ece4d8;--text:#1f1b16;--muted:#6b6258;--primary:#b4532a;--accent:#2f6f62;--border:#d9cfc1;--r:6px}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 "Public Sans",sans-serif;padding:56px}
h1{font:700 64px/1 Fraunces,serif;letter-spacing:-.02em;margin:0 0 8px}h2{font:600 13px/1 "Public Sans";text-transform:none;color:var(--muted);margin:48px 0 16px}
.sw{display:flex;gap:12px}.sw div{width:120px}.sw i{display:block;height:72px;border-radius:var(--r);border:1px solid var(--border)}.sw b{display:block;font-size:13px;margin-top:6px}.sw span{font-size:12px;color:var(--muted)}
.row{display:flex;gap:12px;align-items:center}button{font:600 15px "Public Sans";padding:12px 20px;border-radius:var(--r);border:1px solid transparent;background:var(--primary);color:#fff}
button.s{background:transparent;border-color:var(--text);color:var(--text)}button[disabled]{opacity:.4}
input{font:inherit;padding:11px 14px;border:1px solid var(--border);border-radius:var(--r);background:#fff;width:260px}
.card{background:var(--surface);border-radius:10px;padding:24px;width:300px}.card h3{font:600 24px/1.1 Fraunces;margin:0 0 8px}
</style></head><body><h1>Harbor</h1><p style="color:var(--muted);max-width:52ch">Warm editorial system with one clay accent.</p>
<h2>Colour</h2><div class="sw"><div><i style="background:var(--bg)"></i><b>Background</b><span>#f6f1ea</span></div><div><i style="background:var(--surface)"></i><b>Surface</b><span>#ece4d8</span></div><div><i style="background:var(--text)"></i><b>Text</b><span>#1f1b16</span></div><div><i style="background:var(--primary)"></i><b>Primary</b><span>#b4532a</span></div><div><i style="background:var(--accent)"></i><b>Accent</b><span>#2f6f62</span></div></div>
<h2>Buttons</h2><div class="row"><button>Primary</button><button class="s">Secondary</button><button disabled>Disabled</button></div>
<h2>Forms</h2><div class="row"><input placeholder="Email address"><input value="Invalid value" style="border-color:#b42318"></div>
<h2>Cards</h2><div class="row"><div class="card"><h3>Press days</h3><p>Twelve days a month on the Vandercook.</p></div></div>
</body></html>`;
