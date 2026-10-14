"use client";

import { fmtDays, fmtInt, fmtPercent } from "@/lib/dashboard/format";
import type { DashboardClientRow, DashboardClientsBlock } from "@/lib/dashboard/types";
import { DashboardKpiCard } from "./dashboard-kpi-card";

function Panel({ title, subtitle, children, testId }: { title: string; subtitle?: string; children: React.ReactNode; testId?: string }) {
  return (
    <section
      className="min-w-0 rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-4 shadow-[var(--os-shadow-sm)]"
      data-testid={testId}
      aria-label={title}
    >
      <h3 className="text-sm font-semibold text-[var(--os-text)]">{title}</h3>
      {subtitle ? <p className="mb-3 mt-0.5 text-xs text-[var(--os-text-muted)]">{subtitle}</p> : <div className="mb-3" />}
      {children}
    </section>
  );
}

function BarList({
  rows,
  value,
  label,
  empty,
  color,
}: {
  rows: DashboardClientRow[];
  value: (r: DashboardClientRow) => number;
  label: (r: DashboardClientRow) => string;
  empty: string;
  color: string;
}) {
  if (!rows.length) return <p className="text-sm text-[var(--os-text-muted)]">{empty}</p>;
  const max = Math.max(...rows.map(value), 1);
  return (
    <ol className="space-y-2">
      {rows.map((r, i) => (
        <li key={r.client} className="min-w-0">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="min-w-0 truncate font-medium text-[var(--os-text)]" title={r.client}>
              {i + 1}. {r.client}
            </span>
            <span className="shrink-0 tabular-nums font-semibold text-[var(--os-text)]">{label(r)}</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/[0.07]" aria-hidden="true">
            <div className="h-full rounded-full" style={{ width: `${Math.max(2, (value(r) / max) * 100)}%`, background: color }} />
          </div>
        </li>
      ))}
    </ol>
  );
}

const SIN = "Sin datos";

/** Ranking y comparación de clientes. SOLO llega con datos para Producción/Dirección; el resto recibe el motivo. */
export function DashboardClients({ block }: { block: DashboardClientsBlock }) {
  if (!block.available) {
    return (
      <section
        className="rounded-[var(--os-radius)] border border-dashed border-[var(--os-border)] bg-[var(--os-surface)]/60 p-4"
        data-testid="clients-not-available"
        aria-label="Clientes"
      >
        <h3 className="text-sm font-semibold text-[var(--os-text)]">Clientes</h3>
        <p className="mt-1 text-sm font-medium text-[var(--os-text)]">No disponible para tu sector</p>
        <p className="text-xs text-[var(--os-text-muted)]">{block.reason}</p>
      </section>
    );
  }
  const top = block.ranking.slice(0, 8);
  return (
    <div className="space-y-4" data-testid="clients-block">
      <div className="grid gap-4 lg:grid-cols-3">
        <DashboardKpiCard kpi={block.activeClients} caption="con al menos un pedido en el período" />
        <div className="lg:col-span-2">
          <Panel title="Top clientes por cantidad de pedidos" subtitle={`Fecha de pedido · ${block.periodLabel}`} testId="clients-ranking">
            <BarList rows={top} value={(r) => r.pedidos} label={(r) => `${fmtInt(r.pedidos)} pedidos`} empty="Sin datos suficientes: no hay pedidos con cliente en el período." color="#12bfb7" />
          </Panel>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Clientes con menor lead time" subtitle={`Fecha de entrega · ${block.periodLabel} · promedio de días entre pedido y entrega`} testId="clients-best-lead-time">
          <BarList
            rows={block.bestLeadTime.slice(0, 5)}
            value={(r) => r.leadTimeDays ?? 0}
            label={(r) => `${fmtDays(r.leadTimeDays ?? 0)} (n=${r.leadTimeSample})`}
            empty="Sin datos suficientes: no hay entregas del período vinculadas a un pedido con plazo válido."
            color="#a78bfa"
          />
        </Panel>
        <Panel title="Comparación entre clientes" subtitle="Pedidos por fecha de pedido · lead time por fecha de entrega · servicio y unidades por fecha de producción" testId="clients-comparison">
          {block.ranking.length === 0 ? (
            <p className="text-sm text-[var(--os-text-muted)]">Sin datos suficientes: no hay pedidos con cliente en el período.</p>
          ) : (
            <div role="table" aria-label="Comparación entre clientes" className="min-w-0 text-xs">
              <div role="row" className="hidden grid-cols-[minmax(0,2fr)_repeat(5,minmax(0,1fr))] gap-2 border-b border-[var(--os-border)] pb-1.5 font-semibold uppercase tracking-wide text-[var(--os-text-muted)] sm:grid">
                <span role="columnheader">Cliente</span>
                <span role="columnheader" className="text-right">Pedidos</span>
                <span role="columnheader" className="text-right">Entreg.</span>
                <span role="columnheader" className="text-right">Lead time</span>
                <span role="columnheader" className="text-right">Servicio</span>
                <span role="columnheader" className="text-right">Unidades</span>
              </div>
              <div className="max-h-72 overflow-y-auto">
                {block.ranking.map((r) => (
                  <div
                    role="row"
                    key={r.client}
                    className="grid grid-cols-2 gap-x-2 gap-y-0.5 border-b border-white/[0.06] py-2 sm:grid-cols-[minmax(0,2fr)_repeat(5,minmax(0,1fr))] sm:items-center"
                  >
                    <span role="cell" className="col-span-2 truncate font-medium text-[var(--os-text)] sm:col-span-1" title={r.client}>
                      {r.client}
                    </span>
                    <Cell label="Pedidos" value={fmtInt(r.pedidos)} />
                    <Cell label="Entregados" value={fmtInt(r.entregados)} />
                    <Cell label="Lead time" value={r.leadTimeDays == null ? SIN : fmtDays(r.leadTimeDays)} muted={r.leadTimeDays == null} />
                    <Cell label="Servicio" value={r.serviceLevel == null ? SIN : fmtPercent(r.serviceLevel)} muted={r.serviceLevel == null} />
                    <Cell label="Unidades" value={fmtInt(r.unidades)} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Cell({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <span role="cell" className={`flex justify-between gap-2 tabular-nums sm:block sm:text-right ${muted ? "text-[var(--os-text-muted)]" : "text-[var(--os-text)]"}`}>
      <span className="text-[var(--os-text-muted)] sm:hidden">{label}</span>
      <span>{value}</span>
    </span>
  );
}
