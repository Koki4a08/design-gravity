/** Which CLI harness generates designs. */
export type Provider = "antigravity" | "codex";

export type DesignKind = "screen" | "graphic" | "mockup";
export type DesignStatus = "empty" | "generating" | "ready" | "failed";

export interface FramePreset {
  id: string;
  label: string;
  width: number;
  height: number;
  /** Heading the size is listed under, e.g. "Phone" or "Social". */
  group?: string;
}

export interface Tokens {
  paper: string;
  ink: string;
  muted: string;
  surface: string;
  accent: string;
  fontDisplay: string;
  fontBody: string;
  scale: number;
  radius: number;
  space: number;
}

export type TokenOverrides = Partial<Tokens>;

export interface NoteTarget {
  selector: string;
  snippet: string;
  label: string;
}

export interface Entry {
  id: string;
  role: "brief" | "note" | "system";
  text: string;
  at: number;
  target?: NoteTarget;
  attachments?: Attachment[];
  /** Extra instructions sent to the agent but not shown in the chat (e.g. audit findings). */
  detail?: string;
  outcome?: "done" | "failed" | "cancelled";
  /** The agent's answer, without the NEXT: lines. */
  reply?: string;
  /** Follow-up refinements the agent proposed, shown as quick replies. */
  suggestions?: string[];
  /** Snapshot number of the design this turn produced. */
  version?: number;
  /** What the agent did, as human steps, kept after the run. */
  steps?: string[];
  seconds?: number;
}

export interface DesignMeta {
  id: string;
  folio: number;
  title: string;
  kind: DesignKind;
  frame: FramePreset;
  status: DesignStatus;
  model?: string;
  /** Harness that owns `conversationId`; a thread can't move between providers. */
  provider?: Provider;
  conversationId?: string;
  createdAt: number;
  updatedAt: number;
  entries: Entry[];
  overrides: TokenOverrides;
  error?: string;
  /** Design system the agent follows for this design. */
  systemId?: string;
  /** Sibling designs: alternatives to one brief, or screens of one flow. */
  group?: DesignGroup;
  /** Notes from the critic that the designer hasn't applied or dismissed. */
  critique?: CritiqueNote[];
  /** The critic's one-line verdict for the pending notes. */
  critiqueSummary?: string;
}

export interface DesignGroup {
  id: string;
  kind: "variants" | "flow";
  /** Position in the group: variant A, B, C… or screen 1, 2, 3… */
  index: number;
}

export interface CritiqueNote {
  id: string;
  /** CSS path of the element the note is about, as the picker writes it. */
  selector: string;
  /** Short name for the element, e.g. "Hero headline". */
  label: string;
  note: string;
  severity: "high" | "medium" | "low";
}

export interface Artifact {
  file: string;
  /** The HTML or SVG document; for a project, its static render. */
  content: string;
  modifiedMs: number;
  /** Project designs: source files by workspace-relative path (app/page.tsx, components/…, styles/…). */
  files?: Record<string, string>;
}

export interface AgyModel {
  id: string;
  label: string;
  /** An older generation the CLI still offers; the picker files it under "Legacy models". */
  legacy?: boolean;
}

/** A model together with the harness that runs it; model "" is that provider's default. */
export interface ModelChoice {
  provider: Provider;
  model: string;
}

export interface AgyStatus {
  installed: boolean;
  path?: string | null;
  version?: string | null;
  authenticated: boolean;
  models: AgyModel[];
  detail?: string | null;
  checkedAt: number;
  account?: string | null;
  authMethod?: string | null;
}

export interface PingResult {
  ok: boolean;
  latencyMs: number;
  model?: string | null;
  detail?: string | null;
}

/** One line of the agent's production log, derived from stream-json. */
export interface LogLine {
  key: string;
  step: number;
  kind: "tool" | "say" | "system";
  /** Raw agy tool name, for progress milestones. */
  tool?: string;
  verb: string;
  detail?: string;
  state: "active" | "done" | "error";
  seconds?: number;
}

export interface AgentExit {
  designId: string;
  /** Absent on Antigravity runs. */
  provider?: Provider;
  ok: boolean;
  cancelled: boolean;
  code?: number | null;
  authLost: boolean;
  conversationId?: string | null;
  response?: string | null;
  detail?: string | null;
  rateLimited?: boolean;
  usage?: { total_tokens?: number; input_tokens?: number; output_tokens?: number } | null;
  model?: string | null;
}

export interface Attachment {
  /** Relative to the design workspace, e.g. "attachments/logo.png". */
  path: string;
  name: string;
  size: number;
}

export interface Settings {
  /** Harness used for new runs. */
  provider: Provider;
  agyPath: string;
  codexPath: string;
  /** Model for the active provider; model ids differ per harness. */
  model: string;
  /** Starred models, as "provider:model". */
  favoriteModels: string[];
  /** Harness and model for runs the app starts itself (design systems, critiques,
   * HTML export); "" follows the default model above. */
  systemProvider: Provider | "";
  systemModel: string;
  effort: "" | "low" | "medium" | "high" | "max";
  motion: boolean;
  /** Design system new designs follow; "" for none. */
  systemId: string;
  /** App theme id from lib/themes. */
  theme: string;
}

/** App-side record of agent usage, per local day (YYYY-MM-DD). */
export interface UsageDay {
  turns: number;
  tokens: number;
  failures: number;
}
export interface UsageLog {
  days: Record<string, UsageDay>;
  lastRateLimit?: number;
  lastSuccess?: number;
}
