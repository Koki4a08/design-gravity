import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Check, ChevronDown, LoaderCircle, Palette, Plug, RefreshCw, SlidersHorizontal, X } from "lucide-react";
import { useStudio } from "../lib/studio";
import { timeAgo } from "../lib/format";
import { Dropdown } from "./Dropdown";
import { findTheme, THEMES } from "../lib/themes";
import { PROVIDER_LIST, PROVIDERS } from "../lib/providers";
import { ProviderIcon } from "./ProviderIcon";
import { ModelPicker } from "./ModelPicker";
import type { Provider } from "../lib/types";

export type SettingsPage = "general" | "themes" | "providers";

const PAGES: { id: SettingsPage; label: string; icon: ReactNode }[] = [
  { id: "general", label: "General", icon: <SlidersHorizontal aria-hidden /> },
  { id: "themes", label: "Themes", icon: <Palette aria-hidden /> },
  { id: "providers", label: "Providers", icon: <Plug aria-hidden /> },
];

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-row-text">
        <p className="set-row-label">{label}</p>
        {hint && <p className="set-row-hint">{hint}</p>}
      </div>
      <div className="set-row-control">{children}</div>
    </div>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange(v: boolean): void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)}>
      <span className="switch-knob" />
    </button>
  );
}

function General() {
  const s = useStudio();
  return (
    <>
      <h2 className="set-title">General</h2>
      <div className="set-group">
        <Row label="Default model" hint="Provider and model for new designs. Each design can pick its own in the chat.">
          <ModelPicker
            id="set-model"
            label="Default model"
            value={{ provider: s.settings.provider, model: s.settings.model }}
            onChange={(c) => c && s.setChoice(c)}
          />
        </Row>
        <Row label="System tasks" hint="Runs the app starts on its own: design-system questions and builds, critiques, code export.">
          <ModelPicker
            id="set-system-model"
            label="System tasks"
            inherit="Same as default model"
            value={s.settings.systemProvider ? { provider: s.settings.systemProvider, model: s.settings.systemModel } : null}
            onChange={(c) =>
              s.setSettings(c ? { systemProvider: c.provider, systemModel: c.model } : { systemProvider: "", systemModel: "" })
            }
          />
        </Row>
        <Row label="Reasoning effort" hint="Higher effort thinks longer before designing.">
          <Dropdown
            id="set-effort"
            label="Reasoning effort"
            value={s.settings.effort}
            onChange={(v) => s.setSettings({ effort: v })}
            options={[
              { value: "", label: "Model default" },
              { value: "low", label: "Low" },
              { value: "medium", label: "Medium" },
              { value: "high", label: "High" },
              { value: "max", label: "Max" },
            ]}
          />
        </Row>
        <Row label="Background motion" hint="The moving contour lines on the home screen.">
          <Switch checked={s.settings.motion} onChange={(v) => s.setSettings({ motion: v })} label="Background motion" />
        </Row>
      </div>
    </>
  );
}

