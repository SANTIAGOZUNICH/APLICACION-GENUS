"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatJobDates } from "./monthly-job-card";
import type { WeeklyPlanItemDto } from "@/lib/planning/weekly-plan-dto";

const kg = (n: number | null | undefined) => (n == null ? "—" : `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(n)} kg`);

/**
 * Detalle de un trabajo de Elaboración para Materias Primas: SOLO LECTURA (sin campos editables ni acciones). Cantidades reales
 * (nunca se asume que se elaboró lo solicitado), entregas y estado salen del mismo plan que ve Elaboración.
 */
export function ElaboracionReadOnlyDetail({ job, onClose }: { job: WeeklyPlanItemDto | null; onClose: () => void }) {
  const f = job?.elaboracion ?? null;
  return (
    <Dialog open={job != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent data-testid="elab-readonly-detail">
        {job ? (
          <>
            <DialogHeader>
              <DialogTitle data-testid="elab-detail-product">{job.product}</DialogTitle>
              <DialogDescription>{job.client} · solo lectura</DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Estado actual</dt><dd className="font-semibold" data-testid="elab-detail-state">{f?.stateLabel ?? job.stateLabel}</dd></div>
              <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Fecha programada</dt><dd data-testid="elab-detail-date">{formatJobDates(job.plannedDate, job.plannedDateTo) || "Sin fecha"}</dd></div>
              <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Lote</dt><dd data-testid="elab-detail-lote">{job.lote ?? "—"}</dd></div>
              <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Responsable</dt><dd>{job.responsible ?? "—"}</dd></div>
              <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Kg solicitados</dt><dd className="tabular-nums" data-testid="elab-detail-requested">{f ? kg(f.requestedKg) : `${job.quantity} ${job.unit}`}</dd></div>
              <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Kg realmente elaborados</dt><dd className="tabular-nums" data-testid="elab-detail-elaborated">{f?.elaboratedKg != null ? kg(f.elaboratedKg) : "Todavía no registrados"}</dd></div>
              <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Kg entregados</dt><dd className="tabular-nums" data-testid="elab-detail-delivered">{kg(f?.deliveredKg)}</dd></div>
              <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Kg pendientes de entregar</dt><dd className="tabular-nums" data-testid="elab-detail-pending">{kg(f?.pendingKg)}</dd></div>
              {f?.lastDeliveryAt ? (
                <div className="col-span-2"><dt className="text-xs uppercase text-[var(--os-text-muted)]">Última entrega</dt><dd>{new Date(f.lastDeliveryAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}</dd></div>
              ) : null}
            </dl>
            <section className="mt-3 border-t border-[var(--os-border)] pt-3" aria-label="Observaciones del trabajo">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">Observaciones del trabajo</h4>
              <p className="mt-1 whitespace-pre-wrap text-sm" data-testid="elab-detail-notes">{job.notes?.trim() ? job.notes : "Sin observaciones"}</p>
            </section>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
