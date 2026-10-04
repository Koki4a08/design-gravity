import { useEffect, useState } from "react";

/** Seconds since `from`, ticking once a second. */
export function useElapsed(from: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return Math.max(0, Math.round((now - from) / 1000));
}

export const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** Elapsed time, what to expect, and a way out. */
export function ProgressMeta({ from, typical, slowAfter, onStop }: {
  from: number;
  typical: string;
  slowAfter: number;
  onStop?(): void;
}) {
  const elapsed = useElapsed(from);
  return (
    <div className="build-meta">
      <span className="build-clock">{clock(elapsed)}</span>
      <span>{elapsed < slowAfter ? typical : "Taking longer than usual, still working"}</span>
      {onStop && (
        <button className="btn btn-quiet btn-sm" onClick={onStop}>
          Stop
        </button>
      )}
    </div>
  );
}
