import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { backend } from "../backend/backend";
import { systemChoice, useStudio } from "./studio";
import { cliPath, PROVIDERS } from "../providers";
import {
  QUESTION_SCHEMA, extractPrompt, fontsOf, generatePrompt, parseSpec, questionsPrompt, revisePrompt, swatchesOf,
} from "../design/systems";
import type { Questionnaire, SystemMeta, SystemTurn } from "../design/systems";

export interface SystemFiles {
  spec?: string | null;
  guide?: string | null;
  preview?: string | null;
}

interface Systems {
  systems: SystemMeta[];
  files: Record<string, SystemFiles | undefined>;
  /** Create a draft and ask the agent for a tailored questionnaire. */
  start(brief: string): Promise<SystemMeta>;
  /** Build a system straight from references: files, one of the designer's designs, a URL. */
  extract(brief: string, refs: SystemRefs): Promise<SystemMeta>;
  setAnswers(id: string, answers: Record<string, string[]>): void;
  rename(id: string, name: string): void;
  generate(id: string): Promise<void>;
  revise(id: string, feedback: string): Promise<void>;
  cancel(id: string): Promise<void>;
  save(id: string): void;
  remove(id: string): Promise<void>;
  load(id: string): Promise<SystemFiles>;
}

export interface SystemRefs {
  files?: (string | File)[];
  designId?: string;
  url?: string;
}

const Ctx = createContext<Systems | null>(null);

export function useSystems() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSystems outside provider");
  return v;
}

