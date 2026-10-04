import type { DesignMeta, LogLine } from "../../lib/types";
import { ProgressMeta, clock, useElapsed } from "../ui/Progress";

const turnStart = (d: DesignMeta) => [...d.entries].reverse().find((e) => e.role !== "system")?.at ?? d.updatedAt;

/** The desk while a new design is being made: one quiet status, nothing else. */
export function FirstBuild({ design: d, onStop }: { design: DesignMeta; lines: LogLine[]; onStop(): void }) {
  return (
    <div className="first-build" role="status" aria-live="polite">
      <span className="build-spin" aria-hidden />
      <p className="first-build-title">Designing</p>
      <ProgressMeta from={turnStart(d)} typical="Usually 1–3 minutes" slowAfter={240} onStop={onStop} />
    </div>
  );
}

/** Small floating status over the current design while a change is made. */
export function RevisionPill({ design: d }: { design: DesignMeta; lines: LogLine[] }) {
  const elapsed = useElapsed(turnStart(d));
  return (
    <div className="revision-pill" role="status">
      <span className="build-spin" aria-hidden />
      <span>Revising</span>
      <span className="build-clock">{clock(elapsed)}</span>
    </div>
  );
}
