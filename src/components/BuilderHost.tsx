import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Toaster, toast } from "sonner";
import { Check, TriangleAlert, X } from "lucide-react";
import { useStudio } from "../lib/studio";
import { useSystems } from "../lib/systemsStore";
import { SystemBuilder, buildProgress } from "./SystemBuilder";
import { clock, useElapsed } from "./Progress";

/** Open the design-system builder: a new system (null) or an existing one. */
/** Open the builder: a new system (null) or an existing one; `fromDesign` starts it from a design. */
type OpenBuilder = (id: string | null, opts?: { fromDesign?: string }) => void;
const Ctx = createContext<OpenBuilder>(() => {});
export const useOpenBuilder = () => useContext(Ctx);

const dockId = (id: string) => "system-build-" + id;

/**
 * The minimized build: one line of progress and a way back into the builder.
 * Sits bottom left, above the canvas toolbar and clear of the chat composer.
 */
function BuildToast({ id, onOpen }: { id: string; onOpen(): void }) {
  const s = useStudio();
  const sys = useSystems();
  const meta = sys.systems.find((m) => m.id === id);
  const turn = meta?.turns[meta.turns.length - 1];
  const elapsed = useElapsed(turn?.at ?? Date.now());

  // The system was deleted elsewhere: nothing left to report.
  useEffect(() => {
    if (!meta) toast.dismiss(dockId(id));
  }, [meta, id]);
  if (!meta) return null;

  const busy = meta.status === "generating";
  const failed = !busy && meta.status === "failed";
  const { steps, active, done } = buildProgress(meta, s.logs[id] ?? []);
  const verb = turn?.kind === "revise" ? "Updating" : "Building";

  const title = busy ? `${verb} ${meta.name}` : failed ? `${meta.name} didn’t build` : `${meta.name} is ready`;
  const detail = busy ? steps[active]?.label ?? "Finishing up" : failed ? "Open it to try again" : "Review it and save";

  return (
    <div className="dock" data-state={busy ? "busy" : failed ? "failed" : "done"} role="status" aria-live="polite">
      <span className="dock-mark" aria-hidden>
        {busy ? <span className="build-spin" /> : failed ? <TriangleAlert /> : <Check />}
      </span>
      <span className="dock-text">
        <span className="dock-title">{title}</span>
        <span className="dock-detail">
          <span className="dock-step">{detail}</span>
          {busy && <span className="dock-clock">{clock(elapsed)}</span>}
        </span>
      </span>
      <button className="btn btn-sm" onClick={onOpen}>
        {busy ? "Open" : "Review"}
      </button>
      {!busy && (
        <button className="icon-btn" onClick={() => toast.dismiss(dockId(id))} aria-label="Dismiss">
          <X aria-hidden />
        </button>
      )}
      {busy && (
        <span className="dock-bar" aria-hidden>
          <i style={{ width: `${Math.max(6, (done / steps.length) * 100)}%` }} />
        </span>
      )}
    </div>
  );
}

/** Owns the builder modal app-wide so a minimized build can be reopened from any screen. */
export function BuilderHost({ children }: { children: ReactNode }) {
  const s = useStudio();
  const [open, setOpen] = useState<{ id: string | null; fromDesign?: string } | null>(null);

  const openBuilder = useCallback<OpenBuilder>((id, opts) => {
    if (id) toast.dismiss(dockId(id));
    setOpen({ id, fromDesign: opts?.fromDesign });
  }, []);

  const minimize = useCallback(
    (id: string) => {
      setOpen(null);
      toast.custom(() => <BuildToast id={id} onOpen={() => openBuilder(id)} />, {
        id: dockId(id),
        duration: Infinity,
        dismissible: false,
      });
    },
    [openBuilder],
  );

  return (
    <Ctx.Provider value={openBuilder}>
      {children}
      {open && (
        <SystemBuilder
          key={open.id ?? "new"}
          editId={open.id}
          fromDesign={open.fromDesign}
          onClose={() => setOpen(null)}
          onMinimize={minimize}
          onSaved={(sid) => s.setSettings({ systemId: sid })}
        />
      )}
      <Toaster position="bottom-left" offset={{ left: 20, bottom: 72 }} gap={8} toastOptions={{ unstyled: true }} />
    </Ctx.Provider>
  );
}
