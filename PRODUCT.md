# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(Desktop app: Tauri v2 shell on Windows first; UI is a web view, so web conventions apply.)

## Stack

Tauri v2 (Rust backend) + React + TypeScript + Vite. Frontend stack delegated: chosen for typed state, a small dependency surface, and fast iteration inside Tauri's web view. Plain CSS with custom-property tokens; fonts self-hosted (the app must work offline).

## Users

Designers and design-minded developers on their own machine who want to go from a written brief to a concrete visual quickly, then keep shaping it by hand and by further prompts. They already use the Antigravity CLI (`agy`) and have a Google account signed in to it. *(Inferred from the brief; not confirmed in interview.)*

## Product Purpose

Design Gravity turns a prompt into a design and keeps it editable. Two outputs:

- **Screens:** self-contained HTML/CSS UI screens and pages.
- **Graphics:** SVG visuals (posters, marks, cards, illustrations).

Success: a user types a brief, sees a finished design render, then customizes it (tokens: type, color, radius, spacing; plus targeted prompt revisions) without leaving the app, and exports the result.

## Positioning

The generation engine is the user's own agent CLI, either Antigravity (`agy`) or OpenAI Codex (`codex`), running as an agent harness in a per-design workspace: the agent writes real files on disk, conversations are resumable, and the user's own models and quota are used. No hosted backend, no API keys in the app.

## Operating Context

- Runs the chosen provider headless inside a workspace folder per design and streams agent steps back to the UI: `agy -p --output-format stream-json --mode accept-edits`, or `codex exec --json` in a workspace-write sandbox with the prompt on stdin (user config ignored, so their MCP servers and hooks stay out of design runs).
- Iterations resume the same agent conversation (`--conversation <id>` for agy, `codex exec resume <thread>`). A conversation belongs to its provider; a design continued under the other provider starts a fresh thread in the same workspace.
- The app must verify that the active provider's CLI is installed and authenticated before allowing generation, and handle auth loss mid-session.

## Capabilities and Constraints

- Auth checks: binary present + version, account authenticated (model list resolves), optional live ping.
- Model picker sourced from `agy models` or `codex debug models`; a model id is only meaningful to its own provider.
- Generated HTML renders in a sandboxed iframe; no network assumption for the app shell itself.
- UI language: English.
- Undecided: export formats beyond HTML/SVG/PNG, cloud sync, collaboration.

## Brand Commitments

- Name: Design Gravity (from the project folder; confirm before release).
- User-pinned: editorial, light app world; typography is the hero and must be meticulous.

## Evidence on Hand

None. No customers, testimonials, or metrics exist; do not fabricate any. Sample prompts in the app are illustrative.

## Product Principles

1. The design is the page: chrome recedes, the artifact leads.
2. Every generation stays editable: tokens by hand, intent by prompt.
3. Honest agent state: show what the agent is doing, fail loudly and recoverably.
4. Local-first: the user's machine, the user's CLI, the user's files.
