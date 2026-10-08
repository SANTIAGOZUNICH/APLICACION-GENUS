/**
 * Prioridades compartidas: agrega a las tareas de cada sector (WorkItem) la prioridad que Producción asignó en Semanas.
 * Solo lectura sobre la MISMA tabla de prioridades (no hay una segunda); nunca falla el pedido de tareas.
 */
import "server-only";

import type { WorkItem } from "@/types/operational/work-item";
import { linkWorkItemPriority } from "./priority-link";
import { getActiveSemanasSpreadsheetId } from "./semanas-sheet-service";
import { listPriorityRows } from "./semanas-priorities-service";

export async function attachGenusPriorities<T extends WorkItem>(items: T[]): Promise<T[]> {
  if (items.length === 0) return items;
  try {
    const sid = await getActiveSemanasSpreadsheetId();
    const rows = await listPriorityRows(sid);
    if (rows.length === 0) return items;
    return items.map((wi) => {
      const p = linkWorkItemPriority(
        { sector: wi.sector, plannedDate: wi.plannedDate, client: wi.client, product: wi.product, codificadoOriginSector: wi.codificadoOriginSector },
        rows
      );
      return p ? { ...wi, genusPriority: p } : wi;
    });
  } catch {
    return items; // sin prioridades antes que romper la lista de tareas
  }
}
