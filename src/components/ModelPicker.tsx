import { useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Search, Star } from "lucide-react";
import { useStudio } from "../lib/studio";
import { PROVIDER_LIST, PROVIDERS } from "../lib/providers";
import type { AgyModel, ModelChoice, Provider } from "../lib/types";
import { ProviderIcon } from "./ProviderIcon";
import { layerFor } from "./Dropdown";
import { SettingsCtx } from "./SettingsButton";

interface Props {
  /** null: follow `inherit`. */
  value: ModelChoice | null;
  onChange(c: ModelChoice | null): void;
  label: string;
  /** field: bordered, full width. quiet: borderless, sits in toolbars. */
  variant?: "field" | "quiet";
  disabled?: boolean;
  id?: string;
  /** Offer a first row that follows another setting, with this label. */
  inherit?: string;
}

type Tab = Provider | "favorites";

type Row =
  | { kind: "model"; key: string; choice: ModelChoice | null; label: string; sub: string; provider?: Provider }
  | { kind: "legacy"; key: string; count: number }
  | { kind: "back"; key: string };

const keyOf = (c: ModelChoice | null) => (c ? `${c.provider}:${c.model}` : "inherit");
const WIDTH = 300;
const HEIGHT = 320;

/** Provider rail on the left, that provider's models on the right; one pick sets both. */
export function ModelPicker(p: Props) {
  const s = useStudio();
  const openSettings = useContext(SettingsCtx);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>(p.value?.provider ?? s.settings.provider);
  const [legacyOpen, setLegacyOpen] = useState(false);
  /** Direction of the last step into or out of the legacy list, for its slide. */
  const [slide, setSlide] = useState<"in" | "out" | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<CSSProperties>({});
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const uid = useId();

  const models = useCallback((pr: Provider): AgyModel[] => s.providers[pr].status?.models ?? [], [s.providers]);
  const labelOf = useCallback(
    (c: ModelChoice) => (c.model ? models(c.provider).find((m) => m.id === c.model)?.label ?? c.model : PROVIDERS[c.provider].defaultModel),
    [models],
  );
  const favorites = s.settings.favoriteModels;
  const isFavorite = (c: ModelChoice | null) => !!c && favorites.includes(keyOf(c));
  const toggleFavorite = (c: ModelChoice) => {
    const k = keyOf(c);
    s.setSettings({ favoriteModels: favorites.includes(k) ? favorites.filter((f) => f !== k) : [...favorites, k] });
  };

  const q = query.trim().toLowerCase();
  const rows = useMemo<Row[]>(() => {
    const row = (c: ModelChoice, sub = PROVIDERS[c.provider].name): Row => ({
      kind: "model", key: keyOf(c), choice: c, label: labelOf(c), sub, provider: c.provider,
    });
    const defaultRow = (pr: Provider) => row({ provider: pr, model: "" }, `${PROVIDERS[pr].name} · the CLI picks`);
    const inherit: Row[] = p.inherit ? [{ kind: "model", key: "inherit", choice: null, label: p.inherit, sub: "Follows your default model" }] : [];
    let out: Row[];
    if (q) {
      const matches = (r: Row) => r.kind === "model" && `${r.label} ${r.sub} ${r.choice?.model ?? ""}`.toLowerCase().includes(q);
      const all = PROVIDER_LIST.flatMap((pr) => [defaultRow(pr.id), ...models(pr.id).map((m) => row({ provider: pr.id, model: m.id }))]);
      out = [...inherit, ...all].filter(matches);
    } else if (tab === "favorites") {
      out = favorites
        .map((k) => {
          const i = k.indexOf(":");
          const pr = k.slice(0, i) as Provider;
          return PROVIDERS[pr] ? row({ provider: pr, model: k.slice(i + 1) }) : null;
        })
        .filter((r): r is Row => !!r);
    } else if (!s.providers[tab].status?.authenticated) {
      out = [];
    } else {
      const all = models(tab);
      const legacy = all.filter((m) => m.legacy);
      out = legacyOpen
        ? [{ kind: "back", key: "back" }, ...legacy.map((m) => row({ provider: tab, model: m.id }))]
        : [
            ...inherit,
            defaultRow(tab),
            ...all.filter((m) => !m.legacy).map((m) => row({ provider: tab, model: m.id })),
            ...(legacy.length ? [{ kind: "legacy" as const, key: "legacy", count: legacy.length }] : []),
          ];
    }
    return out;
  }, [q, tab, legacyOpen, favorites, models, labelOf, p.inherit, s.providers]);

  const place = useCallback(() => {
    const r = trigger.current?.getBoundingClientRect();
    if (!r) return;
    const room = window.innerHeight - r.bottom;
    const up = room < HEIGHT + 16 && r.top > room;
    const left = Math.max(12, Math.min(r.left, window.innerWidth - WIDTH - 12));
    setPos(
      up
        ? { left, width: WIDTH, bottom: window.innerHeight - r.top + 6, maxHeight: Math.min(HEIGHT, r.top - 16) }
        : { left, width: WIDTH, top: r.bottom + 6, maxHeight: Math.min(HEIGHT, room - 16) },
    );
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  // Every time it opens: the value's provider, legacy list if that's where the value lives.
  useEffect(() => {
    if (!open) return;
    const pr = p.value?.provider ?? s.settings.provider;
    setTab(pr);
    setLegacyOpen(!!p.value && !!models(pr).find((m) => m.id === p.value!.model)?.legacy);
    setSlide(null);
    setQuery("");
    requestAnimationFrame(() => search.current?.focus());
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !trigger.current?.contains(t)) setOpen(false);
    };
    const onScroll = (e: Event) => {
      if (!panel.current?.contains(e.target as Node)) place();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  // Land on the current value when the list changes, else the first row.
  useEffect(() => {
    const i = rows.findIndex((r) => r.kind === "model" && r.key === keyOf(p.value));
    setActive(Math.max(0, i));
  }, [rows]);

  useEffect(() => {
    const ul = list.current;
    const item = ul?.children[active] as HTMLElement | undefined;
    if (!open || !ul || !item) return;
    if (item.offsetTop < ul.scrollTop) ul.scrollTop = item.offsetTop - 4;
    else if (item.offsetTop + item.offsetHeight > ul.scrollTop + ul.clientHeight)
      ul.scrollTop = item.offsetTop + item.offsetHeight - ul.clientHeight + 4;
  }, [active, open]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  const drill = (into: boolean) => {
    setSlide(into ? "in" : "out");
    setLegacyOpen(into);
  };

  const activate = (r: Row | undefined) => {
    if (!r) return;
    if (r.kind === "legacy") return drill(true);
    if (r.kind === "back") return drill(false);
    p.onChange(r.choice);
    close();
  };

  const pickTab = (t: Tab) => {
    setTab(t);
    setLegacyOpen(false);
    setSlide(null);
    setQuery("");
    search.current?.focus();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (legacyOpen && !q) drill(false);
      else close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(rows.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      activate(rows[active]);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  const shown = p.value;
  const mixed = !!q || tab === "favorites";
  const tabStatus = tab === "favorites" ? null : s.providers[tab];

  return (
    <div className={`dd dd-${p.variant ?? "field"}`}>
      <button
        ref={trigger}
        id={p.id}
        type="button"
        className="dd-trigger mp-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${p.label}: ${shown ? `${labelOf(shown)}, ${PROVIDERS[shown.provider].name}` : p.inherit ?? ""}`}
        title={shown ? `${PROVIDERS[shown.provider].name} · ${labelOf(shown)}` : p.inherit}
        disabled={p.disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {shown && <ProviderIcon id={shown.provider} className="mp-trigger-icon" />}
        <span className="dd-value">{shown ? labelOf(shown) : p.inherit}</span>
        <ChevronDown className="dd-chevron" aria-hidden />
      </button>
      {open &&
        createPortal(
          <div ref={panel} className="mp" style={pos} role="dialog" aria-label={p.label} onKeyDown={onKey}>
            <div className="mp-rail" role="tablist" aria-orientation="vertical" aria-label="Providers">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "favorites" && !q}
                className="mp-tab"
                title="Favourites"
                aria-label="Favourites"
                onClick={() => pickTab("favorites")}
              >
                <Star aria-hidden />
              </button>
              <span className="mp-rail-rule" aria-hidden />
              {PROVIDER_LIST.map((pr) => {
                const st = s.providers[pr.id];
                const ok = !!st.status?.authenticated;
                return (
                  <button
                    key={pr.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === pr.id && !q}
                    className="mp-tab"
                    title={ok ? pr.name : `${pr.name} · not connected`}
                    aria-label={pr.name}
                    onClick={() => pickTab(pr.id)}
                  >
                    <ProviderIcon id={pr.id} />
                    {!ok && !st.checking && <span className="mp-tab-dot" aria-hidden />}
                  </button>
                );
              })}
            </div>
            <div className="mp-main">
              <label className="mp-search">
                <Search aria-hidden />
                <input
                  ref={search}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search models…"
                  aria-label="Search models"
                  aria-controls={`${uid}-list`}
                  aria-activedescendant={rows[active] ? `${uid}-${active}` : undefined}
                  spellCheck={false}
                />
              </label>
              {tabStatus && !q && !tabStatus.status?.authenticated ? (
                <div className="mp-empty">
                  {tabStatus.checking || !tabStatus.status ? (
                    <p>Checking {PROVIDERS[tab as Provider].name}…</p>
                  ) : (
                    <>
                      <p>{PROVIDERS[tab as Provider].name} isn’t connected.</p>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => {
                          setOpen(false);
                          openSettings("providers");
                        }}
                      >
                        Open settings
                      </button>
                    </>
                  )}
                </div>
              ) : !rows.length ? (
                <div className="mp-empty">
                  <p>{q ? "No models match." : "Star a model to keep it here."}</p>
                </div>
              ) : (
                <ul
                  ref={list}
                  key={legacyOpen ? "legacy" : "main"}
                  id={`${uid}-list`}
                  role="listbox"
                  aria-label={p.label}
                  className={"mp-list" + (slide && !q ? ` mp-slide-${slide}` : "")}
                >
                  {rows.map((r, i) => {
                    const common = {
                      id: `${uid}-${i}`,
                      className: "mp-row" + (i === active ? " is-active" : ""),
                      onMouseEnter: () => setActive(i),
                      onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
                      onClick: () => activate(r),
                    };
                    if (r.kind === "back")
                      return (
                        <li key={r.key} {...common} className={common.className + " mp-back"} role="option" aria-selected={false}>
                          <ChevronLeft className="mp-nav" aria-hidden />
                          <span className="mp-name">Legacy models</span>
                        </li>
                      );
                    if (r.kind === "legacy")
                      return (
                        <li key={r.key} {...common} role="option" aria-selected={false}>
                          <span className="mp-name mp-muted">Legacy models</span>
                          <span className="mp-count">{r.count}</span>
                          <ChevronRight className="mp-nav" aria-hidden />
                        </li>
                      );
                    const selected = r.key === keyOf(p.value);
                    const starred = isFavorite(r.choice);
                    return (
                      <li key={r.key} {...common} role="option" aria-selected={selected}>
                        {/* The provider only needs saying where the list mixes them. */}
                        {mixed && r.provider && <ProviderIcon id={r.provider} className="mp-row-icon" />}
                        <span className="mp-name">{r.label}</span>
                        {r.choice && (
                          <button
                            type="button"
                            className="mp-star"
                            aria-pressed={starred}
                            aria-label={starred ? `Unstar ${r.label}` : `Star ${r.label}`}
                            tabIndex={-1}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleFavorite(r.choice!);
                            }}
                          >
                            <Star aria-hidden />
                          </button>
                        )}
                        <Check className="mp-check" aria-hidden />
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>,
          layerFor(trigger.current),
        )}
    </div>
  );
}
