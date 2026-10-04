import { useEffect, useRef, useState } from "react";
import { useStudio } from "./lib/state/studio";
import { Wall } from "./components/hub/Wall";
import { Spread } from "./components/editor/Spread";
import { Toast } from "./components/shell/Toast";
import { SettingsModal } from "./components/shell/SettingsModal";
import type { SettingsPage } from "./components/shell/SettingsModal";
import { SettingsCtx } from "./components/shell/SettingsButton";
import { BuilderHost } from "./components/systems/BuilderHost";
import { CliUpdates } from "./components/shell/CliUpdates";
import { Titlebar } from "./components/shell/Titlebar";

export default function App() {
  const { status, activeId, designs } = useStudio();
  const [settings, setSettings] = useState(false);
  const [page, setPage] = useState<SettingsPage>("general");
  const prompted = useRef(false);
  const active = designs.find((d) => d.id === activeId);

  // First launch without a working agy: open the provider page once.
  useEffect(() => {
    if (!status || prompted.current) return;
    prompted.current = true;
    if (!status.installed || !status.authenticated) {
      setPage("providers");
      setSettings(true);
    }
  }, [status]);

  const open = (p?: SettingsPage) => {
    if (p) setPage(p);
    setSettings(true);
  };

  return (
    <SettingsCtx.Provider value={open}>
      <BuilderHost>
        <Titlebar />
        <main className="app">{active ? <Spread key={active.group?.id ?? active.id} design={active} /> : <Wall />}</main>
        <SettingsModal open={settings} page={page} onPage={setPage} onClose={() => setSettings(false)} />
        <Toast />
        <CliUpdates />
      </BuilderHost>
    </SettingsCtx.Provider>
  );
}
