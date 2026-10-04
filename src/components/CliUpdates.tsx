import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, TriangleAlert, X } from "lucide-react";
import { backend } from "../lib/backend";
import { providerOf, useStudio } from "../lib/studio";
import { PROVIDERS, PROVIDER_LIST, cliPath } from "../lib/providers";
import type { Provider } from "../lib/types";
import { ProviderIcon } from "./ProviderIcon";

/** How often an open app asks again whether a CLI has a new release. */
const CHECK_EVERY = 60 * 1000;
const toastId = (p: Provider) => "cli-update-" + p;
/** The release the designer closed the notice for; a newer one asks again. */
const dismissKey = (p: Provider) => "dg-update-dismissed-" + p;
/** Providers updating from their notice, which reports the result itself. */
const selfUpdating = new Set<Provider>();

/** "codex-cli 0.157.1" / "1.2.16" -> [0, 157, 1] / [1, 2, 16]. */
function parts(v?: string | null): number[] | null {
  const m = v?.match(/\d+(?:\.\d+)+/);
  return m ? m[0].split(".").map(Number) : null;
}

/** True when `latest` is a later release than `current`. */
export function isNewer(latest?: string | null, current?: string | null): boolean {
  const a = parts(latest);
  const b = parts(current);
  if (!a || !b) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d > 0;
  }
  return false;
}

function readDismissed(p: Provider): string | null {
  try {
    return localStorage.getItem(dismissKey(p));
  } catch {
    return null;
  }
}

/** The CLI's last meaningful output line, for a failed update. */
const lastLine = (text: string) =>
  text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() ?? "The updater stopped without saying why.";

function UpdateToast({ provider, latest }: { provider: Provider; latest: string }) {
  const s = useStudio();
  const info = PROVIDERS[provider];
  const current = s.providers[provider].status?.version;
  const [state, setState] = useState<"idle" | "updating" | "done" | "failed">("idle");
  const [detail, setDetail] = useState("");
  // Swapping the binary under a running agent would break that run.
  const running = s.designs.some((d) => d.status === "generating" && providerOf(d) === provider);

  const close = () => {
    if (state !== "done") {
      try {
        localStorage.setItem(dismissKey(provider), latest);
      } catch {
        /* the notice simply returns next launch */
      }
    }
    toast.dismiss(toastId(provider));
  };

  const update = async () => {
    setState("updating");
    setDetail("");
    selfUpdating.add(provider);
    try {
      await backend.cliUpdate(cliPath(s.settings, provider), provider);
      const after = await s.refreshStatus(provider);
      if (isNewer(latest, after.version)) {
        setState("failed");
        setDetail(`Still on ${after.version ?? "an unknown version"}. Try \`${info.cli} update\` in a terminal.`);
      } else {
        setState("done");
        setTimeout(() => {
          selfUpdating.delete(provider);
          toast.dismiss(toastId(provider));
        }, 5000);
        return;
      }
    } catch (e) {
      setState("failed");
      setDetail(lastLine(String(e)));
    }
    selfUpdating.delete(provider);
  };

  const title =
    state === "updating"
      ? `Updating ${info.name}`
      : state === "done"
        ? `${info.name} updated to ${latest}`
        : state === "failed"
          ? `${info.name} update failed`
          : `${info.name} ${latest} is available`;
  const sub =
    state === "updating"
      ? `Running ${info.cli} update`
      : state === "done"
        ? "New runs use the new version."
        : state === "failed"
          ? detail
          : running
            ? "Finish the running designs to update."
            : `You have ${current ?? "an older version"}.`;

  return (
    <div
      className="dock dock-update"
      data-state={state === "updating" ? "busy" : state === "done" ? "done" : state === "failed" ? "failed" : "idle"}
      role="status"
      aria-live="polite"
    >
      <span className="dock-mark" aria-hidden>
        {state === "updating" ? (
          <span className="build-spin" />
        ) : state === "done" ? (
          <Check />
        ) : state === "failed" ? (
          <TriangleAlert />
        ) : (
          <ProviderIcon id={provider} />
        )}
      </span>
      <span className="dock-text">
        <span className="dock-title">{title}</span>
        <span className="dock-detail">
          <span className="dock-step" title={sub}>{sub}</span>
        </span>
      </span>
      {(state === "idle" || state === "failed") && (
        <button className="btn btn-sm btn-primary" onClick={update} disabled={running}>
          {state === "failed" ? "Retry" : "Update"}
        </button>
      )}
      {state !== "updating" && (
        <button className="icon-btn" onClick={close} aria-label="Dismiss" title="Dismiss">
          <X aria-hidden />
        </button>
      )}
      {state === "updating" && (
        <span className="dock-bar is-indeterminate" aria-hidden>
          <i />
        </span>
      )}
    </div>
  );
}

/**
 * Watches the installed agent CLIs and offers an update, as a notice with
 * Update and dismiss, when a newer release is published. A closed notice
 * stays closed until the next release; failed checks (offline) stay silent.
 */
export function CliUpdates() {
  const s = useStudio();
  const checkedAt = useRef<Partial<Record<Provider, number>>>({});
  const shown = useRef<Partial<Record<Provider, string>>>({});
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), CHECK_EVERY);
    return () => clearInterval(t);
  }, []);

  const versions = PROVIDER_LIST.map((p) => s.providers[p.id].status?.version ?? "").join("|");
  useEffect(() => {
    for (const { id: p } of PROVIDER_LIST) {
      const status = s.providers[p].status;
      if (!status?.installed || !status.version) continue;
      const version = status.version;

      // Updated outside the notice (a terminal, another app): withdraw it.
      const offered = shown.current[p];
      if (offered && !isNewer(offered, version) && !selfUpdating.has(p)) {
        shown.current[p] = undefined;
        toast.dismiss(toastId(p));
      }

      const last = checkedAt.current[p];
      // A little slack, so the interval tick is never a hair too early.
      if (last && Date.now() - last < CHECK_EVERY - 5000) continue;
      checkedAt.current[p] = Date.now();
      backend
        .cliLatest(p)
        .then((latest) => {
          if (!latest || !isNewer(latest, version) || readDismissed(p) === latest) return;
          if (shown.current[p] === latest) return;
          shown.current[p] = latest;
          toast.custom(() => <UpdateToast provider={p} latest={latest} />, {
            id: toastId(p),
            duration: Infinity,
            dismissible: false,
          });
        })
        .catch(() => {
          // Offline or the source is down: try again on the next round.
          checkedAt.current[p] = undefined;
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versions, tick]);

  return null;
}
