import type { WorkItem } from "@/types/operational/work-item";
import type { QualityItem } from "../types";

/**
 * Clave de correlación de un QualityItem hacia su WorkItem — algunos ids de
 * QualityItem vienen prefijados "qc:" (legado), otros ya coinciden 1:1 con
 * `relatedWorkItemId`. Centralizado acá para no repetir el mismo parseo en
 * cada pantalla que necesite cruzar ambos.
 */
export function qualityItemProgressKey(
  item: Pick<QualityItem, "id" | "relatedWorkItemId">
): string {
  return item.relatedWorkItemId ?? (item.id.startsWith("qc:") ? item.id.slice(3) : item.id);
}

/**
 * Resuelve el WorkItem canónico detrás de un QualityItem — mismo criterio
 * en toda pantalla que muestre ambos (Expedición, Calidad, Producción):
 * necesario porque el dato más fresco (lote/VTO recién completados por otro
 * sector) vive en el WorkItem, no siempre en la proyección QualityItem.
 */
export function resolveWorkItemForQualityItem(
  workItems: WorkItem[],
  item: Pick<QualityItem, "id" | "relatedWorkItemId">
): WorkItem | null {
  const key = qualityItemProgressKey(item);
  return workItems.find((w) => w.id === item.relatedWorkItemId || w.id === key) ?? null;
}
