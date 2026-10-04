import { createContext, useContext } from "react";
import { Settings2 } from "lucide-react";
import { useStudio } from "../../lib/state/studio";
import { PROVIDERS } from "../../lib/providers";
import type { SettingsPage } from "./SettingsModal";

export const SettingsCtx = createContext<(page?: SettingsPage) => void>(() => {});

/** Gear with a connection dot: blue when the active provider is ready, red when it is not. */
export function SettingsButton() {
  const open = useContext(SettingsCtx);
  const { status, checking, settings } = useStudio();
  const { name, cli } = PROVIDERS[settings.provider];
  const tone = !status ? "busy" : status.installed && status.authenticated ? "ok" : "bad";
  const label = !status
    ? `Checking ${name}`
    : tone === "ok"
      ? `${name} ready, ${cli} ${status.version ?? ""}`
      : `${name} needs attention`;
  return (
    <button className="settings-btn" onClick={() => open(tone === "bad" ? "providers" : undefined)} aria-label={`Settings. ${label}`} title={label}>
      <Settings2 aria-hidden />
      <span className="settings-dot" data-tone={checking && !status ? "busy" : tone} aria-hidden />
    </button>
  );
}
