import type { LogLine } from "../types";

const VERBS: Record<string, string> = {
  write_to_file: "Laying out the design",
  replace_file_content: "Refining details",
  multi_replace_file_content: "Refining details",
  sed_file: "Refining details",
  view_file: "Studying the current design",
  list_dir: "Getting oriented",
  find_by_name: "Getting oriented",
  grep_search: "Studying the current design",
  search_web: "Looking for references",
  read_url_content: "Reading a reference",
  generate_image: "Drawing an image",
  run_command: "Checking the work",
  call_mcp_tool: "Thinking it through",
  browser_subagent: "Previewing the result",
  capture_browser_screenshot: "Previewing the result",
  open_browser_url: "Previewing the result",
  finish: "Wrapping up",
};

/** A path as the designer thinks of it: "components/Hero.tsx", or just the file name. */
const shortPath = (p: unknown): string | undefined => {
  if (typeof p !== "string") return undefined;
  const parts = p.split(/[\\/]/).filter(Boolean);
  const at = parts.findIndex((x) => x === "app" || x === "components" || x === "styles" || x === "export");
  return at >= 0 ? parts.slice(at).join("/") : parts.pop();
};

const fileOf = (info: any): string | undefined => {
  const p = info?.parameters ?? {};
  return shortPath(p.TargetFile ?? p.AbsolutePath ?? p.File ?? p.Path);
};

/** Fold one `codex exec --json` event (they carry `type`, agy's carry `event`). */
function foldCodex(lines: LogLine[], event: any): LogLine[] {
  if (event.type === "thread.started") {
    return lines.some((l) => l.key === "init")
      ? lines
      : [...lines, { key: "init", step: -1, kind: "system", verb: "Reading your brief", state: "done" }];
  }
  const item = event.item;
  if (!item || (event.type !== "item.started" && event.type !== "item.completed")) return lines;
  const key = String(item.id);
  const idx = lines.findIndex((l) => l.key === key);
  const step = idx >= 0 ? lines[idx].step : Number(String(item.id).replace(/\D/g, "")) || lines.length;
  const finished = event.type === "item.completed";
  const put = (line: LogLine) => (idx >= 0 ? lines.map((l, i) => (i === idx ? line : l)) : [...lines, line]);

  if (item.type === "agent_message") {
    const text = String(item.text ?? "").trim();
    return text ? put({ key, step, kind: "say", verb: "Note from the agent", detail: text, state: "done" }) : lines;
  }
  const failed = item.status === "failed" || (item.type === "command_execution" && finished && item.exit_code > 0);
  const state: LogLine["state"] = failed ? "error" : finished ? "done" : "active";
  switch (item.type) {
    case "file_change": {
      const changes: any[] = Array.isArray(item.changes) ? item.changes : [];
      const files = changes.map((c) => shortPath(c?.path)).filter((f): f is string => !!f);
      return put({
        key, step, kind: "tool", tool: "write_to_file",
        verb: changes[0]?.kind === "add" ? "Laying out the design" : "Refining details",
        detail: files[0], files, state,
      });
    }
    case "command_execution":
      return put({ key, step, kind: "tool", tool: "run_command", verb: "Checking the work", state });
    case "web_search":
      return put({ key, step, kind: "tool", tool: "search_web", verb: "Looking for references", detail: item.query, state });
    case "reasoning":
    case "mcp_tool_call":
      return put({ key, step, kind: "tool", tool: "call_mcp_tool", verb: "Thinking it through", state });
    default:
      return lines;
  }
}

/** Fold one stream-json event into the running log. */
export function foldEvent(lines: LogLine[], event: any): LogLine[] {
  if (typeof event?.type === "string") return foldCodex(lines, event);
  if (event?.event === "init") {
    const model = event.init?.model;
    return [
      ...lines,
      { key: "init", step: -1, kind: "system", verb: "Reading your brief", detail: model, state: "done" },
    ];
  }
  const s = event?.step_update;
  if (!s || s.step_type === "user_input") return lines;
  const key = `s${s.step_index}`;
  const state: LogLine["state"] = s.state === "ERROR" ? "error" : s.state === "DONE" ? "done" : "active";
  const idx = lines.findIndex((l) => l.key === key);

  if (s.step_type === "agent_response") {
    const delta: string = s.text_delta ?? "";
    if (!delta.trim() && idx < 0) return lines;
    const prev = idx >= 0 ? lines[idx] : undefined;
    const next: LogLine = {
      key,
      step: s.step_index,
      kind: "say",
      verb: "Note from the agent",
      detail: ((prev?.detail ?? "") + delta).replace(/\s+$/, ""),
      state,
      seconds: s.duration_seconds ?? prev?.seconds,
    };
    if (!next.detail) return lines;
    return idx >= 0 ? lines.map((l, i) => (i === idx ? next : l)) : [...lines, next];
  }

  const tool: string = s.tool_name ?? "tool";
  const next: LogLine = {
    key,
    step: s.step_index,
    kind: "tool",
    tool,
    verb: VERBS[tool] ?? "Working",
    detail: fileOf(s.tool_info) ?? (state === "error" ? s.tool_info?.error?.message : undefined),
    state,
    seconds: s.duration_seconds,
  };
  return idx >= 0 ? lines.map((l, i) => (i === idx ? next : l)) : [...lines, next];
}

const WRITES = /write|replace|edit|sed_file/i;
const READS = /view|read|list|find|grep/i;

/** Files the run has written so far, in order, with whether each write finished. */
export function runFiles(lines: LogLine[]): { name: string; done: boolean }[] {
  const out = new Map<string, boolean>();
  for (const l of lines) {
    if (l.kind !== "tool" || !WRITES.test(l.tool ?? "") || l.state === "error") continue;
    for (const f of l.files ?? (l.detail ? [l.detail] : [])) out.set(f, l.state === "done");
  }
  return [...out].map(([name, done]) => ({ name, done }));
}

/** What the agent is doing right now, in a few words. */
export function runPhase(lines: LogLine[], revising = false): string {
  const tools = lines.filter((l) => l.kind === "tool");
  const last = tools[tools.length - 1];
  if (!last) return lines.some((l) => l.kind === "say") ? (revising ? "Working out the change" : "Planning the design") : "Reading the brief";
  if (last.state === "active" && WRITES.test(last.tool ?? "")) {
    const n = last.files?.length ?? 1;
    return n > 1 ? `Writing ${n} files` : `Writing ${last.detail ?? "the design"}`;
  }
  if (last.state === "active" && READS.test(last.tool ?? "")) return last.detail ? `Reading ${last.detail}` : "Reading the design";
  if (runFiles(lines).length) return "Finishing up";
  return revising ? "Working out the change" : "Planning the design";
}
