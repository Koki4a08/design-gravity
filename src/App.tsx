import { useEffect, useRef, useState } from "react";
import { useStudio } from "./lib/studio";
import { Wall } from "./components/Wall";
import { Spread } from "./components/Spread";
import { Toast } from "./components/Toast";
import { SettingsModal } from "./components/SettingsModal";
import type { SettingsPage } from "./components/SettingsModal";
import { SettingsCtx } from "./components/SettingsButton";
import { BuilderHost } from "./components/BuilderHost";
import { CliUpdates } from "./components/CliUpdates";
import { Titlebar } from "./components/Titlebar";

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