const uid = () => "ds" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function SystemsProvider({ children }: { children: ReactNode }) {
  const studio = useStudio();
  const [systems, setSystems] = useState<SystemMeta[]>([]);
  const [files, setFiles] = useState<Record<string, SystemFiles | undefined>>({});
  const ref = useRef(systems);
  ref.current = systems;
  const settings = useRef(studio.settings);
  settings.current = studio.settings;
  const clearLog = useRef(studio.clearLog);
  clearLog.current = studio.clearLog;

  const persist = useCallback((m: SystemMeta) => {
    backend.systemSaveMeta(m).catch(() => {});
  }, []);

  const patch = useCallback(
    (id: string, p: Partial<SystemMeta> | ((m: SystemMeta) => Partial<SystemMeta>)) => {
      setSystems((all) =>
        all.map((m) => {
          if (m.id !== id) return m;
          const next = { ...m, ...(typeof p === "function" ? p(m) : p), updatedAt: Date.now() };
          persist(next);
          return next;
        }),
      );
    },
    [persist],
  );

  const load = useCallback(async (id: string) => {
    const f = await backend.systemRead(id).catch(() => ({}) as SystemFiles);
    setFiles((all) => ({ ...all, [id]: f }));
    return f;
  }, []);

  useEffect(() => {
    backend.systemsList().then((list) => {
      // Unsaved drafts from an earlier session are abandoned work.
      list.filter((m) => !m.saved).forEach((m) => backend.systemDelete(m.id).catch(() => {}));
      const kept = list
        .filter((m) => m.saved)
        .map((m) => (m.status === "generating" ? { ...m, status: "ready" as const } : m))
        .sort((a, b) => b.updatedAt - a.updatedAt);
      setSystems(kept);
    });
  }, []);

  // Agent runs for systems report through the same event stream as designs.
  useEffect(() => {
    let disposed = false;
    let off: (() => void) | undefined;
    backend
      .onAgentExit(async (exit) => {
        const id = exit.designId;
        if (!ref.current.some((m) => m.id === id)) return;
        const who = PROVIDERS[exit.provider ?? "antigravity"].name;
        const f = await load(id);
        const spec = parseSpec(f.spec);
        const wrote = exit.ok && !!f.preview;
        patch(id, (m) => ({
          // An extracted system is named by the agent after what it saw.
          name: m.source === "reference" && m.turns.length === 1 && spec?.name ? spec.name : m.name,
          status: wrote ? "ready" : m.turns.some((t) => t.outcome === "done") ? "ready" : "failed",
          conversationId: exit.conversationId || m.conversationId,
          summary: spec?.summary ?? m.summary,
          swatches: swatchesOf(spec).length ? swatchesOf(spec) : m.swatches,
          fonts: fontsOf(spec) || m.fonts,
          error: exit.cancelled
            ? undefined
            : exit.authLost
              ? `${who} signed out during the run.`
              : exit.rateLimited
                ? `You’ve reached ${who}’s usage limit for now.`
                : !exit.ok
                  ? exit.detail?.trim() || "The agent stopped before finishing."
                  : !f.preview
                    ? "The agent finished without writing the preview."
                    : undefined,
          turns: m.turns.map((t, i) =>
            i === m.turns.length - 1
              ? {
                  ...t,
                  outcome: (exit.cancelled ? "cancelled" : wrote ? "done" : "failed") as SystemTurn["outcome"],
                  reply: exit.response?.trim() || undefined,
                }
              : t,
          ),
        }));
      })
      .then((u) => (disposed ? u() : (off = u)));
    return () => {
      disposed = true;
      off?.();
    };
  }, [load, patch]);

  const run = useCallback(
    async (m: SystemMeta, prompt: string, conversationId?: string) => {
      clearLog.current(m.id);
      const cur = settings.current;
      // Design systems run on the system-task model. A conversation can only
      // be resumed by the harness that started it.
      const sys = systemChoice(cur);
      const same = (m.provider ?? "antigravity") === sys.provider;
      if (!same) patch(m.id, { provider: sys.provider, conversationId: undefined });
      else if (!m.provider) patch(m.id, { provider: sys.provider });
      try {
        await backend.agentRun({
          designId: m.id,
          provider: sys.provider,
          prompt,
          scope: "system",
          model: sys.model || undefined,
          effort: cur.effort || undefined,
          cliPath: cliPath(cur, sys.provider),
          conversationId: same ? conversationId : undefined,
        });
      } catch (e) {
        patch(m.id, { status: "failed", error: String(e) });
      }
    },
    [patch],
  );

  const start = useCallback(
    async (brief: string) => {
      const now = Date.now();
      const { data } = await backend.agyAsk(
        questionsPrompt(brief),
        QUESTION_SCHEMA,
        systemChoice(settings.current).model || undefined,
        cliPath(settings.current, systemChoice(settings.current).provider),
        undefined,
        systemChoice(settings.current).provider,
      );
      const raw = data as Questionnaire;
      // Drop malformed questions rather than failing the whole questionnaire.
      const q: Questionnaire = {
        name: raw?.name ?? "",
        questions: (Array.isArray(raw?.questions) ? raw.questions : []).filter(
          (x) => x && typeof x.title === "string" && Array.isArray(x.options) && x.options.length > 0,
        ),
      };
      if (!q.questions.length) throw new Error("The agent didn’t send any questions. Try again.");
      const meta: SystemMeta = {
        id: uid(),
        name: q.name?.trim() || "Untitled system",
        brief: brief.trim(),
        status: "draft",
        saved: false,
        createdAt: now,
        updatedAt: now,
        questionnaire: q,
        answers: {},
        turns: [],
      };
      await backend.systemSaveMeta(meta);
      setSystems((all) => [meta, ...all]);
      return meta;
    },
    [],
  );

  const extract = useCallback(
    async (brief: string, refs: SystemRefs) => {
      const now = Date.now();
      const meta: SystemMeta = {
        id: uid(),
        name: "Extracted system",
        brief: brief.trim(),
        status: "generating",
        saved: false,
        createdAt: now,
        updatedAt: now,
        answers: {},
        source: "reference",
        turns: [{ id: uid(), kind: "generate", text: "Extract from references", at: now }],
      };
      await backend.systemSaveMeta(meta);
      const paths: string[] = [];
      for (const f of refs.files ?? []) {
        const p = await (typeof f === "string"
          ? backend.systemRefFile(meta.id, f)
          : backend.systemRefBytes(meta.id, f.name || "reference.png", new Uint8Array(await f.arrayBuffer()))
        ).catch(() => null);
        if (p) paths.push(p);
      }
      if (refs.designId) {
        const p = await backend.systemRefDesign(meta.id, refs.designId).catch(() => null);
        if (p) paths.push(p);
      }
      const url = refs.url?.trim() || undefined;
      if (!paths.length && !url) {
        await backend.systemDelete(meta.id).catch(() => {});
        throw new Error("None of the references could be read.");
      }
      setSystems((all) => [meta, ...all]);
      await run(meta, extractPrompt(meta, paths, url));
      return meta;
    },
    [run],
  );

  const generate = useCallback(
    async (id: string) => {
      const m = ref.current.find((x) => x.id === id);
      if (!m) return;
      const turn: SystemTurn = { id: uid(), kind: "generate", text: "Build the system", at: Date.now() };
      const next = { ...m, status: "generating" as const, error: undefined, turns: [...m.turns, turn] };
      setSystems((all) => all.map((x) => (x.id === id ? next : x)));
      persist(next);
      await run(next, generatePrompt(next));
    },
    [persist, run],
  );

  const revise = useCallback(
    async (id: string, feedback: string) => {
      const m = ref.current.find((x) => x.id === id);
      if (!m || m.status === "generating") return;
      const turn: SystemTurn = { id: uid(), kind: "revise", text: feedback.trim(), at: Date.now() };
      const next = { ...m, status: "generating" as const, error: undefined, turns: [...m.turns, turn] };
      setSystems((all) => all.map((x) => (x.id === id ? next : x)));
      persist(next);
      await run(next, revisePrompt(feedback), m.conversationId);
    },
    [persist, run],
  );

  const value = useMemo<Systems>(
    () => ({
      systems,
      files,
      start,
      extract,
      setAnswers: (id, answers) => patch(id, { answers }),
      rename: (id, name) => patch(id, { name }),
      generate,
      revise,
      cancel: async (id) => {
        await backend.agentCancel(id).catch(() => false);
      },
      save: (id) => patch(id, { saved: true }),
      remove: async (id) => {
        await backend.agentCancel(id).catch(() => false);
        await backend.systemDelete(id).catch(() => {});
        setSystems((all) => all.filter((m) => m.id !== id));
      },
      load,
    }),
    [systems, files, start, extract, patch, generate, revise, load],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
