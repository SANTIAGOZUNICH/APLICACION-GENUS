"use client";

import type { WorkItem, WorkItemStatus } from "@/types/operational/work-item";
import { resolveWorkItemStatusDisplay } from "@/design-system/work-item-status";
import {
  formatWorkItemDelivery,
  formatWorkItemPresentation,
} from "@/design-preview/lib/work-items-day-view";

interface LineWorkCardProps {
  lineId: string;
  work: WorkItem | null;
  today: Date;
  status?: WorkItemStatus;
  isCompleting?: boolean;
  onOpenWork?: (workItemId: string) => void;
  onOpenOa?: (oaRef: string, workItemId: string) => void;
  onMarkDone?: (work: WorkItem) => void;
}

/** Card por línea — interactiva en Digital Twin F9.6. */
export function LineWorkCard({
  lineId,
  work,
  today,
  status: statusOverride,
  isCompleting = false,
  onOpenWork,
  onOpenOa,
  onMarkDone,
}: LineWorkCardProps) {
  if (!work) {
    return (
      <article className="flex min-h-[12rem] flex-col justify-center rounded-[var(--os-radius)] border border-dashed border-[var(--os-border)] bg-[var(--os-surface-muted)] px-8 py-10">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--os-text-muted)]">
          {lineId}
        </p>
        <p className="mt-4 text-base text-[var(--os-text-muted)]">
          Sin trabajo asignado para hoy
        </p>
      </article>
    );
  }

  const statusKey = statusOverride ?? work.status;
  const status = resolveWorkItemStatusDisplay(statusKey);
  const delivery = formatWorkItemDelivery(work, today);
  const deliveryHighlight = delivery === "Hoy" || delivery === "Urgente";

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => onOpenWork?.(work.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenWork?.(work.id);
        }
      }}
      className={`rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] px-8 py-8 shadow-[var(--os-shadow-card)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--os-shadow-card-hover)] ${
        isCompleting ? "os-pulse-success border-emerald-300" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--os-teal)]">
          {lineId}
        </p>
        <span className="inline-flex items-center gap-2 text-xs font-medium text-[var(--os-text-muted)]">
          <span className={`size-2 rounded-full ${status.dotClassName} transition-transform ${isCompleting ? "scale-125" : ""}`} aria-hidden="true" />
          {isCompleting ? "Guardando…" : status.label}
        </span>
      </div>

      <h3 className="mt-5 text-2xl font-semibold tracking-tight text-[var(--os-text)]">
        {work.client ?? "—"}
      </h3>
      <p className="mt-1.5 text-lg font-medium text-[var(--os-text)]">{work.product ?? "—"}</p>
      <p className="mt-4 text-2xl font-light tabular-nums tracking-tight text-[var(--os-text)]">
        {formatWorkItemPresentation(work)}
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <div>
          <span className="text-[var(--os-text-muted)]">Entrega · </span>
          <span
            className={`font-semibold ${deliveryHighlight ? "text-amber-700" : "text-[var(--os-text)]"}`}
          >
            {delivery}
          </span>
        </div>
        {work.oaRef && (
          <div>
            <span className="text-[var(--os-text-muted)]">OA · </span>
            <span className="font-mono font-medium text-[var(--os-teal)]">{work.oaRef}</span>
          </div>
        )}
        {work.confidence === "low" && (
          <div className="text-xs text-amber-700">Confianza baja — verificar en SEMANAS</div>
        )}
      </div>

      <div
        className="mt-8 flex flex-wrap items-center gap-3 border-t border-[var(--os-border-subtle)] pt-6"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() =>
            work.oaRef
              ? onOpenOa?.(work.oaRef, work.id)
              : onOpenOa?.("OA-NUEVA", work.id)
          }
          className="rounded-[var(--os-radius-sm)] bg-[var(--os-teal)] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
        >
          {work.oaRef ? "Abrir OA" : "Crear OA"}
        </button>
        {statusKey !== "completo" && statusKey !== "bloqueado" && (
          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-[var(--os-text)]">
            <input
              type="checkbox"
              checked={isCompleting}
              onChange={() => onMarkDone?.(work)}
              className="size-4 rounded border-[var(--os-border)] accent-[var(--os-teal)]"
            />
            Trabajo terminado
          </label>
        )}
        <button
          type="button"
          className="text-sm font-medium text-[var(--os-text-muted)] transition-colors hover:text-[var(--os-teal)]"
        >
          Reportar problema
        </button>
      </div>
    </article>
  );
}
