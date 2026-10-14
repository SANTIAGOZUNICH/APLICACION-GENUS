"use client";

import { monthName } from "@/lib/dashboard/format";
import type { DashboardFilters, DashboardPayload } from "@/lib/dashboard/types";

const SELECT =
  "mt-1 block h-10 w-full min-w-0 rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-bg)] px-2.5 text-sm text-[var(--os-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-teal)]";

type Props = {
  filters: DashboardFilters;
  options: DashboardPayload["filterOptions"];
  canFilterClient: boolean;
  onChange: (next: DashboardFilters) => void;
  disabled?: boolean;
};

/** Filtros: año, mes/período, sector y (solo Producción/Dirección) cliente. */
export function DashboardFiltersBar({ filters, options, canFilterClient, onChange, disabled }: Props) {
  const years = options.years.includes(filters.year) ? options.years : [filters.year, ...options.years];
  const dirty = filters.month != null || filters.sector !== "ALL" || filters.client != null;
  return (
    <form
      className="grid min-w-0 gap-3 rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-4 sm:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,1fr))_auto]"
      aria-label="Filtros del Dashboard"
      data-testid="dashboard-filters"
      onSubmit={(e) => e.preventDefault()}
    >
      <label className="min-w-0 text-xs font-medium text-[var(--os-text-muted)]">
        Año
        <select className={SELECT} value={filters.year} disabled={disabled} onChange={(e) => onChange({ ...filters, year: Number(e.target.value) })} data-testid="filter-year">
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>
      <label className="min-w-0 text-xs font-medium text-[var(--os-text-muted)]">
        Mes / período
        <select
          className={SELECT}
          value={filters.month ?? ""}
          disabled={disabled}
          onChange={(e) => onChange({ ...filters, month: e.target.value ? Number(e.target.value) : null })}
          data-testid="filter-month"
        >
          <option value="">Año completo</option>
          {Array.from({ length: 12 }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              {monthName(i + 1)}
            </option>
          ))}
        </select>
      </label>
      <label className="min-w-0 text-xs font-medium text-[var(--os-text-muted)]">
        Sector
        <select
          className={SELECT}
          value={filters.sector}
          disabled={disabled}
          onChange={(e) => onChange({ ...filters, sector: e.target.value as DashboardFilters["sector"] })}
          data-testid="filter-sector"
        >
          <option value="ALL">Todos</option>
          <option value="ENVASADO_MASIVO">Envasado Masivo</option>
          <option value="ENVASADO_PREMIUM">Envasado Premium</option>
        </select>
      </label>
      {canFilterClient ? (
        <label className="min-w-0 text-xs font-medium text-[var(--os-text-muted)]">
          Cliente
          <select
            className={SELECT}
            value={filters.client ?? ""}
            disabled={disabled}
            onChange={(e) => onChange({ ...filters, client: e.target.value || null })}
            data-testid="filter-client"
          >
            <option value="">Todos los clientes</option>
            {options.clients.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="min-w-0 self-end pb-2 text-xs text-[var(--os-text-muted)]" data-testid="filter-client-unavailable">
          Filtro por cliente: solo Producción y Dirección.
        </p>
      )}
      <div className="flex items-end">
        <button
          type="button"
          disabled={!dirty || disabled}
          onClick={() => onChange({ ...filters, month: null, sector: "ALL", client: null })}
          className="h-10 rounded-[var(--os-radius-sm)] border border-[var(--os-border)] px-3 text-sm text-[var(--os-text)] hover:bg-white/10 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-teal)]"
          data-testid="filter-reset"
        >
          Limpiar filtros
        </button>
      </div>
    </form>
  );
}
