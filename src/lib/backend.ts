import type { AgentExit, AgyStatus, Artifact, Attachment, DesignMeta, PingResult, Provider } from "./types";
import { mockBackend } from "./mock";
import { errorDoc, isProject, renderProject } from "./project";
import type { SystemMeta } from "./systems";

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type Unlisten = () => void;

export interface Backend {
  /** The CLI calls take the harness and that harness's own executable override. */
  agyStatus(cliPath: string, provider?: Provider): Promise<AgyStatus>;
  agyPing(cliPath: string, model: string, provider?: Provider): Promise<PingResult>;
  openSignIn(cliPath: string, provider?: Provider): Promise<void>;
  /** The newest published version of the provider's CLI. */
  cliLatest(provider: Provider): Promise<string | null>;
  /** Run the CLI's own updater; resolves with its output. */
  cliUpdate(cliPath: string, provider: Provider): Promise<string>;
  agentRun(args: {
    designId: string;
    provider?: Provider;
    prompt: string;
    model?: string;
    conversationId?: string;
    effort?: string;
    cliPath?: string;
    scope?: "design" | "system" | "dir";
    /** For scope "dir": the folder the agent works in. */
    dir?: string;
  }): Promise<void>;
  agentCancel(designId: string): Promise<boolean>;
  onAgentEvent(cb: (designId: string, event: any) => void): Promise<Unlisten>;
  onAgentExit(cb: (exit: AgentExit) => void): Promise<Unlisten>;
  listDesigns(): Promise<DesignMeta[]>;
  saveMeta(meta: DesignMeta): Promise<void>;
  readArtifact(id: string): Promise<Artifact | null>;
  deleteDesign(id: string): Promise<void>;
  revealDesign(id: string): Promise<void>;
  /** Show a folder the designer picked (e.g. where code was exported). */
  revealPath(path: string): Promise<void>;
  exportFile(defaultName: string, ext: string, content: string): Promise<string | null>;
  /** Save binary content (e.g. a .zip) through the native save dialog. */
  exportBytes(defaultName: string, ext: string, bytes: Uint8Array): Promise<string | null>;
  /** A text file inside the design's workspace, or null if it isn't there. */
  readDesignFile(id: string, path: string): Promise<string | null>;
  /** Absolute path of the design's workspace folder. */
  designDir(id: string): Promise<string>;
  snapshot(id: string): Promise<number>;
  readVersion(id: string, n: number): Promise<Artifact>;
  restoreVersion(id: string, n: number): Promise<Artifact>;
  pickFiles(): Promise<string[]>;
  attachFile(id: string, source: string): Promise<Attachment>;
  attachBytes(id: string, name: string, bytes: Uint8Array): Promise<Attachment>;
  attachmentUrls(id: string): Promise<Record<string, string>>;
  /** One structured answer; with designId the agent reads that design's workspace. */
  agyAsk(prompt: string, schema: object, model?: string, cliPath?: string, designId?: string, provider?: Provider): Promise<{ data: any; conversationId?: string | null }>;
  systemsList(): Promise<SystemMeta[]>;
  systemSaveMeta(meta: SystemMeta): Promise<void>;
  systemRead(id: string): Promise<{ spec?: string | null; guide?: string | null; preview?: string | null }>;
  systemDelete(id: string): Promise<void>;
  useSystem(designId: string, systemId: string): Promise<boolean>;
  /** New design from another's current artifact (or version n), system and attachments. */
  forkDesign(fromId: string, toId: string, version?: number, artifact?: boolean): Promise<Artifact | null>;
  /** Copy another design's artifact into this workspace as a reference; returns its path. */
  importDesign(id: string, fromId: string, asName: string): Promise<string>;
  systemRefFile(id: string, source: string): Promise<string>;
  systemRefBytes(id: string, name: string, bytes: Uint8Array): Promise<string>;
  systemRefDesign(id: string, designId: string): Promise<string>;
}

const orNull = (s: string) => (s.trim() ? s.trim() : null);