function Themes() {
  const s = useStudio();
  const current = findTheme(s.settings.theme).id;
  return (
    <>
      <h2 className="set-title">Themes</h2>
      <p className="set-lede">Colours for the whole app. Designs keep their own palettes.</p>
      <div className="themes" role="radiogroup" aria-label="Theme">
        {THEMES.map((t) => {
          const on = t.id === current;
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={on}
              className="theme-card"
              onClick={() => s.setSettings({ theme: t.id })}
            >
              <span className="theme-preview" style={{ background: t.paper, borderColor: t.raised2 }} aria-hidden>
                <span className="theme-pane" style={{ background: t.raised }}>
                  <span style={{ background: t.ink, width: "62%" }} />
                  <span style={{ background: t.ink3, width: "84%" }} />
                  <span style={{ background: t.ink3, width: "48%" }} />
                </span>
                <span className="theme-dots">
                  <span style={{ background: t.blue }} />
                  <span style={{ background: t.teal }} />
                  <span className="theme-action" style={{ background: t.magenta }} />
                </span>
              </span>
              <span className="theme-meta">
                <span className="theme-name">
                  {t.name}
                  {on && <Check aria-hidden />}
                </span>
                <span className="theme-blurb">{t.blurb}</span>
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

type Mark = "ok" | "bad" | "busy" | "idle";

function StatusPill({ mark, children }: { mark: Mark; children: ReactNode }) {
  return (
    <span className="pill" data-mark={mark}>
      {mark === "busy" ? <LoaderCircle className="spin" aria-hidden /> : <span className="pill-dot" aria-hidden />}
      {children}
    </span>
  );
}

function Fact({ label, children, action }: { label: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
      {action && <div className="fact-action">{action}</div>}
    </div>
  );
}

function RefreshBtn({ busy, onClick, label }: { busy: boolean; onClick(): void; label: string }) {
  return (
    <button className="icon-btn refresh" onClick={onClick} disabled={busy} aria-label={label} title={label}>
      <RefreshCw className={busy ? "spin" : ""} aria-hidden />
    </button>
  );
}

const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

const SIGN_IN_TYPES: Record<string, string> = {
  consumer: "Personal Google account",
  chatgpt: "ChatGPT account",
  "api-key": "API key",
};

function ProviderCard({ id }: { id: Provider }) {
  const s = useStudio();
  const info = PROVIDERS[id];
  const { status: st, checking, ping, pinging, usage } = s.providers[id];
  const active = s.settings.provider === id;
  const pathKey = id === "codex" ? "codexPath" : "agyPath";
  const savedPath = s.settings[pathKey];
  const [open, setOpen] = useState(active);
  const [waiting, setWaiting] = useState(false);
  const [path, setPath] = useState(savedPath);
  useEffect(() => setPath(savedPath), [savedPath]);

  // The settings page is the only place that looks at the provider that isn't active.
  useEffect(() => {
    if (!st && !checking) s.refreshStatus(id);
  }, [id]);

  useEffect(() => {
    if (!waiting) return;
    if (st?.authenticated) {
      setWaiting(false);
      return;
    }
    const started = Date.now();
    const t = setInterval(() => {
      if (Date.now() - started > 180_000) setWaiting(false);
      else s.refreshStatus(id);
    }, 4000);
    return () => clearInterval(t);
  }, [waiting, st?.authenticated, s.refreshStatus, id]);

  const mark: Mark = !st && checking ? "busy" : st?.installed && st.authenticated ? "ok" : "bad";
  const summary = !st ? "Checking…" : !st.installed ? "CLI not found" : !st.authenticated ? "Signed out" : "Connected";

  // Seven local days of app-recorded usage.
  const week = useMemo(() => {
    const days: { key: string; label: string; turns: number; tokens: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const u = usage.days[key];
      days.push({ key, label: d.toLocaleDateString(undefined, { weekday: "narrow" }), turns: u?.turns ?? 0, tokens: u?.tokens ?? 0 });
    }
    return days;
  }, [usage]);
  const today = week[week.length - 1];
  const weekTokens = week.reduce((t, d) => t + d.tokens, 0);
  const weekTurns = week.reduce((t, d) => t + d.turns, 0);
  const peak = Math.max(1, ...week.map((d) => d.tokens));
  const limitedRecently = !!usage.lastRateLimit && Date.now() - usage.lastRateLimit < 6 * 3600000;

  return (
    <div className={"provider" + (open ? " is-open" : "")}>
      <button className="provider-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="provider-mark" aria-hidden><ProviderIcon id={id} /></span>
        <span className="provider-name">
          {info.name}
          <span className="provider-sub">{active ? "Default · " : ""}{st?.account ?? info.sub}</span>
        </span>
        <StatusPill mark={checking ? "busy" : mark}>{checking ? "Checking" : summary}</StatusPill>
        <ChevronDown className="provider-chevron" aria-hidden />
      </button>

      <div className="provider-body" hidden={!open}>
        <section className="p-section">
          <header className="p-section-head">
            <h3>Account</h3>
            <RefreshBtn busy={checking} onClick={() => s.refreshStatus(id)} label="Check account again" />
          </header>
          <dl className="facts">
            <Fact label="Signed in as">{st?.account ?? (st?.authenticated ? "Signed in" : "Not signed in")}</Fact>
            <Fact label="Sign-in type">{(st?.authMethod && SIGN_IN_TYPES[st.authMethod]) ?? st?.authMethod ?? "–"}</Fact>
            <Fact label="Last checked">{st ? timeAgo(st.checkedAt) : "–"}</Fact>
          </dl>
          {st?.installed && !st.authenticated && (
            <div className="p-callout">
              <p>{waiting ? "Finish signing in in the terminal that opened." : st.detail}</p>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  await s.openSignIn(id);
                  setWaiting(true);
                }}
              >
                {waiting ? "Open terminal again" : "Sign in"}
              </button>
            </div>
          )}
          {st?.authenticated && (
            <button className="btn btn-sm p-link" onClick={() => s.openSignIn(id)}>
              Switch account
            </button>
          )}
        </section>

        <section className="p-section">
          <header className="p-section-head">
            <h3>Usage</h3>
            {limitedRecently && <StatusPill mark="bad">Limit hit {timeAgo(usage.lastRateLimit!)}</StatusPill>}
          </header>
          <div className="usage">
            <div className="usage-stat">
              <span className="usage-num">{today.turns}</span>
              <span className="usage-label">turns today</span>
            </div>
            <div className="usage-stat">
              <span className="usage-num">{fmt(today.tokens)}</span>
              <span className="usage-label">tokens today</span>
            </div>
            <div className="usage-stat">
              <span className="usage-num">{fmt(weekTokens)}</span>
              <span className="usage-label">{weekTurns} turns · 7 days</span>
            </div>
            <div className="usage-bars" role="img" aria-label="Tokens per day, last 7 days">
              {week.map((d) => (
                <span key={d.key} className="usage-bar" title={`${d.key}: ${fmt(d.tokens)} tokens, ${d.turns} turns`}>
                  <span className="usage-fill" style={{ height: `${Math.max(4, (d.tokens / peak) * 100)}%` }} data-empty={d.tokens === 0 || undefined} />
                  <em>{d.label}</em>
                </span>
              ))}
            </div>
          </div>
          <p className="p-note">
            Counted by Design Gravity from each run. The {info.name} CLI doesn’t report remaining quota; if a run hits
            a limit, it shows here.
          </p>
        </section>

        <section className="p-section">
          <header className="p-section-head">
            <h3>Connection</h3>
            <RefreshBtn busy={checking} onClick={() => s.refreshStatus(id)} label="Reload models" />
          </header>
          <dl className="facts">
            <Fact
              label="Test turn"
              action={
                <button className="btn btn-sm" onClick={() => s.runPing(id)} disabled={pinging || !st?.authenticated}>
                  {pinging ? "Running…" : "Run"}
                </button>
              }
            >
              {pinging ? (
                "Waiting for the agent…"
              ) : ping ? (
                ping.ok ? (
                  <span className="ok-text">
                    <Check aria-hidden /> Answered in {(ping.latencyMs / 1000).toFixed(1)} s
                  </span>
                ) : (
                  <span className="bad-text">{ping.detail}</span>
                )
              ) : (
                "Not run yet"
              )}
            </Fact>
            <Fact label="Last run">{usage.lastSuccess ? `Succeeded ${timeAgo(usage.lastSuccess)}` : "No runs yet"}</Fact>
            <Fact label="Models">{st?.models.length ? `${st.models.length} available` : "None"}</Fact>
          </dl>
          {!!st?.models.length && (
            <div className="model-list">
              {st.models.map((m) => (
                <span key={m.id} className="model-chip" title={m.id}>
                  {m.label}
                </span>
              ))}
            </div>
          )}
        </section>

        <section className="p-section">
          <header className="p-section-head">
            <h3>CLI</h3>
          </header>
          <dl className="facts">
            <Fact label="Version">{st?.version ?? "–"}</Fact>
            <Fact label="Location">
              <span className="mono path" title={st?.path ?? ""}>{st?.path ?? "Not found"}</span>
            </Fact>
          </dl>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              s.setSettings({ [pathKey]: path });
            }}
          >
            <label className="visually-hidden" htmlFor={`set-path-${id}`}>Custom {info.cli} location</label>
            <input
              id={`set-path-${id}`}
              className="input mono-input"
              placeholder={info.pathHint}
              value={path}
              onChange={(e) => setPath(e.target.value)}
              spellCheck={false}
            />
            <button className="btn btn-sm" type="submit" disabled={path === savedPath}>Save</button>
          </form>
        </section>
      </div>
    </div>
  );
}

function Providers() {
  return (
    <>
      <h2 className="set-title">Providers</h2>
      <p className="set-lede">Where designs are generated. Design Gravity drives the CLI on this computer.</p>
      {PROVIDER_LIST.map((p) => (
        <ProviderCard key={p.id} id={p.id} />
      ))}
    </>
  );
}

/** Settings: a sidebar of pages and a content pane. */
export function SettingsModal({ open, page, onPage, onClose }: {
  open: boolean;
  page: SettingsPage;
  onPage(p: SettingsPage): void;
  onClose(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="modal settings"
      aria-label="Settings"
      onClose={onClose}
      onCancel={(e) => {
        // An open menu inside the dialog takes Escape first.
        if (document.querySelector(".dd-menu, .mp, .menu, .cp")) e.preventDefault();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      <nav className="settings-nav" aria-label="Settings sections">
        <p className="settings-nav-title">Settings</p>
        {PAGES.map((p) => (
          <button
            key={p.id}
            className="settings-nav-item"
            aria-current={page === p.id ? "page" : undefined}
            onClick={() => onPage(p.id)}
          >
            {p.icon}
            {p.label}
          </button>
        ))}
      </nav>
      <div className="settings-pane">
        <button className="icon-btn settings-close" onClick={onClose} aria-label="Close settings">
          <X aria-hidden />
        </button>
        <div className="settings-page" key={page}>
          {page === "general" ? <General /> : page === "themes" ? <Themes /> : <Providers />}
        </div>
      </div>
    </dialog>
  );
}
