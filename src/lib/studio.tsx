import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { backend } from "./backend";
import { foldEvent } from "./log";
import { artifactName, firstBrief, parseReply, revision, titleFromBrief, CRITIQUE_SCHEMA, critiquePrompt, standalonePrompt, STANDALONE_FILE } from "./prompts";
import { parseSpec } from "./systems";
import type { SystemSpec } from "./systems";
import { bake } from "./tokens";
import { resolveAttachments } from "./frame";
import { bakeProject, isProject, zipFiles } from "./project";
import { applyTheme, DEFAULT_THEME } from "./themes";
import { cliPath, PROVIDERS } from "./providers";
import type {
  AgyStatus, Artifact, Attachment, CritiqueNote, DesignGroup, DesignKind, DesignMeta, Entry, FramePreset, LogLine, NoteTarget, PingResult,
  ModelChoice, Provider, Settings, UsageLog,
} from "./types";

/** The chosen system's tokens, so prompts can hand the agent exact values ({} if unreadable). */
async function systemSpec(systemId?: string): Promise<SystemSpec | undefined> {
  if (!systemId) return undefined;
  const files = await backend.systemRead(systemId).catch(() => null);
  return parseSpec(files?.spec) ?? {};
}

/** Copy picked paths or pasted files into a design's attachments/. */
async function saveFiles(id: string, files: (string | File)[], onError: (e: string) => void): Promise<Attachment[]> {
  const out: Attachment[] = [];
  for (const f of files) {
    try {
      out.push(
        typeof f === "string"
          ? await backend.attachFile(id, f)
          : await backend.attachBytes(id, f.name || "pasted.png", new Uint8Array(await f.arrayBuffer())),
      );
    } catch (e) {
      onError(String(e));
    }
  }
  return out;
}

export const variantLetter = (i: number) => String.fromCharCode(65 + i);

/** A design's title as a file name. */
const slug = (d: DesignMeta) =>
  d.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "design";

/** A project's name: a frame's title without its " · A" / " · 2" suffix. */
export const projectTitle = (d: DesignMeta) => (d.group ? d.title.replace(/ · [A-Z0-9]+$/, "") : d.title);

/** How a sibling is named in its group: "Variant B" or "Screen 2". */
export const siblingName = (d: DesignMeta) =>
  d.group?.kind === "flow" ? `Screen ${d.group.index + 1}` : `Variant ${variantLetter(d.group?.index ?? 0)}`;

/** Agent runs that build a standalone HTML export use this id prefix. */
export const EXPORT_PREFIX = "export-";

/** A standalone HTML build; when done, the file waits in the workspace to be downloaded. */
export interface ExportJob {
  status: "running" | "done" | "failed" | "cancelled";
  at: number;
  reply?: string;
  error?: string;
}

export interface CreateOptions {
  /** Alternatives to generate side by side (1 to 4). */
  variants?: number;
  /** Reference images or data files for the first brief. */
  files?: (string | File)[];
}

const SETTINGS_KEY = "dg-settings";
// Antigravity keeps the original key so existing usage history survives.
const usageKey = (p: Provider) => (p === "codex" ? "dg-usage-codex" : "dg-usage");

const dayKey = (t = Date.now()) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function loadUsage(p: Provider): UsageLog {
  try {
    return { days: {}, ...JSON.parse(localStorage.getItem(usageKey(p)) || "{}") };
  } catch {
    return { days: {} };
  }
}

/** Connection, test turn and usage for one harness. */
export interface ProviderState {
  status: AgyStatus | null;
  checking: boolean;
  ping: PingResult | null;
  pinging: boolean;
  usage: UsageLog;
}

const blankState = (p: Provider): ProviderState => ({
  status: null, checking: false, ping: null, pinging: false, usage: loadUsage(p),
});

/** Designs made before providers existed ran on Antigravity. */
export const providerOf = (d: Pick<DesignMeta, "provider">): Provider => d.provider ?? "antigravity";

/** Harness and model for runs the app starts on its own. */
export const systemChoice = (s: Settings): ModelChoice =>
  s.systemProvider ? { provider: s.systemProvider, model: s.systemModel } : { provider: s.provider, model: s.model };

/** What a design runs on: its own pick, or the default model when it runs on the default provider. */
export const designChoice = (d: DesignMeta, s: Settings): ModelChoice => {
  const provider = providerOf(d);
  return { provider, model: d.model ?? (provider === s.provider ? s.model : "") };
};
const STALE_MS = 10 * 60 * 1000;