function tauriBackend(): Backend {
  const core = import("@tauri-apps/api/core");
  const event = import("@tauri-apps/api/event");
  const invoke = async <T,>(cmd: string, args?: Record<string, unknown>) =>
    (await core).invoke<T>(cmd, args);

  return {
    agyStatus: (cliPath, provider = "antigravity") =>
      provider === "codex"
        ? invoke("codex_status", { codexPath: orNull(cliPath) })
        : invoke("agy_status", { agyPath: orNull(cliPath) }),
    agyPing: (cliPath, model, provider = "antigravity") =>
      provider === "codex"
        ? invoke("codex_ping", { codexPath: orNull(cliPath), model: orNull(model) })
        : invoke("agy_ping", { agyPath: orNull(cliPath), model: orNull(model) }),
    openSignIn: (cliPath, provider = "antigravity") =>
      provider === "codex"
        ? invoke("codex_open_sign_in", { codexPath: orNull(cliPath) })
        : invoke("agy_open_sign_in", { agyPath: orNull(cliPath) }),
    cliLatest: (provider) => invoke("cli_latest_version", { provider }),
    cliUpdate: (cliPath, provider) =>
      provider === "codex"
        ? invoke("codex_update", { codexPath: orNull(cliPath) })
        : invoke("agy_update", { agyPath: orNull(cliPath) }),
    agentRun: (a) => {
      const common = {
        designId: a.designId,
        prompt: a.prompt,
        model: a.model || null,
        conversationId: a.conversationId || null,
        effort: a.effort || null,
        scope: a.scope ?? null,
        dir: a.dir ?? null,
      };
      const path = a.cliPath ? orNull(a.cliPath) : null;
      return a.provider === "codex"
        ? invoke("codex_run", { ...common, codexPath: path })
        : invoke("agent_run", { ...common, agyPath: path });
    },
    agentCancel: (designId) => invoke("agent_cancel", { designId }),
    onAgentEvent: async (cb) =>
      (await event).listen<{ designId: string; event: any }>("agent-event", (e) =>
        cb(e.payload.designId, e.payload.event),
      ),
    onAgentExit: async (cb) => (await event).listen<AgentExit>("agent-exit", (e) => cb(e.payload)),
    listDesigns: () => invoke("designs_list"),
    saveMeta: (meta) => invoke("design_save_meta", { id: meta.id, meta }),
    readArtifact: (id) => invoke("design_read_artifact", { id }),
    deleteDesign: (id) => invoke("design_delete", { id }),
    revealPath: async (path) => {
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
      await revealItemInDir(path);
    },
    revealDesign: async (id) => {
      const dir = await invoke<string>("design_dir_path", { id });
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
      await revealItemInDir(dir);
    },
    snapshot: (id) => invoke("design_snapshot", { id }),
    readVersion: (id, n) => invoke("design_read_version", { id, n }),
    restoreVersion: (id, n) => invoke("design_restore_version", { id, n }),
    pickFiles: async () => {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({
        multiple: true,
        filters: [
          {
            name: "Images and references",
            extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "pdf", "txt", "md", "json", "csv", "html", "css"],
          },
        ],
      });
      return picked == null ? [] : Array.isArray(picked) ? picked : [picked];
    },
    attachFile: (id, source) => invoke("design_attach_file", { id, source }),
    attachBytes: (id, name, bytes) => invoke("design_attach_bytes", { id, name, bytes: Array.from(bytes) }),
    attachmentUrls: (id) => invoke("design_attachment_urls", { id }),
    agyAsk: (prompt, schema, model, cliPath, designId, provider = "antigravity") => {
      const common = { prompt, schema, model: model || null, designId: designId ?? null };
      const path = cliPath ? orNull(cliPath) : null;
      return provider === "codex"
        ? invoke("codex_ask", { ...common, codexPath: path })
        : invoke("agy_ask", { ...common, agyPath: path });
    },
    systemsList: () => invoke("systems_list"),
    systemSaveMeta: (meta) => invoke("system_save_meta", { id: meta.id, meta }),
    systemRead: (id) => invoke("system_read", { id }),
    systemDelete: (id) => invoke("system_delete", { id }),
    useSystem: (designId, systemId) => invoke("design_use_system", { designId, systemId }),
    forkDesign: (fromId, toId, version, artifact = true) =>
      invoke("design_fork", { fromId, toId, version: version ?? null, artifact }),
    importDesign: (id, fromId, asName) => invoke("design_import", { id, fromId, asName }),
    systemRefFile: (id, source) => invoke("system_ref_file", { id, source }),
    systemRefBytes: (id, name, bytes) => invoke("system_ref_bytes", { id, name, bytes: Array.from(bytes) }),
    systemRefDesign: (id, designId) => invoke("system_ref_design", { id, designId }),
    readDesignFile: (id, path) => invoke("design_read_file", { id, path }),
    designDir: (id) => invoke("design_dir_path", { id }),
    exportFile: async (defaultName, ext, content) => {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        defaultPath: defaultName,
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
      });
      if (!path) return null;
      await invoke("export_write", { path, content });
      return path;
    },
    exportBytes: async (defaultName, ext, bytes) => {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        defaultPath: defaultName,
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
      });
      if (!path) return null;
      await invoke("export_write_bytes", { path, bytes: Array.from(bytes) });
      return path;
    },
  };
}

/** Project designs arrive as source files; render them so everything downstream sees HTML. */
async function hydrate<A extends Artifact | null>(a: A): Promise<A> {
  if (!isProject(a)) return a;
  const content = await renderProject(a.files).catch((e) => errorDoc(e instanceof Error ? e.message : String(e)));
  return { ...a, content };
}

function withProjects(b: Backend): Backend {
  return {
    ...b,
    readArtifact: (id) => b.readArtifact(id).then(hydrate),
    readVersion: (id, n) => b.readVersion(id, n).then(hydrate),
    restoreVersion: (id, n) => b.restoreVersion(id, n).then(hydrate),
    forkDesign: (fromId, toId, version, artifact) => b.forkDesign(fromId, toId, version, artifact).then(hydrate),
  };
}

export const backend: Backend = withProjects(inTauri ? tauriBackend() : mockBackend());
