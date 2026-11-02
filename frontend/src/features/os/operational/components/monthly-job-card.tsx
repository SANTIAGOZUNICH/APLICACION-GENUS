"use client";

import type { WeeklyPlanItemDto } from "@/lib/planning/weekly-plan-dto";

const UNIT_NAMES: Record<string, string> = { "un.": "unidades", un: "unidades", u: "unidades", unid: "unidades", unidades: "unidades" };

const fmtDate = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso);

/** Cantidad con miles en es-AR y unidad legible («2.000 unidades», «500 kg»). */
export function formatJobQuantity(quantity: string, unit: string): string {
  const n = Number(String(quantity ?? "").replace(/\./g, "").replace(",", "."));
  const num = Number.isFinite(n) && String(quantity ?? "").trim() !== "" ? new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(n) : String(quantity ?? "").trim();
  const u = String(unit ?? "").trim();
  const name = UNIT_NAMES[u.toLowerCase()] ?? u;
  return [num, name].filter(Boolean).join(" ");
}

/** Fecha programada: un día, o el rango si el trabajo ocupa varios. */
export function formatJobDates(from: string, to: string): string {
  if (!from) return "";
  return !to || to === from ? fmtDate(from) : `${fmtDate(from)} al ${fmtDate(to)}`;
}

/**
 * Tarjeta flotante de un trabajo en la Vista mensual: SOLO información (sin botones de asignar, editar, eliminar ni reprogramar).
 * Principal: cliente, producto y cantidad. Secundario: fecha, sector, estado y lote (solo si está asignado). Sin campos vacíos.
 */
export function MonthlyJobCard({ job }: { job: WeeklyPlanItemDto }) {
  const secondary: Array<[string, string, string]> = [
    ["Fecha", formatJobDates(job.plannedDate, job.plannedDateTo), "date"],
    ["Sector", job.sectorLabel, "sector"],
    ["Estado", job.stateLabel, "state"],
    ["Lote", job.lote ?? "", "lote"],
  ];
  return (
    <div className="space-y-3 pr-6" data-testid="job-card" data-job-id={job.workItemId}>
      <dl className="space-y-2">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">Cliente</dt>
          <dd className="text-base font-semibold leading-snug" data-testid="job-card-client">{job.client}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">Producto</dt>
          <dd className="text-base font-semibold leading-snug" data-testid="job-card-product">{job.product}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">Cantidad</dt>
          <dd className="text-base font-semibold leading-snug tabular-nums" data-testid="job-card-quantity">{formatJobQuantity(job.quantity, job.unit)}</dd>
        </div>
      </dl>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-[var(--os-border)] pt-2 text-sm">
        {secondary
          .filter(([, v]) => v.trim() !== "")
          .map(([label, value, key]) => (
            <div key={key} className="contents">
              <dt className="text-[var(--os-text-muted)]">{label}</dt>
              <dd data-testid={`job-card-${key}`}>{value}</dd>
            </div>
          ))}
      </dl>
    </div>
  );
}