function loadSettings(): Settings {
  const base: Settings = {
    provider: "antigravity", agyPath: "", codexPath: "", model: "", favoriteModels: [],
    systemProvider: "", systemModel: "", effort: "", motion: true, systemId: "",
    theme: DEFAULT_THEME,
  };
  try {
    return { ...base, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return base;
  }
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

interface Studio {
  settings: Settings;
  setSettings(patch: Partial<Settings>): void;
  /** Default provider and model for new designs. */
  setChoice(c: ModelChoice): void;
  /** Connection state of the active provider. */
  status: AgyStatus | null;
  checking: boolean;
  ping: PingResult | null;
  pinging: boolean;
  /** Every provider's own state, for the settings page. */
  providers: Record<Provider, ProviderState>;
  /** Each takes a provider, defaulting to the active one. */
  refreshStatus(p?: Provider): Promise<AgyStatus>;
  runPing(p?: Provider): Promise<void>;
  openSignIn(p?: Provider): Promise<void>;
  designs: DesignMeta[];
  loaded: boolean;
  artifacts: Record<string, Artifact | undefined>;
  logs: Record<string, LogLine[] | undefined>;
  landed: Set<string>;
  activeId: string | null;
  open(id: string | null): void;
  create(brief: string, kind: DesignKind, frame: FramePreset, systemId?: string, opts?: CreateOptions): Promise<string | null>;
  branch(id: string, version?: number): Promise<string | null>;
  borrow(id: string, fromId: string, what: string): Promise<boolean>;
  nextScreen(id: string, brief: string): Promise<string | null>;
  addVariant(id: string): Promise<string | null>;
  /** Designs the critic is reviewing right now. */
  critiquing: Set<string>;
  critique(id: string): Promise<void>;
  applyNotes(id: string, noteIds: string[]): Promise<boolean>;
  dismissNotes(id: string, noteIds: string[]): void;
  /** Standalone HTML builds, by design id. Their agent log is logs[EXPORT_PREFIX + id]. */
  exports: Record<string, ExportJob | undefined>;
  /** Have the agent build one standalone HTML file from the project. */
  exportStandalone(id: string): Promise<boolean>;
  /** Save the finished standalone build where the designer picks. */
  downloadStandalone(id: string): Promise<string | null>;
  /** Save the project files as a .zip. */
  exportZip(id: string): Promise<string | null>;
  forgetExport(id: string): void;
  /** `detail` goes to the agent only; the chat shows `note`. */
  revise(id: string, note: string, target?: NoteTarget, attachments?: Attachment[], detail?: string): Promise<boolean>;
  attach(id: string, files: (string | File)[]): Promise<Attachment[]>;
  attachmentUrls: Record<string, Record<string, string> | undefined>;
  usage: UsageLog;
  clearLog(id: string): void;
  retry(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
  update(id: string, patch: Partial<DesignMeta>): void;
  remove(id: string): Promise<void>;
  exportDesign(id: string): Promise<string | null>;
  readVersion(id: string, n: number): Promise<Artifact | null>;
  restoreVersion(id: string, n: number): Promise<void>;
  reveal(id: string): Promise<void>;
  error: string | null;
  clearError(): void;
}

const Ctx = createContext<Studio | null>(null);

export function useStudio() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStudio outside provider");
  return s;
}

export function StudioProvider({ children }: { children: ReactNode }) {
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  // Before paint, so a saved theme never flashes the default.
  useLayoutEffect(() => applyTheme(settings.theme), [settings.theme]);
  const [providers, setProviders] = useState<Record<Provider, ProviderState>>(() => ({
    antigravity: blankState("antigravity"),
    codex: blankState("codex"),
  }));
  const { status, checking, ping, pinging, usage } = providers[settings.provider];
  const [designs, setDesigns] = useState<DesignMeta[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [artifacts, setArtifacts] = useState<Record<string, Artifact | undefined>>({});
  const [logs, setLogs] = useState<Record<string, LogLine[] | undefined>>({});
  const [landed, setLanded] = useState<Set<string>>(new Set());
  const [critiquing, setCritiquing] = useState<Set<string>>(new Set());
  const [exports, setExports] = useState<Record<string, ExportJob | undefined>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, Record<string, string> | undefined>>({});

  const refreshAttachments = useCallback((id: string) => {
    backend
      .attachmentUrls(id)
      .then((urls) => setAttachmentUrls((all) => ({ ...all, [id]: urls })))
      .catch(() => {});
  }, []);

  const patchProvider = useCallback((p: Provider, patch: Partial<ProviderState> | ((s: ProviderState) => Partial<ProviderState>)) => {
    setProviders((all) => ({ ...all, [p]: { ...all[p], ...(typeof patch === "function" ? patch(all[p]) : patch) } }));
  }, []);

  const recordUsage = useCallback((p: Provider, ok: boolean, tokens: number, rateLimited: boolean) => {
    patchProvider(p, ({ usage: prev }) => {
      const key = dayKey();
      const day = prev.days[key] ?? { turns: 0, tokens: 0, failures: 0 };
      const days = { ...prev.days, [key]: ok ? { ...day, turns: day.turns + 1, tokens: day.tokens + tokens } : { ...day, failures: day.failures + 1 } };
      // Keep five weeks.
      const cutoff = dayKey(Date.now() - 35 * 86400000);
      Object.keys(days).forEach((k) => k < cutoff && delete days[k]);
      const next: UsageLog = {
        days,
        lastRateLimit: rateLimited ? Date.now() : prev.lastRateLimit,
        lastSuccess: ok ? Date.now() : prev.lastSuccess,
      };
      try {
        localStorage.setItem(usageKey(p), JSON.stringify(next));
      } catch {
        /* usage stays in memory */
      }
      return { usage: next };
    });
  }, [patchProvider]);

  const designsRef = useRef(designs);
  designsRef.current = designs;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const statusRef = useRef(status);
  statusRef.current = status;
  const providersRef = useRef(providers);
  providersRef.current = providers;
  const artifactsRef = useRef(artifacts);
  artifactsRef.current = artifacts;
  const logsRef = useRef(logs);
  logsRef.current = logs;

  const setSettings = useCallback((patch: Partial<Settings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        /* settings stay in memory */
      }
      return next;
    });
  }, []);

  const setChoice = useCallback((c: ModelChoice) => setSettings({ provider: c.provider, model: c.model }), [setSettings]);

  const persist = useCallback((meta: DesignMeta) => {
    backend.saveMeta(meta).catch((e) => setError(`Could not save “${meta.title}”: ${e}`));
  }, []);

  const patchDesign = useCallback(
    (id: string, patch: Partial<DesignMeta> | ((d: DesignMeta) => Partial<DesignMeta>)) => {
      setDesigns((list) =>
        list.map((d) => {
          if (d.id !== id) return d;
          const p = typeof patch === "function" ? patch(d) : patch;
          const next = { ...d, ...p, updatedAt: Date.now() };
          persist(next);
          return next;
        }),
      );
    },
    [persist],
  );

  // ---- provider authentication ----------------------------------------------

  const refreshStatus = useCallback(async (p: Provider = settingsRef.current.provider) => {
    patchProvider(p, { checking: true });
    try {
      const s = await backend.agyStatus(cliPath(settingsRef.current, p), p);
      patchProvider(p, s.authenticated ? { status: s } : { status: s, ping: null });
      return s;
    } catch (e) {
      const s: AgyStatus = {
        installed: false, authenticated: false, models: [], detail: String(e), checkedAt: Date.now(),
      };
      patchProvider(p, { status: s });
      return s;
    } finally {
      patchProvider(p, { checking: false });
    }
  }, [patchProvider]);

  const runPing = useCallback(async (p: Provider = settingsRef.current.provider) => {
    patchProvider(p, { pinging: true });
    try {
      const { model, provider } = settingsRef.current;
      // A model id only means something to the provider it came from.
      const result = await backend.agyPing(cliPath(settingsRef.current, p), p === provider ? model : "", p);
      patchProvider(p, { ping: result });
    } catch (e) {
      patchProvider(p, { ping: { ok: false, latencyMs: 0, detail: String(e) } });
    } finally {
      patchProvider(p, { pinging: false });
    }
  }, [patchProvider]);

  const openSignIn = useCallback(async (p: Provider = settingsRef.current.provider) => {
    try {
      await backend.openSignIn(cliPath(settingsRef.current, p), p);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  // Every provider is checked up front: the model picker lists them all, and
  // designs and system tasks may each run on a different one.
  useEffect(() => {
    refreshStatus("antigravity");
  }, [refreshStatus, settings.agyPath]);
  useEffect(() => {
    refreshStatus("codex");
  }, [refreshStatus, settings.codexPath]);

  // Re-verify when the window regains focus after a while: sign-outs happen
  // in other terminals.
  useEffect(() => {
    const onFocus = () => {
      const s = statusRef.current;
      if (!s || Date.now() - s.checkedAt > 60_000) refreshStatus();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshStatus]);

  // ---- designs -------------------------------------------------------------

  useEffect(() => {
    (async () => {
      try {
        const list = (await backend.listDesigns()).sort((a, b) => a.folio - b.folio);
        const healed = list.map((d) =>
          d.status === "generating"
            ? { ...d, status: (d.entries.length > 1 ? "ready" : "failed") as DesignMeta["status"], error: "The app closed while the agent was working." }
            : d,
        );
        healed.forEach((d, i) => d !== list[i] && backend.saveMeta(d));
        setDesigns(healed);
        const arts = await Promise.all(healed.map((d) => backend.readArtifact(d.id).catch(() => null)));
        setArtifacts(Object.fromEntries(healed.map((d, i) => [d.id, arts[i] ?? undefined])));
      } catch (e) {
        setError(`Could not read your designs: ${e}`);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    // listen() resolves asynchronously; if the effect is torn down first
    // (StrictMode, hot reload) the late unlisten must still run.
    let disposed = false;
    const offs: (() => void)[] = [];
    const keep = (u: () => void) => (disposed ? u() : offs.push(u));
    backend.onAgentEvent((id, ev) => {
      setLogs((all) => ({ ...all, [id]: foldEvent(all[id] ?? [], ev) }));
    }).then(keep);
    backend.onAgentExit(async (exit) => {
      const id = exit.designId;
      const via = exit.provider ?? "antigravity";
      const who = PROVIDERS[via].name;
      // Standalone builds are keyed "export-<design id>" and work in the design's own folder.
      if (id.startsWith(EXPORT_PREFIX)) {
        const designId = id.slice(EXPORT_PREFIX.length);
        const built = exit.ok && !!(await backend.readDesignFile(designId, STANDALONE_FILE).catch(() => null));
        if (!exit.cancelled) recordUsage(via, built, exit.usage?.total_tokens ?? 0, !!exit.rateLimited);
        setExports((all) => {
          const cur = all[designId];
          if (!cur) return all;
          const status: ExportJob["status"] = exit.cancelled ? "cancelled" : built ? "done" : "failed";
          return {
            ...all,
            [designId]: {
              ...cur,
              status,
              reply: exit.response?.trim() || undefined,
              error:
                status !== "failed"
                  ? undefined
                  : exit.ok
                    ? `The agent finished but did not write ${STANDALONE_FILE}.`
                    : exit.detail?.trim() || "The agent stopped before finishing.",
            },
          };
        });
        return;
      }
      // Design-system runs share the event stream; count their usage only.
      if (!designsRef.current.some((d) => d.id === id)) {
        if (!exit.cancelled) recordUsage(via, exit.ok, exit.usage?.total_tokens ?? 0, !!exit.rateLimited);
        return;
      }
      const artifact = exit.ok ? await backend.readArtifact(id).catch(() => null) : null;
      if (artifact) setArtifacts((a) => ({ ...a, [id]: artifact }));
      const hadArtifact = !!artifactsRef.current[id];
      const wrote = exit.ok && !!artifact;
      const version = wrote ? await backend.snapshot(id).catch(() => undefined) : undefined;
      const { body, suggestions } = parseReply(exit.response);
      if (!exit.cancelled) recordUsage(via, wrote, exit.usage?.total_tokens ?? 0, !!exit.rateLimited);
      if (wrote) refreshAttachments(id);
      const run = logsRef.current[id] ?? [];
      const steps = [...new Set(run.filter((l) => l.kind === "tool").map((l) => l.verb))];
      const seconds = run.reduce((t, l) => t + (l.seconds ?? 0), 0);

      patchDesign(id, (d) => {
        const entries = d.entries.map((e, i) =>
          i === d.entries.length - 1
            ? {
                ...e,
                outcome: (exit.cancelled ? "cancelled" : wrote ? "done" : "failed") as Entry["outcome"],
                reply: body || undefined,
                suggestions: wrote && suggestions.length ? suggestions : undefined,
                version,
                steps,
                seconds: Math.round(seconds) || undefined,
              }
            : e,
        );
        let err: string | undefined;
        if (exit.authLost) err = `${who} signed out during the run. Sign in again, then retry.`;
        else if (exit.rateLimited) err = `You’ve reached ${who}’s usage limit for now. Wait a little or switch to another model, then try again.`;
        else if (exit.cancelled) err = undefined;
        else if (!exit.ok) err = exit.detail?.trim() || `The agent stopped without finishing (exit ${exit.code ?? "?"}).`;
        else if (!artifact) err = `The agent finished but did not write ${artifactName(d.kind)}.`;
        return {
          entries,
          conversationId: exit.conversationId || d.conversationId,
          status: wrote || hadArtifact ? "ready" : exit.cancelled ? "empty" : "failed",
          error: err,
        };
      });
      if (wrote) {
        setLanded((s) => new Set(s).add(id));
        setTimeout(() => setLanded((s) => { const n = new Set(s); n.delete(id); return n; }), 1400);
      }
      if (exit.authLost) refreshStatus(via);
    }).then(keep);
    return () => {
      disposed = true;
      offs.forEach((u) => u());
    };
  }, [patchDesign, refreshStatus, recordUsage, refreshAttachments]);

  useEffect(() => {
    if (activeId) refreshAttachments(activeId);
  }, [activeId, refreshAttachments]);

  const ensureReady = useCallback(async (p: Provider = settingsRef.current.provider) => {
    let s = providersRef.current[p].status;
    if (!s || !s.authenticated || Date.now() - s.checkedAt > STALE_MS) s = await refreshStatus(p);
    return s.authenticated;
  }, [refreshStatus]);

  const start = useCallback(
    async (meta: DesignMeta, prompt: string) => {
      setLogs((l) => ({ ...l, [meta.id]: [] }));
      const cur = settingsRef.current;
      // Each design runs on its own provider; its conversation belongs to it.
      const { provider, model } = designChoice(meta, cur);
      if (!meta.provider) patchDesign(meta.id, { provider });
      try {
        await backend.agentRun({
          designId: meta.id,
          provider,
          prompt,
          model: model || undefined,
          conversationId: meta.conversationId,
          effort: cur.effort || undefined,
          cliPath: cliPath(cur, provider),
        });
        return true;
      } catch (e) {
        patchDesign(meta.id, (d) => ({
          status: artifactsRef.current[meta.id] ? "ready" : "failed",
          error: String(e),
          entries: d.entries.map((x, i) => (i === d.entries.length - 1 ? { ...x, outcome: "failed" as const } : x)),
        }));
        return false;
      }
    },
    [patchDesign],
  );

  const create = useCallback(
    async (brief: string, kind: DesignKind, frame: FramePreset, systemId?: string, opts: CreateOptions = {}) => {
      if (!(await ensureReady())) return null;
      const count = Math.max(1, Math.min(4, opts.variants ?? 1));
      const group: DesignGroup | undefined = count > 1 ? { id: "g" + uid(), kind: "variants", index: 0 } : undefined;
      let folio = designsRef.current.reduce((m, d) => Math.max(m, d.folio), 0);
      const now = Date.now();
      const metas: DesignMeta[] = Array.from({ length: count }, (_, i) => ({
        id: uid(),
        folio: ++folio,
        title: titleFromBrief(brief) + (group ? ` · ${variantLetter(i)}` : ""),
        kind,
        frame,
        status: "generating",
        provider: settingsRef.current.provider,
        model: settingsRef.current.model || undefined,
        createdAt: now,
        updatedAt: now,
        entries: [{ id: uid(), role: "brief", text: brief.trim(), at: now }],
        overrides: {},
        systemId,
        group: group && { ...group, index: i },
      }));
      try {
        for (const m of metas) await backend.saveMeta(m);
      } catch (e) {
        setError(`Could not create the design folder: ${e}`);
        return null;
      }
      setDesigns((l) => [...l, ...metas]);
      setActiveId(metas[0].id);
      const system = systemId ? await systemSpec(systemId) : undefined;
      for (const [i, m] of metas.entries()) {
        const copied = systemId ? await backend.useSystem(m.id, systemId).catch(() => false) : false;
        const attachments = opts.files?.length ? await saveFiles(m.id, opts.files, setError) : [];
        if (attachments.length) {
          m.entries[0] = { ...m.entries[0], attachments };
          persist(m);
          setDesigns((l) => l.map((x) => (x.id === m.id ? { ...x, entries: m.entries } : x)));
          refreshAttachments(m.id);
        }
        await start(m, firstBrief({
          brief, kind, frame, attachments,
          system: copied ? system : undefined,
          variant: group ? { index: i, count } : undefined,
        }));
      }
      return metas[0].id;
    },
    [ensureReady, start, persist, refreshAttachments],
  );

  /** A new design that starts from this one (its current state or version n), in the same group. */
  const branch = useCallback(
    async (id: string, version?: number) => {
      const d = designsRef.current.find((x) => x.id === id);
      if (!d) return null;
      const group: DesignGroup = d.group ?? { id: "g" + uid(), kind: "variants", index: 0 };
      if (!d.group) patchDesign(d.id, { group });
      const siblings = designsRef.current.filter((x) => x.group?.id === group.id);
      const index = Math.max(group.index, ...siblings.map((x) => x.group!.index)) + 1;
      const now = Date.now();
      const meta: DesignMeta = {
        ...d,
        id: uid(),
        folio: designsRef.current.reduce((m, x) => Math.max(m, x.folio), 0) + 1,
        title: `${d.title.replace(/ · [A-Z0-9]+$/, "")} · ${group.kind === "flow" ? index + 1 : variantLetter(index)}`,
        status: "ready",
        error: undefined,
        conversationId: undefined,
        critique: undefined,
        createdAt: now,
        updatedAt: now,
        group: { ...group, index },
        entries: [
          d.entries[0],
          { id: uid(), role: "system", text: `Branched from “${d.title}”${version ? `, version ${version}` : ""}`, at: now },
        ],
      };
      try {
        await backend.saveMeta(meta);
        const artifact = await backend.forkDesign(d.id, meta.id, version);
        if (artifact) {
          setArtifacts((a) => ({ ...a, [meta.id]: artifact }));
          const v = await backend.snapshot(meta.id).catch(() => undefined);
          if (v) meta.entries[1] = { ...meta.entries[1], version: v };
        }
        await backend.saveMeta(meta);
      } catch (e) {
        setError(`Could not branch: ${e}`);
        return null;
      }
      setDesigns((l) => [...l, meta]);
      refreshAttachments(meta.id);
      setActiveId(meta.id);
      return meta.id;
    },
    [patchDesign, refreshAttachments],
  );

  const attach = useCallback(
    async (id: string, files: (string | File)[]) => {
      const out = await saveFiles(id, files, setError);
      if (out.length) refreshAttachments(id);
      return out;
    },
    [refreshAttachments],
  );

  const revise = useCallback(
    async (id: string, note: string, target?: NoteTarget, attachments?: Attachment[], detail?: string) => {
      const d = designsRef.current.find((x) => x.id === id);
      if (!d || d.status === "generating") return false;
      if (!(await ensureReady(providerOf(d)))) return false;
      const entry: Entry = {
        id: uid(), role: "note", text: note.trim(), at: Date.now(), target,
        attachments: attachments?.length ? attachments : undefined,
        detail,
      };
      const next: DesignMeta = { ...d, status: "generating", error: undefined, entries: [...d.entries, entry] };
      setDesigns((l) => l.map((x) => (x.id === id ? next : x)));
      persist(next);
      const system = await systemSpec(d.systemId);
      const cur = artifactsRef.current[id];
      const prompt = cur
        ? revision({ note, kind: d.kind, target, attachments, system, detail, project: isProject(cur) })
        : firstBrief({ brief: `${d.entries[0].text}\n\nAlso: ${note}`, kind: d.kind, frame: d.frame, attachments, system });
      return start(next, prompt);
    },
    [ensureReady, persist, start],
  );

  /** One more alternative to this design's brief, as a new frame in its project. */
  const addVariant = useCallback(
    async (id: string) => {
      const d = designsRef.current.find((x) => x.id === id);
      if (!d || !(await ensureReady(providerOf(d)))) return null;
      const group: DesignGroup = d.group?.kind === "variants" ? d.group : { id: "g" + uid(), kind: "variants", index: 0 };
      const base = d.title.replace(/ · [A-Z0-9]+$/, "");
      if (d.group?.id !== group.id) patchDesign(d.id, { group, title: `${base} · A` });
      const siblings = designsRef.current.filter((x) => x.group?.id === group.id && x.id !== d.id);
      const index = Math.max(group.index, ...siblings.map((x) => x.group!.index)) + 1;
      const brief = d.entries[0]?.text ?? base;
      const now = Date.now();
      const meta: DesignMeta = {
        id: uid(),
        folio: designsRef.current.reduce((m, x) => Math.max(m, x.folio), 0) + 1,
        title: `${base} · ${variantLetter(index)}`,
        kind: d.kind,
        frame: d.frame,
        status: "generating",
        provider: providerOf(d),
        model: d.model,
        createdAt: now,
        updatedAt: now,
        entries: [{ id: uid(), role: "brief", text: brief, at: now, attachments: d.entries[0]?.attachments }],
        overrides: { ...d.overrides },
        systemId: d.systemId,
        group: { ...group, index },
      };
      try {
        await backend.saveMeta(meta);
        // Same references and system as the first frame, but no design yet.
        await backend.forkDesign(d.id, meta.id, undefined, false).catch(() => null);
      } catch (e) {
        setError(`Could not add a variant: ${e}`);
        return null;
      }
      setDesigns((l) => [...l, meta]);
      setActiveId(meta.id);
      refreshAttachments(meta.id);
      const system = d.systemId ? await systemSpec(d.systemId) : undefined;
      await start(meta, firstBrief({
        brief, kind: d.kind, frame: d.frame, system,
        attachments: meta.entries[0].attachments,
        variant: { index, count: index + 1 },
      }));
      return meta.id;
    },
    [ensureReady, patchDesign, start, refreshAttachments],
  );

  /** The next screen of a flow: same system and frame, built from the earlier screens. */
  const nextScreen = useCallback(
    async (id: string, brief: string) => {
      const d = designsRef.current.find((x) => x.id === id);
      if (!d || !(await ensureReady(providerOf(d)))) return null;
      // A design joins a flow as its first screen; a variant leaves its variants for it.
      const group: DesignGroup = d.group?.kind === "flow" ? d.group : { id: "f" + uid(), kind: "flow", index: 0 };
      if (d.group?.id !== group.id) patchDesign(d.id, { group, title: d.title.replace(/ · [A-Z0-9]+$/, "") });
      const screens = designsRef.current
        .filter((x) => x.group?.id === group.id || x.id === d.id)
        .sort((a, b) => (a.group?.index ?? 0) - (b.group?.index ?? 0));
      const index = Math.max(0, ...screens.map((x) => (x.id === d.id ? group.index : x.group!.index))) + 1;
      const now = Date.now();
      const meta: DesignMeta = {
        id: uid(),
        folio: designsRef.current.reduce((m, x) => Math.max(m, x.folio), 0) + 1,
        title: titleFromBrief(brief),
        kind: d.kind,
        frame: d.frame,
        status: "generating",
        provider: providerOf(d),
        model: d.model,
        createdAt: now,
        updatedAt: now,
        entries: [{ id: uid(), role: "brief", text: brief.trim(), at: now }],
        overrides: { ...d.overrides },
        systemId: d.systemId,
        group: { ...group, index },
      };
      try {
        await backend.saveMeta(meta);
      } catch (e) {
        setError(`Could not create the screen: ${e}`);
        return null;
      }
      setDesigns((l) => [...l, meta]);
      setActiveId(meta.id);
      const refs: string[] = [];
      for (const [n, sc] of screens.entries()) {
        const ext = artifactsRef.current[sc.id]?.file.endsWith(".svg") ? "svg" : "html";
        const file = await backend.importDesign(meta.id, sc.id, `refs/screen-${n + 1}.${ext}`).catch(() => null);
        if (file) refs.push(file);
      }
      const copied = d.systemId ? await backend.useSystem(meta.id, d.systemId).catch(() => false) : false;
      const system = copied ? await systemSpec(d.systemId) : undefined;
      await start(meta, firstBrief({ brief, kind: d.kind, frame: d.frame, system, flow: { index, refs } }));
      return meta.id;
    },
    [ensureReady, patchDesign, start],
  );

  /** Ask a critic agent to review the design; its notes land on d.critique. */
  const critique = useCallback(
    async (id: string) => {
      const d = designsRef.current.find((x) => x.id === id);
      const cur = settingsRef.current;
      const sys = systemChoice(cur);
      if (!d || !artifactsRef.current[id] || !(await ensureReady(sys.provider))) return;
      setCritiquing((all) => new Set(all).add(id));
      try {
        const { data } = await backend.agyAsk(
          critiquePrompt({ kind: d.kind, brief: d.entries[0]?.text ?? d.title, system: !!d.systemId, project: isProject(artifactsRef.current[id]) }),
          CRITIQUE_SCHEMA,
          sys.model || undefined,
          cliPath(cur, sys.provider),
          id,
          sys.provider,
        );
        const notes: CritiqueNote[] = (Array.isArray(data?.notes) ? data.notes : [])
          .filter((n: any) => n && typeof n.selector === "string" && typeof n.note === "string")
          .slice(0, 8)
          .map((n: any) => ({
            id: uid(),
            selector: n.selector.trim(),
            label: String(n.label || "Element").trim(),
            note: n.note.trim(),
            severity: ["high", "medium", "low"].includes(n.severity) ? n.severity : "medium",
          }));
        if (!notes.length) throw new Error("The critic came back without notes. Try again.");
        patchDesign(id, { critique: notes, critiqueSummary: typeof data?.summary === "string" ? data.summary.trim() : undefined });
      } catch (e) {
        setError(String(e).replace(/^Error:\s*/, ""));
      } finally {
        setCritiquing((all) => {
          const next = new Set(all);
          next.delete(id);
          return next;
        });
      }
    },
    [ensureReady, patchDesign],
  );

  const dismissNotes = useCallback(
    (id: string, noteIds: string[]) =>
      patchDesign(id, (d) => {
        const left = (d.critique ?? []).filter((n) => !noteIds.includes(n.id));
        return { critique: left.length ? left : undefined, critiqueSummary: left.length ? d.critiqueSummary : undefined };
      }),
    [patchDesign],
  );

  /** Send critic notes to the design agent: one note pinned to its element, or several as one change. */
  const applyNotes = useCallback(
    async (id: string, noteIds: string[]) => {
      const d = designsRef.current.find((x) => x.id === id);
      const notes = (d?.critique ?? []).filter((n) => noteIds.includes(n.id));
      if (!d || !notes.length) return false;
      const ok =
        notes.length === 1
          ? await revise(id, notes[0].note, { selector: notes[0].selector, snippet: "", label: notes[0].label })
          : await revise(
              id,
              `Apply the critique (${notes.length} notes)`,
              undefined,
              undefined,
              `Make each of these changes. Each names the element's CSS path:\n${notes.map((n) => `- ${n.label} (\`${n.selector}\`): ${n.note}`).join("\n")}`,
            );
      if (ok) dismissNotes(id, noteIds);
      return ok;
    },
    [revise, dismissNotes],
  );

  /** Bring part of a sibling design (another variant or screen) into this one. */
  const borrow = useCallback(
    async (id: string, fromId: string, what: string) => {
      const from = designsRef.current.find((x) => x.id === fromId);
      if (!from) return false;
      const name = siblingName(from);
      const ext = artifactsRef.current[fromId]?.file.endsWith(".svg") ? "svg" : "html";
      let file: string;
      try {
        file = await backend.importDesign(id, fromId, `refs/${name.toLowerCase().replace(/\s+/g, "-")}.${ext}`);
      } catch (e) {
        setError(String(e));
        return false;
      }
      return revise(
        id,
        `From ${name.charAt(0).toLowerCase() + name.slice(1)}: ${what.trim()}`,
        undefined,
        undefined,
        `${name} is at ${file}. Open it, take what the note asks for, and fit it into this design with this design's tokens and components; leave the rest of this design as it is.`,
      );
    },
    [revise],
  );

  const retry = useCallback(
    async (id: string) => {
      const d = designsRef.current.find((x) => x.id === id);
      if (!d || d.status === "generating") return;
      if (!(await ensureReady(providerOf(d)))) return;
      const last = [...d.entries].reverse().find((e) => e.role !== "system") ?? d.entries[0];
      const next: DesignMeta = {
        ...d,
        status: "generating",
        error: undefined,
        entries: d.entries.map((e) => (e === last ? { ...e, outcome: undefined, reply: undefined, at: Date.now() } : e)),
      };
      setDesigns((l) => l.map((x) => (x.id === id ? next : x)));
      persist(next);
      const system = await systemSpec(d.systemId);
      const prompt =
        last.role === "brief" || !artifactsRef.current[id]
          ? firstBrief({ brief: d.entries[0].text, kind: d.kind, frame: d.frame, system })
          : revision({
              note: last.text, kind: d.kind, target: last.target, attachments: last.attachments, system, detail: last.detail,
              project: isProject(artifactsRef.current[id]),
            });
      await start(next, prompt);
    },
    [ensureReady, persist, start],
  );

  const cancel = useCallback(async (id: string) => {
    await backend.agentCancel(id).catch(() => false);
  }, []);

  const remove = useCallback(async (id: string) => {
    await backend.agentCancel(id).catch(() => false);
    try {
      await backend.deleteDesign(id);
    } catch (e) {
      setError(`Could not delete: ${e}`);
      return;
    }
    setDesigns((l) => l.filter((d) => d.id !== id));
    setActiveId((a) => (a === id ? null : a));
  }, []);

  const exportDesign = useCallback(
    async (id: string) => {
      const d = designsRef.current.find((x) => x.id === id);
      const a = artifacts[id];
      if (!d || !a) return null;
      const ext = a.file.endsWith(".svg") ? "svg" : "html";
      try {
        const urls = await backend.attachmentUrls(id).catch(() => ({}));
        return await backend.exportFile(`${slug(d)}.${ext}`, ext, bake({ ...a, content: resolveAttachments(a.content, urls) }, d.overrides));
      } catch (e) {
        setError(`Export failed: ${e}`);
        return null;
      }
    },
    [artifacts],
  );

  const exportStandalone = useCallback(
    async (id: string) => {
      const d = designsRef.current.find((x) => x.id === id);
      const cur = settingsRef.current;
      const sys = systemChoice(cur);
      if (!d || !isProject(artifactsRef.current[id])) return false;
      const runId = EXPORT_PREFIX + id;
      setLogs((l) => ({ ...l, [runId]: [] }));
      setExports((all) => ({ ...all, [id]: { status: "running", at: Date.now() } }));
      if (!(await ensureReady(sys.provider))) {
        setExports((all) => ({ ...all, [id]: undefined }));
        return false;
      }
      try {
        await backend.agentRun({
          designId: runId,
          provider: sys.provider,
          prompt: standalonePrompt(),
          scope: "dir",
          dir: await backend.designDir(id),
          model: sys.model || undefined,
          effort: cur.effort || undefined,
          cliPath: cliPath(cur, sys.provider),
        });
        return true;
      } catch (e) {
        setExports((all) => ({ ...all, [id]: { status: "failed", at: Date.now(), error: String(e) } }));
        return false;
      }
    },
    [ensureReady],
  );

  const downloadStandalone = useCallback(async (id: string) => {
    const d = designsRef.current.find((x) => x.id === id);
    if (!d) return null;
    try {
      const html = await backend.readDesignFile(id, STANDALONE_FILE);
      if (!html) throw new Error("The standalone file is gone. Export again.");
      const urls = await backend.attachmentUrls(id).catch(() => ({}));
      const doc = bake({ file: "design.html", content: resolveAttachments(html, urls), modifiedMs: 0 }, d.overrides);
      return await backend.exportFile(`${slug(d)}.html`, "html", doc);
    } catch (e) {
      setError(`Export failed: ${String(e).replace(/^Error:\s*/, "")}`);
      return null;
    }
  }, []);

  const exportZip = useCallback(async (id: string) => {
    const d = designsRef.current.find((x) => x.id === id);
    const a = artifactsRef.current[id];
    if (!d || !isProject(a)) return null;
    try {
      return await backend.exportBytes(`${slug(d)}.zip`, "zip", zipFiles(bakeProject(a.files, d.overrides)));
    } catch (e) {
      setError(`Export failed: ${e}`);
      return null;
    }
  }, []);

  const restoreVersion = useCallback(
    async (id: string, n: number) => {
      try {
        const a = await backend.restoreVersion(id, n);
        setArtifacts((all) => ({ ...all, [id]: a }));
        patchDesign(id, (d) => ({
          status: "ready",
          error: undefined,
          entries: [...d.entries, { id: uid(), role: "system", text: `Restored version ${n}`, at: Date.now(), version: n }],
        }));
      } catch (e) {
        setError(`Could not restore: ${e}`);
      }
    },
    [patchDesign],
  );

  const value = useMemo<Studio>(
    () => ({
      settings, setSettings, setChoice, status, checking, ping, pinging, providers, refreshStatus, runPing, openSignIn,
      designs, loaded, artifacts, logs, landed, activeId,
      open: setActiveId, create, branch, borrow, nextScreen, addVariant, critiquing, critique, applyNotes, dismissNotes, revise,
      exports, exportStandalone, downloadStandalone, exportZip, forgetExport: (id) => setExports((all) => ({ ...all, [id]: undefined })), retry, cancel, attach, attachmentUrls, usage,
      clearLog: (id) => setLogs((l) => ({ ...l, [id]: [] })),
      update: (id, patch) =>
        patchDesign(id, (d) => {
          // Another harness can't resume this conversation; the agent starts a
          // fresh thread in the same workspace, where it still finds the files.
          const moves = !!patch.provider && patch.provider !== providerOf(d);
          return moves ? { ...patch, conversationId: undefined } : patch;
        }),
      remove, exportDesign,
      reveal: (id) => backend.revealDesign(id).catch((e) => setError(String(e))),
      readVersion: (id, n) => backend.readVersion(id, n).catch((e) => (setError(String(e)), null)),
      restoreVersion,
      error, clearError: () => setError(null),
    }),
    [settings, setSettings, setChoice, status, checking, ping, pinging, providers, refreshStatus, runPing, openSignIn, designs, loaded,
      artifacts, logs, landed, activeId, create, branch, borrow, nextScreen, addVariant, critiquing, critique, applyNotes, dismissNotes, revise, exports, exportStandalone, downloadStandalone, exportZip, retry, cancel, patchDesign, remove, exportDesign, restoreVersion, error,
      attach, attachmentUrls, usage],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
