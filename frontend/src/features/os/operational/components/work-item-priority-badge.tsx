"use client";

import type { WorkItem } from "@/types/operational/work-item";
import { PriorityBadge } from "./semanas-priority-chip";

/** Prioridad compartida (asignada por Producción en Semanas): solo lectura en los sectores. Ausente = NORMAL. */
export function workItemPriorityText(item: Pick<WorkItem, "genusPriority">): string {
  return item.genusPriority?.priority ?? "NORMAL";
}

export function WorkItemPriorityBadge({ item }: { item: Pick<WorkItem, "genusPriority"> }) {
  const p = item.genusPriority;
  return (
    <span
      title={p ? `Asignada por ${p.updatedByName || "Producción"} · ${new Date(p.updatedAt).toLocaleString("es-AR")}` : "Prioridad NORMAL (sin prioridad especial asignada por Producción)"}
      data-testid="work-item-priority"
      data-priority={p?.priority ?? "NORMAL"}
    >
      <PriorityBadge priority={p?.priority ?? "NORMAL"} />
    </span>
  );
}
