"use client";

import { ME_LABEL, ME_LONG_LABEL, type MeInfo } from "@/lib/me-status/me-status";

const TONE = {
  SIN_INFO: "bg-white/10 text-[#cfe0ea]",
  OK: "bg-emerald-400/20 text-emerald-100",
  NO_OK: "bg-rose-400/25 text-rose-100",
} as const;

/**
 * «ME: Sin info» / «ME: ✅» / «ME: ❌» — Material de Envase verificado por Depósito. Compacto, una sola línea; el título (tooltip y lector de
 * pantalla) explica el estado y trae la observación de Depósito. Con `showObservation` la observación se ve debajo (detalles).
 * Solo se dibuja para trabajos de Envasado (`me` viene null en el resto).
 */
export function MeBadge({ me, showObservation = false, className = "" }: { me: MeInfo | null | undefined; showObservation?: boolean; className?: string }) {
  if (!me) return null;
  const title = `${ME_LONG_LABEL[me.status]}${me.observation ? ` — ${me.observation}` : ""}${me.updatedBy ? ` (${me.updatedBy})` : ""}`;
  return (
    <span className={`inline-flex max-w-full flex-col ${className}`} data-testid="me-badge" data-me-status={me.status}>
      <span className={`inline-flex w-fit items-center gap-1 rounded px-1.5 py-px text-[11px] font-bold leading-tight ${TONE[me.status]}`} title={title} aria-label={title}>
        ME: {ME_LABEL[me.status]}
      </span>
      {showObservation && me.observation ? <span className="mt-0.5 whitespace-pre-wrap text-[12px] font-normal text-[#cfe0ea]" data-testid="me-observation">{me.observation}</span> : null}
    </span>
  );
}
