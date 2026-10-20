"use client";

import { useState } from "react";
import { ArrowDownAZ, ArrowUpAZ, Columns3, Filter, Minus, Plus, RotateCcw } from "lucide-react";
import { EMPTY_PREFS, hasActiveFilters, toggleHidden, withWidth, type SheetViewPrefs } from "./sheet-view-prefs";

type Col = { key: string; title: string; width: number };

/** Barra de la planilla: columnas (mostrar/ocultar/ancho), filtros por columna y orden. Todo con botones grandes (táctil). */
export function SheetViewBar({
  testId,
  columns,
  prefs,
  setPrefs,
  locked,
  total,
  shown,
}: {
  testId: string;
  columns: Col[];
  prefs: SheetViewPrefs;
  setPrefs: (next: SheetViewPrefs) => void;
  /** Columnas que no se pueden ocultar (obligatorias para crear filas). */
  locked: readonly string[];
  total: number;
  shown: number;
}) {
  const [panel, setPanel] = useState<null | "cols" | "filters">(null);
  const filtering = hasActiveFilters(prefs);
  const customized = prefs.hidden.length > 0 || Object.keys(prefs.widths).length > 0 || prefs.sortKey != null || filtering;
  const btn = "inline-flex min-h-11 items-center gap-1 rounded border border-[var(--os-border)] bg-[var(--os-surface)] px-3 text-xs font-medium hover:bg-[var(--os-teal-soft)]/50";
  return (
    <div className="space-y-2" data-testid={`${testId}-viewbar`}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btn} aria-expanded={panel === "cols"} onClick={() => setPanel(panel === "cols" ? null : "cols")} data-testid={`${testId}-cols-btn`}>
          <Columns3 className="size-4" aria-hidden="true" /> Columnas{prefs.hidden.length ? ` (${prefs.hidden.length} ocultas)` : ""}
        </button>
        <button type="button" className={btn} aria-expanded={panel === "filters"} onClick={() => setPanel(panel === "filters" ? null : "filters")} data-testid={`${testId}-filters-btn`}>
          <Filter className="size-4" aria-hidden="true" /> Filtros y orden{filtering || prefs.sortKey ? " •" : ""}
        </button>
        {filtering ? (
          <span className="text-xs text-[var(--os-text-muted)]" data-testid={`${testId}-filter-count`}>
            Mostrando {shown} de {total}
          </span>
        ) : null}
        {customized ? (
          <button type="button" className={btn} onClick={() => setPrefs(EMPTY_PREFS)} data-testid={`${testId}-view-reset`}>
            <RotateCcw className="size-4" aria-hidden="true" /> Restablecer vista
          </button>
        ) : null}
      </div>
      {panel === "cols" ? (
        <div className="max-h-72 space-y-1 overflow-y-auto rounded border border-[var(--os-border)] bg-[var(--os-surface)] p-2" data-testid={`${testId}-cols-panel`}>
          <p className="text-xs text-[var(--os-text-muted)]">Mostrar u ocultar columnas y cambiar su ancho. Solo cambia cómo la ves: los datos no se tocan. Se recuerda para tu usuario en este navegador.</p>
          {columns.map((c) => {
            const isLocked = locked.includes(c.key);
            const hidden = prefs.hidden.includes(c.key);
            return (
              <div key={c.key} className="flex items-center gap-2 text-sm">
                <label className="flex min-h-11 flex-1 items-center gap-2">
                  <input type="checkbox" className="size-5" checked={!hidden} disabled={isLocked} onChange={() => setPrefs(toggleHidden(prefs, c.key, locked))} data-testid={`${testId}-col-toggle`} data-col={c.key} />
                  <span className={hidden ? "text-[var(--os-text-muted)] line-through" : ""}>{c.title}</span>
                  {isLocked ? <span className="text-[10px] text-[var(--os-text-muted)]">(obligatoria)</span> : null}
                </label>
                <button type="button" className="inline-flex size-11 items-center justify-center rounded border border-[var(--os-border)]" aria-label={`Achicar ${c.title}`} onClick={() => setPrefs(withWidth(prefs, c.key, c.width - 30))} data-testid={`${testId}-col-narrow`} data-col={c.key}>
                  <Minus className="size-4" aria-hidden="true" />
                </button>
                <span className="w-10 text-center text-xs tabular-nums" data-testid={`${testId}-col-width`} data-col={c.key}>{c.width}</span>
                <button type="button" className="inline-flex size-11 items-center justify-center rounded border border-[var(--os-border)]" aria-label={`Ensanchar ${c.title}`} onClick={() => setPrefs(withWidth(prefs, c.key, c.width + 30))} data-testid={`${testId}-col-wide`} data-col={c.key}>
                  <Plus className="size-4" aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
      {panel === "filters" ? (
        <div className="max-h-56 space-y-2 overflow-y-auto rounded border border-[var(--os-border)] bg-[var(--os-surface)] p-2" data-testid={`${testId}-filters-panel`}>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-2">
              Ordenar por
              <select className="min-h-11 rounded border border-[var(--os-border)] bg-[var(--os-surface)] px-2" value={prefs.sortKey ?? ""} onChange={(e) => setPrefs({ ...prefs, sortKey: e.target.value || null })} data-testid={`${testId}-sort-col`}>
                <option value="">Orden original</option>
                {columns.map((c) => (
                  <option key={c.key} value={c.key}>{c.title}</option>
                ))}
              </select>
            </label>
            <button type="button" className={btn} disabled={!prefs.sortKey} onClick={() => setPrefs({ ...prefs, sortDir: prefs.sortDir === "asc" ? "desc" : "asc" })} data-testid={`${testId}-sort-dir`}>
              {prefs.sortDir === "asc" ? <ArrowDownAZ className="size-4" aria-hidden="true" /> : <ArrowUpAZ className="size-4" aria-hidden="true" />}
              {prefs.sortDir === "asc" ? "Ascendente" : "Descendente"}
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {columns.map((c) => (
              <label key={c.key} className="block text-xs">
                {c.title} contiene
                <input
                  type="search"
                  className="mt-1 min-h-11 w-full rounded border border-[var(--os-border)] bg-[var(--os-surface)] px-2 text-sm"
                  value={prefs.filters[c.key] ?? ""}
                  onChange={(e) => setPrefs({ ...prefs, filters: { ...prefs.filters, [c.key]: e.target.value } })}
                  data-testid={`${testId}-filter`}
                  data-col={c.key}
                />
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
