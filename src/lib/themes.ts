import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

/* App themes. Each theme sets the base tokens from base.css; washes, guides and
   hairlines are derived there from these, so a theme only names its colours. */

export interface Theme {
  id: string;
  name: string;
  blurb: string;
  scheme: "dark" | "light";
  paper: string;
  desk: string;
  raised: string;
  raised2: string;
  /** The recessed well behind the page on the desk. */
  well: string;
  ink: string;
  ink2: string;
  ink3: string;
  /** Cool light: state, guides, success. */
  blue: string;
  /** Warm light: the one action. */
  magenta: string;
  magentaInk: string;
  onAccent: string;
  teal: string;
  alert: string;
}

export const THEMES: Theme[] = [
  {
    id: "night",
    name: "Night Studio",
    blurb: "Violet-black ground, aurora and ember.",
    scheme: "dark",
    paper: "#0f0e14",
    desk: "#17161e",
    raised: "#1c1b24",
    raised2: "#26252f",
    well: "#0b0a10",
    ink: "#eceaf2",
    ink2: "#b4b1c0",
    ink3: "#85828f",
    blue: "#9d94ff",
    magenta: "#ff8a5c",
    magentaInk: "#ffab8a",
    onAccent: "#1a0f0a",
    teal: "#5fe0c8",
    alert: "#ff7a7a",
  },
  {
    id: "midnight",
    name: "Midnight Ink",
    blurb: "Deep navy with cyan state and coral action.",
    scheme: "dark",
    paper: "#0b1018",
    desk: "#121926",
    raised: "#172030",
    raised2: "#212b3d",
    well: "#080c13",
    ink: "#e6edf7",
    ink2: "#a8b4c7",
    ink3: "#7a8699",
    blue: "#6cc7ff",
    magenta: "#ff7a6b",
    magentaInk: "#ffa093",
    onAccent: "#1a0b09",
    teal: "#5fe0c8",
    alert: "#ff6b81",
  },
  {
    id: "forest",
    name: "Forest",
    blurb: "Moss-dark greens, sage state, amber action.",
    scheme: "dark",
    paper: "#0d120f",
    desk: "#141b17",
    raised: "#19221d",
    raised2: "#232e27",
    well: "#090d0b",
    ink: "#e7eee9",
    ink2: "#adbbb2",
    ink3: "#7d8b82",
    blue: "#8fd6a8",
    magenta: "#f2b54a",
    magentaInk: "#f7ca79",
    onAccent: "#1a1206",
    teal: "#6fe0d0",
    alert: "#ff7a6e",
  },
  {
    id: "espresso",
    name: "Espresso",
    blurb: "Warm roasted browns with gold and rose.",
    scheme: "dark",
    paper: "#14100d",
    desk: "#1c1713",
    raised: "#221c17",
    raised2: "#2e2620",
    well: "#0f0c0a",
    ink: "#f2ebe4",
    ink2: "#c2b5a8",
    ink3: "#8f8276",
    blue: "#e6c07a",
    magenta: "#f0788a",
    magentaInk: "#f59eab",
    onAccent: "#1a0a0d",
    teal: "#7fd6c0",
    alert: "#ff7a6a",
  },
  {
    id: "graphite",
    name: "Graphite",
    blurb: "Neutral greys, electric blue, lime action.",
    scheme: "dark",
    paper: "#111112",
    desk: "#18181a",
    raised: "#1e1e21",
    raised2: "#29292d",
    well: "#0c0c0d",
    ink: "#ededee",
    ink2: "#b3b3b8",
    ink3: "#838389",
    blue: "#7aa2ff",
    magenta: "#c6f35e",
    magentaInk: "#d8f78e",
    onAccent: "#121a04",
    teal: "#5fe0c8",
    alert: "#ff7070",
  },
  {
    id: "paper",
    name: "Paper",
    blurb: "Light coated stock, blueline and proof red.",
    scheme: "light",
    paper: "#f6f4ef",
    desk: "#ece9e2",
    raised: "#ffffff",
    raised2: "#e4e0d7",
    well: "#dedad1",
    ink: "#1b1a1f",
    ink2: "#4b4852",
    ink3: "#6b6771",
    blue: "#4a55d6",
    magenta: "#c8401f",
    magentaInk: "#a8341a",
    onAccent: "#ffffff",
    teal: "#128a76",
    alert: "#c9303a",
  },
  {
    id: "porcelain",
    name: "Porcelain",
    blurb: "Cool blue-white, indigo state, cobalt action.",
    scheme: "light",
    paper: "#f3f5f9",
    desk: "#e8ecf2",
    raised: "#ffffff",
    raised2: "#dde3ec",
    well: "#d6dce6",
    ink: "#141a24",
    ink2: "#444d5c",
    ink3: "#636b7a",
    blue: "#5a4fd0",
    magenta: "#1f6fe0",
    magentaInk: "#1759b8",
    onAccent: "#ffffff",
    teal: "#0f8577",
    alert: "#c8323f",
  },
  {
    id: "sage",
    name: "Sage",
    blurb: "Pale green linen, pine state, terracotta action.",
    scheme: "light",
    paper: "#f2f4ee",
    desk: "#e6eae0",
    raised: "#fbfcf8",
    raised2: "#d9dfd1",
    well: "#d2d9c9",
    ink: "#18201a",
    ink2: "#46514a",
    ink3: "#626d64",
    blue: "#2f7a55",
    magenta: "#b84a26",
    magentaInk: "#9a3d1e",
    onAccent: "#ffffff",
    teal: "#177f78",
    alert: "#c23a3a",
  },
  {
    id: "sand",
    name: "Sand",
    blurb: "Warm dune beige, ochre state, espresso action.",
    scheme: "light",
    paper: "#f7f1e6",
    desk: "#efe6d6",
    raised: "#fffaf1",
    raised2: "#e5d9c4",
    well: "#ddd0b8",
    ink: "#241c12",
    ink2: "#54493b",
    ink3: "#716555",
    blue: "#94600f",
    magenta: "#5b3a22",
    magentaInk: "#452a17",
    onAccent: "#fff7ec",
    teal: "#2f7f6f",
    alert: "#c0392b",
  },
  {
    id: "blush",
    name: "Blush",
    blurb: "Soft rosé paper, plum state, raspberry action.",
    scheme: "light",
    paper: "#faf3f3",
    desk: "#f2e6e7",
    raised: "#fffafa",
    raised2: "#e9d8da",
    well: "#e2cfd2",
    ink: "#241619",
    ink2: "#56444a",
    ink3: "#766268",
    blue: "#7b45a8",
    magenta: "#d12f63",
    magentaInk: "#ae2250",
    onAccent: "#ffffff",
    teal: "#15817a",
    alert: "#c7322f",
  },
];

