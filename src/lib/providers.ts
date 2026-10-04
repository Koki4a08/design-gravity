import type { Provider, Settings } from "./types";

export interface ProviderInfo {
  id: Provider;
  /** Product name, for messages. */
  name: string;
  /** Command the app drives. */
  cli: string;
  sub: string;
  defaultModel: string;
  pathHint: string;
}

export const PROVIDERS: Record<Provider, ProviderInfo> = {
  antigravity: {
    id: "antigravity",
    name: "Antigravity",
    cli: "agy",
    sub: "Google Antigravity CLI",
    defaultModel: "Antigravity default",
    pathHint: "Custom agy.exe location (optional)",
  },
  codex: {
    id: "codex",
    name: "Codex",
    cli: "codex",
    sub: "OpenAI Codex CLI",
    defaultModel: "Codex default",
    pathHint: "Custom codex location (optional)",
  },
};

export const PROVIDER_LIST = Object.values(PROVIDERS);

export const cliPath = (s: Pick<Settings, "provider" | "agyPath" | "codexPath">, p: Provider = s.provider) =>
  p === "codex" ? s.codexPath : s.agyPath;
