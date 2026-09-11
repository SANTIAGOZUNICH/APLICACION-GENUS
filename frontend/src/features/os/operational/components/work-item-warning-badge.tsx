"use client";

import { useState } from "react";
import type { WorkItem } from "@/types/operational/work-item";
import {
  getPrimaryWorkItemWarningLabel,
  getWorkItemWarnings,
  type WorkItemWarningField,
} from "@/lib/planning/work-item-warnings";

interface WorkItemWarningBadgeProps {
  item: WorkItem;
  /**
   * Al tocar el warning (o un ítem del detalle) — el caller decide qué
   * significa "abrir el campo faltante" en su pantalla (abrir el drawer,
   * hacer scroll al bloque de packing, enfocar un input, etc).
   */
  onSelectField?: (field: WorkItemWarningField) => void;
  className?: string;
}

/**
 * Advertencia NO BLOQUEANTE por datos operativos faltantes — roja, corta,
 * sin modal. Nunca deshabilita nada: es puramente informativa. Reusar este
 * componente en toda pantalla que muestre un WorkItem (tarjeta, drawer,
 * diálogos de envío, Calidad/Producción/Expedición) en vez de armar un
 * cartel propio — así el criterio de "qué falta" es siempre el mismo
 * (getWorkItemWarnings).
 */
export function WorkItemWarningBadge({ item, onSelectField, className }: WorkItemWarningBadgeProps) {
  const [expanded, setExpanded] = useState(false);
  const warnings = getWorkItemWarnings(item);
  if (warnings.length === 0) return null;

  const primaryLabel = getPrimaryWorkItemWarningLabel(warnings);

  return (
    <div className={`relative inline-block ${className ?? ""}`} data-testid="work-item-warning">
      <button
        type="button"
        data-testid="work-item-warning-badge"
        onClick={() => {
          if (warnings.length === 1) {
            onSelectField?.(warnings[0].field);
            return;
          }
          setExpanded((v) => !v);
        }}
        className="inline-flex items-center gap-1 rounded-full bg-[var(--genus-error-soft)] px-2.5 py-0.5 text-xs font-semibold text-[var(--genus-error)]"
      >
        <span aria-hidden="true">🔴</span>
        {primaryLabel}
      </button>

      {expanded ? (
        <div
          data-testid="work-item-warning-detail"
          className="absolute z-10 mt-1 min-w-max rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] p-1.5 shadow-[var(--os-shadow-sm)]"
        >
          {warnings.map((w) => (
            <button
              key={w.code}
              type="button"
              data-testid={`work-item-warning-item-${w.code}`}
              onClick={() => {
                setExpanded(false);
                onSelectField?.(w.field);
              }}
              className="flex w-full items-center gap-1.5 whitespace-nowrap rounded-[var(--os-radius-sm)] px-2 py-1 text-left text-xs font-medium text-[var(--genus-error)] hover:bg-[var(--genus-error-soft)]"
            >
              <span aria-hidden="true">🔴</span>
              {w.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
