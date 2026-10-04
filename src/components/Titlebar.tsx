import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useStudio } from "../lib/studio";
import { LogoMark } from "./Logo";
import { SettingsButton } from "./SettingsButton";

const native = isTauri();

/**
 * The window's own title bar (native decorations are off). Colours come from
 * the theme tokens, so it follows whatever theme the user picks.
 */
export function Titlebar() {
  const { activeId } = useStudio();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!native) return;
    const win = getCurrentWindow();
    const sync = () => void win.isMaximized().then(setMaximized);
    sync();
    const off = win.onResized(sync);
    return () => void off.then((f) => f());
  }, []);

  const win = () => (native ? getCurrentWindow() : null);

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-brand" data-tauri-drag-region>
        <LogoMark />
        <span data-tauri-drag-region>Design Gravity</span>
      </div>
      <div className="titlebar-tools">{!activeId && <SettingsButton />}</div>
      {native && (
        <div className="titlebar-controls">
          <button type="button" aria-label="Minimize" onClick={() => win()?.minimize()}>
            <svg viewBox="0 0 10 10" aria-hidden><path d="M0 5.5h10" /></svg>
          </button>
          <button type="button" aria-label={maximized ? "Restore" : "Maximize"} onClick={() => win()?.toggleMaximize()}>
            {maximized ? (
              <svg viewBox="0 0 10 10" aria-hidden>
                <path d="M2.5 2.5V1.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" />
                <rect x="0.5" y="2.5" width="7" height="7" rx="1" />
              </svg>
            ) : (
              <svg viewBox="0 0 10 10" aria-hidden><rect x="0.5" y="0.5" width="9" height="9" rx="1" /></svg>
            )}
          </button>
          <button type="button" className="titlebar-close" aria-label="Close" onClick={() => win()?.close()}>
            <svg viewBox="0 0 10 10" aria-hidden><path d="M0.5 0.5l9 9M9.5 0.5l-9 9" /></svg>
          </button>
        </div>
      )}
    </header>
  );
}
