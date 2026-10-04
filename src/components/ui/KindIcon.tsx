import { AppWindow, Monitor, PenTool } from "lucide-react";
import type { DesignKind } from "../../lib/types";

const ICONS = { screen: Monitor, mockup: AppWindow, graphic: PenTool } satisfies Record<DesignKind, unknown>;

export function KindIcon({ kind }: { kind: DesignKind }) {
  const Icon = ICONS[kind] ?? Monitor;
  return <Icon aria-hidden />;
}

/**
 * Line drawings that show what each kind produces. Strokes use currentColor;
 * `.art-accent` picks up the accent so the selected card can light one detail.
 */
export function KindArt({ kind }: { kind: DesignKind }) {
  const common = {
    viewBox: "0 0 120 80",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.25,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className: "kind-art",
  };

  if (kind === "screen") {
    return (
      <svg {...common}>
        <rect x="14" y="10" width="92" height="60" rx="4" />
        <path d="M14 19h92" />
        <circle cx="19.5" cy="14.5" r="1" fill="currentColor" stroke="none" />
        <circle cx="23.5" cy="14.5" r="1" fill="currentColor" stroke="none" />
        <path className="art-accent" d="M22 29h34" strokeWidth="3" />
        <path d="M22 35h24" strokeWidth="3" opacity=".55" />
        <path d="M66 28h32M66 32h26M66 36h29" opacity=".55" />
        <rect x="22" y="45" width="22" height="17" rx="2" />
        <rect x="49" y="45" width="22" height="17" rx="2" />
        <rect x="76" y="45" width="22" height="17" rx="2" />
      </svg>
    );
  }

  if (kind === "mockup") {
    return (
      <svg {...common}>
        {/* laptop */}
        <rect x="12" y="14" width="68" height="44" rx="3" />
        <path d="M6 62h80l-4 4H10z" />
        <path d="M18 22h20" strokeWidth="2.5" opacity=".55" />
        <rect x="18" y="28" width="26" height="22" rx="1.5" opacity=".55" />
        <rect x="48" y="28" width="26" height="10" rx="1.5" opacity=".55" />
        <rect x="48" y="41" width="26" height="9" rx="1.5" opacity=".55" />
        {/* phone, in front */}
        <rect x="76" y="20" width="30" height="52" rx="6" fill="var(--kind-card-bg)" />
        <path d="M86 24.5h10" />
        <path className="art-accent" d="M81 33h14" strokeWidth="3" />
        <path d="M81 39h20M81 43h16" opacity=".55" />
        <rect x="81" y="49" width="20" height="16" rx="2" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <rect x="36" y="6" width="48" height="68" rx="2" />
      <circle className="art-accent" cx="60" cy="30" r="13" />
      <path d="M44 52h32" strokeWidth="3" />
      <path d="M44 58h22" strokeWidth="3" opacity=".55" />
      <path d="M44 67h10M68 67h8" opacity=".55" />
    </svg>
  );
}
