import type { CSSProperties } from "react";
import type { Provider } from "../lib/types";
import antigravity from "../assets/providers/antigravity.svg";
import codex from "../assets/providers/codex.png";

// The vendors' own marks, taken from the Antigravity IDE and Codex app installs.
const LOGOS: Record<Provider, string> = { antigravity, codex };

/** Official mark as a mask, so it takes the surrounding text colour in every theme. */
export function ProviderIcon({ id, className }: { id: Provider; className?: string }) {
  const url = `url("${LOGOS[id]}")`;
  const style: CSSProperties = { maskImage: url, WebkitMaskImage: url };
  return <span className={"provider-logo" + (className ? " " + className : "")} style={style} aria-hidden />;
}
