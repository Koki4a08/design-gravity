import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Check, Download, TriangleAlert, X } from "lucide-react";
import { backend } from "../../lib/backend/backend";
import { EXPORT_PREFIX, useStudio } from "../../lib/state/studio";
import { clock, useElapsed } from "../ui/Progress";

const toastId = (designId: string) => EXPORT_PREFIX + designId;

/** Progress of a standalone HTML build, then a button to save the file. */
function StandaloneToast({ designId }: { designId: string }) {
  const s = useStudio();
  const job = s.exports[designId];
  const lines = s.logs[toastId(designId)] ?? [];
  const elapsed = useElapsed(job?.at ?? Date.now());
  // Close once the job has been seen and then forgotten (dismissed, or the provider wasn't ready).
  const seen = useRef(false);
  useEffect(() => {
    if (job) seen.current = true;
    else if (seen.current) toast.dismiss(toastId(designId));
  }, [job, designId]);
  if (!job) return null;

  const busy = job.status === "running";
  const failed = job.status === "failed";
  const done = job.status === "done";
  const last = [...lines].reverse().find((l) => l.kind === "tool");
  const step = !last
    ? "Reading the project"
    : last.detail && /write|replace|edit/i.test(last.tool ?? "")
      ? `Writing ${last.detail}`
      : last.detail && /view|read|list|find|grep/i.test(last.tool ?? "")
        ? `Reading ${last.detail}`
        : last.verb;
  const close = () => {
    toast.dismiss(toastId(designId));
    s.forgetExport(designId);
  };

  return (
    <div className="dock" data-state={busy ? "busy" : failed ? "failed" : "done"} role="status" aria-live="polite">
      <span className="dock-mark" aria-hidden>
        {busy ? <span className="build-spin" /> : failed ? <TriangleAlert /> : <Check />}
      </span>
      <span className="dock-text">
        <span className="dock-title">
          {busy ? "Building HTML file" : failed ? "Export didn’t finish" : done ? "HTML file is ready" : "Export stopped"}
        </span>
        <span className="dock-detail">
          <span className="dock-step">{busy ? step : failed ? job.error ?? "Try again." : done ? "One file, opens in any browser." : "Nothing was saved."}</span>
          {busy && <span className="dock-clock">{clock(elapsed)}</span>}
        </span>
      </span>
      {busy ? (
        <button className="btn btn-sm" onClick={() => backend.agentCancel(toastId(designId))}>
          Stop
        </button>
      ) : (
        <>
          {done && (
            <button
              className="btn btn-sm btn-primary"
              onClick={async () => {
                if (await s.downloadStandalone(designId)) close();
              }}
            >
              <Download aria-hidden /> Download
            </button>
          )}
          <button className="icon-btn" onClick={close} aria-label="Dismiss">
            <X aria-hidden />
          </button>
        </>
      )}
      {busy && <span className="dock-bar is-indeterminate" aria-hidden><i /></span>}
    </div>
  );
}

/** Start the build and keep its progress pinned in a toast until the file is saved. */
export function startStandaloneExport(s: ReturnType<typeof useStudio>, designId: string) {
  toast.custom(() => <StandaloneToast designId={designId} />, { id: toastId(designId), duration: Infinity, dismissible: false });
  return s.exportStandalone(designId);
}
