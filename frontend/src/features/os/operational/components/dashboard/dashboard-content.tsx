"use client";

import { RefreshCw } from "lucide-react";
import { fmtInt, fmtPercent } from "@/lib/dashboard/format";
import { isNotAvailable, type DashboardFilters, type DashboardPayload } from "@/lib/dashboard/types";
import { SECTOR_LABELS } from "@/types/operational/sector";
import { DashboardBarChart, MASIVO_COLOR, PREMIUM_COLOR } from "./dashboard-bar-chart";
import { DashboardClients } from "./dashboard-clients";
import { DashboardFiltersBar } from "./dashboard-filters";
import { DashboardIndicators } from "./dashboard-indicators";
import { DashboardKpiCard, KpiOrBlocked } from "./dashboard-kpi-card";

const SOURCE_LABEL: Record<DashboardPayload["dataSource"], string> = {
  database: "Datos reales de GENUS OS",
  memory: "Modo demo (memoria): sin base de datos conectada",
  none: "Sin base de datos conectada",
};

function fmtDateTime(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "short", timeStyle: "short" });
}

function Section({ title, subtitle, children, testId }: { title: string; subtitle?: string; children: React.ReactNode; testId?: string }) {
  return (
    <section className="min-w-0 space-y-3" aria-label={title} data-testid={testId}>
      <div className="flex items-center gap-2">
        <span className="h-5 w-1 rounded-full bg-[var(--os-teal)]" aria-hidden="true" />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--os-text)]">{title}</h2>
        {subtitle ? <span className="hidden text-xs text-[var(--os-text-muted)] sm:inline">{subtitle}</span> : null}
      </div>
      {children}
    </section>
  );
}

type Props = {
  payload: DashboardPayload;
  filters: DashboardFilters;
  loading?: boolean;
  onFiltersChange: (next: DashboardFilters) => void;
  onRefresh?: () => void;
  onSaveTarget: (input: { key: string; value: number; direction: "min" | "max" }) => Promise<void>;
  onClearTarget: (key: string) => Promise<void>;
};

