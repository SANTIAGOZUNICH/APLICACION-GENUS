"use client";

import {
  DELIVERY_URGENCY_LABELS,
  formatDateDisplay,
  resolveDeliveryUrgency,
  type DeliveryUrgency,
} from "../lib/delivery-date";

const STYLES: Record<DeliveryUrgency, string> = {
  vencido: "bg-rose-100 text-rose-800 border-rose-200",
  hoy: "bg-amber-100 text-amber-900 border-amber-200",
  proximo: "bg-[var(--os-teal-soft)] text-[var(--os-navy,#123b5d)] border-[var(--os-teal)]/40",
  ok: "bg-[var(--os-bg)] text-[var(--os-text)] border-[var(--os-border)]",
  sin_fecha: "bg-[var(--os-bg)] text-[var(--os-text-muted)] border-[var(--os-border)]",
};

interface DeliveryDateBadgeProps {
  deliveryDate: string | null | undefined;
  className?: string;
}

/** Chip de fecha de entrega con urgencia visual. */
export function DeliveryDateBadge({ deliveryDate, className = "" }: DeliveryDateBadgeProps) {
  const urgency = resolveDeliveryUrgency(deliveryDate);
  return (
    <span
      className={`inline-flex flex-col gap-0.5 rounded-[var(--os-radius-sm)] border px-2 py-1 text-xs ${STYLES[urgency]} ${className}`}
      title={DELIVERY_URGENCY_LABELS[urgency]}
    >
      <span className="font-medium tabular-nums">{formatDateDisplay(deliveryDate)}</span>
      {urgency !== "ok" && urgency !== "sin_fecha" && (
        <span className="text-[10px] font-semibold uppercase tracking-wide">
          {DELIVERY_URGENCY_LABELS[urgency]}
        </span>
      )}
    </span>
  );
}
