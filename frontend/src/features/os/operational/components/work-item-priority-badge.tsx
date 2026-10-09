"use client";

/**
 * Etiqueta de prioridad de Semanas en «Mi trabajo» (solo lectura): la MISMA que fijó Producción en Semanas, y solo en
 * trabajos vinculados explícitamente a esa tarea. Sin vínculo no se muestra nada.
 */
import { useWorkItemSemanasPriority } from "../hooks/use-work-item-priorities";
import { PriorityTag } from "./plan-task-card";

export function WorkItemPriorityBadge({ itemId, className = "" }: { itemId: string; className?: string }) {
  const p = useWorkItemSemanasPriority(itemId);
  if (!p) return null;
  const who = p.priorityInfo ? ` · ${p.priorityInfo.updatedByName || p.priorityInfo.updatedBy}, ${new Date(p.priorityInfo.updatedAt).toLocaleString("es-AR")}` : "";
  return (
    <span
      className={`inline-flex ${className}`}
      title={`Prioridad asignada por Producción en Semanas${who}. Tarea: ${p.taskProducts.join(" / ")}${p.taskClient ? ` (${p.taskClient})` : ""}.`}
      data-testid="work-item-priority"
      data-priority={p.priority}
    >
      <PriorityTag priority={p.priority} />
    </span>
  );
}