/** Contenido del Dashboard a partir de un payload YA recortado por el servidor (nunca decide permisos). */
export function DashboardContent({ payload, filters, loading, onFiltersChange, onRefresh, onSaveTarget, onClearTarget }: Props) {
  const { header, permissions, main, pedidos, produccion, clients, indicators, summary } = payload;
  const updated = fmtDateTime(header.lastDataChangeAt);
  const calculated = fmtDateTime(header.generatedAt);
  const sectorChip = header.sector === "ALL" ? null : SECTOR_LABELS[header.sector];
  const own = permissions.ownSector;

  return (
    <div className={`min-w-0 space-y-6 ${loading ? "opacity-70 transition-opacity" : ""}`} data-testid="dashboard-root" aria-busy={loading ? true : undefined}>
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-3 rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-4 shadow-[var(--os-shadow-sm)]">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-[var(--os-text)] sm:text-2xl" data-testid="dashboard-title">
            {header.title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-[var(--os-teal-muted)] px-2.5 py-1 font-semibold text-[var(--os-teal-glow)]" data-testid="dashboard-year">
              Año {header.year}
            </span>
            <span className="rounded-full bg-white/[0.08] px-2.5 py-1 text-[var(--os-text)]" data-testid="dashboard-period">
              {header.month ? header.periodLabel : "Año completo"}
            </span>
            {sectorChip ? <span className="rounded-full bg-white/[0.08] px-2.5 py-1 text-[var(--os-text)]">{sectorChip}</span> : null}
            {header.client ? <span className="max-w-full truncate rounded-full bg-white/[0.08] px-2.5 py-1 text-[var(--os-text)]">{header.client}</span> : null}
          </div>
        </div>
        <div className="min-w-0 text-right text-xs text-[var(--os-text-muted)]">
          <p data-testid="dashboard-updated">
            Última actualización de datos: <span className="font-semibold text-[var(--os-text)]">{updated ?? "sin datos cargados"}</span>
          </p>
          <p>Calculado: {calculated ?? "—"}</p>
          <p>{SOURCE_LABEL[payload.dataSource]}</p>
          {onRefresh ? (
            <button
              type="button"
              onClick={onRefresh}
              className="mt-1.5 inline-flex items-center gap-1.5 rounded-[var(--os-radius-sm)] border border-[var(--os-border)] px-2.5 py-1.5 text-xs text-[var(--os-text)] hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-teal)]"
              data-testid="dashboard-refresh"
            >
              <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
              Actualizar
            </button>
          ) : null}
        </div>
      </header>

      <DashboardFiltersBar filters={filters} options={payload.filterOptions} canFilterClient={permissions.canFilterClient} onChange={onFiltersChange} disabled={loading} />

      <Section title="Indicadores principales" testId="section-main">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiOrBlocked title="Nivel de servicio" kpi={main.nivelServicio} emphasis />
          <KpiOrBlocked title="% de pedidos sin reclamos" kpi={main.sinReclamos} emphasis />
          <KpiOrBlocked title="Lead time promedio" kpi={main.leadTime} emphasis />
          <DashboardKpiCard kpi={{ ...main.unidades, label: "Unidades producidas por año" }} emphasis testId="kpi-unidades_producidas" caption={filters.month ? "en el mes seleccionado" : "en el año"} />
        </div>
      </Section>

      <Section title="Gestión de pedidos" subtitle="Estado actual de los pedidos con fecha de pedido en el período" testId="section-pedidos">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <DashboardKpiCard kpi={pedidos.activos} caption="Ingreso, elaboración, envasado y codificado" />
          <DashboardKpiCard kpi={pedidos.entregados} caption="Estado «Entregado»" />
          <DashboardKpiCard kpi={pedidos.enDespacho} caption="Listos para entregar" />
          <DashboardKpiCard kpi={pedidos.productosDistintos} caption="Ítems distintos producidos" />
        </div>
      </Section>

      <Section title="Producción · Consumo Masivo vs Premium" subtitle={`Unidades por fecha de producción · ${produccion.periodLabel}`} testId="section-produccion">
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="grid min-w-0 gap-4 sm:grid-cols-3 lg:grid-cols-1" data-testid="produccion-sectores">
            <SectorCard label="Consumo Masivo" color={MASIVO_COLOR} units={produccion.masivo} share={produccion.masivoShare} highlight={own === "ENVASADO_MASIVO"} testId="prod-masivo" />
            <SectorCard label="Productos Premium" color={PREMIUM_COLOR} units={produccion.premium} share={produccion.premiumShare} highlight={own === "ENVASADO_PREMIUM"} testId="prod-premium" />
            <article className="rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-4" data-testid="prod-total">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">Total {filters.month ? "del mes" : "anual"}</h3>
              {produccion.total > 0 ? (
                <p className="mt-1 text-2xl font-bold tabular-nums text-[var(--os-text)]">{fmtInt(produccion.total)}</p>
              ) : (
                <p className="mt-1 text-base font-semibold text-[var(--os-text)]">Sin datos suficientes</p>
              )}
              <p className="mt-0.5 text-xs text-[var(--os-text-muted)]">unidades · {produccion.periodLabel}</p>
            </article>
          </div>
          <div className="min-w-0 rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-4 lg:col-span-2" data-testid="produccion-chart">
            <h3 className="mb-2 text-sm font-semibold text-[var(--os-text)]">Evolución mensual · {header.year}</h3>
            {produccion.monthly.every((m) => m.masivo === 0 && m.premium === 0) ? (
              <p className="py-8 text-center text-sm text-[var(--os-text-muted)]" data-testid="chart-sin-datos">
                Sin datos suficientes: no hay trabajos de Envasado terminados con fecha de cierre y cantidad final en {header.year}.
              </p>
            ) : (
              <DashboardBarChart data={produccion.monthly} selectedMonth={header.month} sector={header.sector} year={header.year} />
            )}
            {produccion.notes.length ? (
              <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-[var(--os-text-muted)]">
                {produccion.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </Section>

      <Section title="Clientes" subtitle="Solo Producción y Dirección" testId="section-clientes">
        <DashboardClients block={clients} />
      </Section>

      <Section title="Semáforo e indicadores" testId="section-indicadores">
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="min-w-0 lg:col-span-2">
            {isNotAvailable(indicators) ? (
              <p className="rounded-[var(--os-radius)] border border-dashed border-[var(--os-border)] p-4 text-sm text-[var(--os-text-muted)]">{indicators.reason}</p>
            ) : (
              <DashboardIndicators rows={indicators} canEditTargets={permissions.canEditTargets} schemaPending={payload.targetsSchemaPending} onSaveTarget={onSaveTarget} onClearTarget={onClearTarget} />
            )}
          </div>
          <section
            className="min-w-0 rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-4 shadow-[var(--os-shadow-sm)]"
            aria-label="Resumen gerencial"
            data-testid="dashboard-summary"
          >
            <h3 className="text-sm font-semibold text-[var(--os-text)]">Resumen gerencial</h3>
            <p className="mb-3 mt-0.5 text-xs text-[var(--os-text-muted)]">Generado con los números de arriba; omite lo que no tiene datos.</p>
            {summary.length ? (
              <ul className="space-y-2 text-sm leading-snug text-[var(--os-text)]">
                {summary.map((line) => (
                  <li key={line} className="flex gap-2">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--os-teal)]" aria-hidden="true" />
                    <span className="min-w-0">{line}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--os-text-muted)]">Sin datos suficientes para generar el resumen.</p>
            )}
          </section>
        </div>
      </Section>

      <p className="text-xs leading-relaxed text-[var(--os-text-muted)]" data-testid="dashboard-footnote">
        Los criterios de cada indicador son una propuesta, pendiente de validar contra la planilla «Dashboard Operativo 2026». Tocá el ícono de información de cada tarjeta para ver
        el criterio, la fuente y el tipo de fecha. El Dashboard es de solo lectura: no modifica pedidos, trabajos, entregas, stock ni remitos.
      </p>
    </div>
  );
}

function SectorCard({ label, color, units, share, highlight, testId }: { label: string; color: string; units: number; share: number | null; highlight: boolean; testId: string }) {
  return (
    <article
      className={`rounded-[var(--os-radius)] border bg-[var(--os-surface)] p-4 ${highlight ? "border-[var(--os-teal)]" : "border-[var(--os-border)]"}`}
      data-testid={testId}
    >
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
        <span className="size-2.5 rounded-sm" style={{ background: color }} aria-hidden="true" />
        {label}
        {highlight ? <span className="rounded bg-[var(--os-teal-muted)] px-1.5 py-0.5 text-[10px] normal-case text-[var(--os-teal-glow)]">Tu sector</span> : null}
      </h3>
      {share != null ? (
        <>
          <p className="mt-1 text-2xl font-bold tabular-nums text-[var(--os-text)]" data-testid={`${testId}-units`}>
            {fmtInt(units)}
          </p>
          <p className="text-xs text-[var(--os-text-muted)]">
            unidades · <span data-testid={`${testId}-share`}>{fmtPercent(share)}</span> del total
          </p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/[0.07]" aria-hidden="true">
            <div className="h-full rounded-full" style={{ width: `${share}%`, background: color }} />
          </div>
        </>
      ) : (
        <p className="mt-1 text-base font-semibold text-[var(--os-text)]">Sin datos suficientes</p>
      )}
    </article>
  );
}
