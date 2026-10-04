import type { LogLine } from "./types";

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

const fileOf = (info: any): string | undefined => {
  const p = info?.parameters ?? {};
  const f = p.TargetFile ?? p.AbsolutePath ?? p.File ?? p.Path;
  return typeof f === "string" ? f.split(/[\\/]/).pop() : undefined;
};

const baseName = (p: unknown) => (typeof p === "string" ? p.split(/[\\/]/).pop() : undefined);

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
      const first = item.changes?.[0];
      return put({
        key, step, kind: "tool", tool: "write_to_file",
        verb: first?.kind === "add" ? "Laying out the design" : "Refining details",
        detail: baseName(first?.path), state,
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