export const DEFAULT_THEME = "night";

export const findTheme = (id: string) => THEMES.find((t) => t.id === id) ?? THEMES[0];

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
};

/** Writes a theme's tokens onto <html>; everything else follows the variables. */
export function applyTheme(id: string) {
  const t = findTheme(id);
  const root = document.documentElement;
  const vars: Record<string, string> = {
    "--paper": t.paper,
    "--paper-rgb": rgb(t.paper),
    "--desk": t.desk,
    "--raised": t.raised,
    "--raised-2": t.raised2,
    "--well": t.well,
    "--ink": t.ink,
    "--ink-rgb": rgb(t.ink),
    "--ink-2": t.ink2,
    "--ink-3": t.ink3,
    "--hl": t.scheme === "dark" ? "255 255 255" : "0 0 0",
    "--blue": t.blue,
    "--magenta": t.magenta,
    "--magenta-ink": t.magentaInk,
    "--on-accent": t.onAccent,
    "--teal": t.teal,
    "--alert": t.alert,
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.style.colorScheme = t.scheme;
  root.dataset.theme = t.id;
  // The frameless window still has a native backdrop (seen while resizing), a
  // native theme (snap menu, shadow) and, on Windows 11, a 1px DWM border that
  // is white by default; keep all three on the theme.
  if (isTauri()) {
    const win = getCurrentWindow();
    void win.setBackgroundColor(t.paper).catch(() => {});
    void win.setTheme(t.scheme).catch(() => {});
    void invoke("window_border", { color: t.scheme === "dark" ? t.raised : t.raised2 }).catch(() => {});
  }
}
