"use client";

import type { WeeklyPlanItemDto } from "@/lib/planning/weekly-plan-dto";
import { JobComments } from "./job-comments";
import { MeBadge } from "./me-badge";

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
 * Contenido de la tarjeta flotante de un trabajo en la Vista mensual: información (sin acciones de asignar, editar, eliminar ni
 * reprogramar), las observaciones originales del trabajo (solo lectura) y los comentarios del equipo (único dato que se puede agregar). Título = producto; luego Cliente y Cantidad; debajo, en menor jerarquía: fecha, sector, estado y lote (si existe).
 * Sin campos vacíos. El fondo opaco y el borde los pone el contenedor (`.os-floating-card`).
 */
export function MonthlyJobCard({ job }: { job: WeeklyPlanItemDto }) {
  const secondary: Array<[string, string, string]> = [
    ["Fecha", formatJobDates(job.plannedDate, job.plannedDateTo), "date"],
    ["Sector", job.sectorLabel, "sector"],
    ["Estado", job.stateLabel, "state"],
    ["Lote", job.lote ?? "", "lote"],
  ];
  return (
    <div data-testid="job-card" data-job-id={job.workItemId}>
      <h3 className="pr-8 text-lg font-bold leading-snug text-[#eaf3f6]" data-testid="job-card-product">{job.product}</h3>
      <dl className="mt-3 space-y-1.5 text-[15px]">
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-[#9fb4c0]">Cliente:</dt>
          <dd className="font-semibold text-[#eaf3f6]" data-testid="job-card-client">{job.client}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-[#9fb4c0]">Cantidad:</dt>
          <dd className="font-semibold tabular-nums text-[#eaf3f6]" data-testid="job-card-quantity">{formatJobQuantity(job.quantity, job.unit)}</dd>
        </div>
      </dl>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-white/15 pt-3 text-[13px]">
        {secondary
          .filter(([, v]) => v.trim() !== "")
          .map(([label, value, key]) => (
            <div key={key} className="contents">
              <dt className="text-[#9fb4c0]">{label}</dt>
              <dd className="text-[#d6e4ea]" data-testid={`job-card-${key}`}>{value}</dd>
            </div>
          ))}
      </dl>
      {job.me ? (
        <section className="mt-3 border-t border-white/15 pt-3" aria-label="Material de Envase" data-testid="job-card-me">
          <h4 className="text-[13px] font-semibold uppercase tracking-wide text-[#9fb4c0]">Material de Envase (Depósito)</h4>
          <div className="mt-1"><MeBadge me={job.me} showObservation /></div>
          {job.me.updatedBy ? <p className="mt-0.5 text-[11px] text-[#9fb4c0]">Verificó {job.me.updatedBy}{job.me.updatedAt ? ` · ${new Date(job.me.updatedAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}` : ""}</p> : null}
        </section>
      ) : null}
      <section className="mt-3 border-t border-white/15 pt-3" aria-label="Observaciones del trabajo" data-testid="job-card-observations">
        <h4 className="text-[13px] font-semibold uppercase tracking-wide text-[#9fb4c0]">Observaciones del trabajo</h4>
        {job.notes?.trim() ? (
          <p className="mt-1 whitespace-pre-wrap text-[14px] text-[#eaf3f6]" data-testid="job-card-observations-text">{job.notes}</p>
        ) : (
          <p className="mt-1 text-[13px] text-[#9fb4c0]" data-testid="job-card-observations-empty">Sin observaciones</p>
        )}
      </section>
      <JobComments workItemId={job.workItemId} />
    </div>
  );
}
