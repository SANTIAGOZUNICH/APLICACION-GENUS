/**
 * RBAC de avance operativo (save_progress / complete_work) — el sector
 * actor debe coincidir con el sector ACTUAL del work item (columna
 * work_items.sector, la fuente de verdad de "quién lo tiene ahora" — se
 * actualiza tanto en asignación directa como en el handoff Envasado→
 * Codificado), o ser PRODUCCION/DIRECCION (supervisión, mismo criterio ya
 * usado en deliverFromCodificadoDurable y assignWorkItemDurable).
 *
 * Antes de este chequeo, guardar avance no validaba el sector del actor en
 * absoluto server-side — solo el front-end mostraba/ocultaba controles. Un
 * request directo a la API con cualquier sector autenticado podía modificar
 * cualquier work item con solo conocer su id.
 */
import type { SectorId } from "@/types/operational/sector";

export const WORK_PROGRESS_DENIED_MESSAGE =
  "No tenés permiso para modificar este trabajo — no está asignado a tu sector.";

export function canActOnWorkItemSector(
  actorSector: SectorId | string | null | undefined,
  itemSector: SectorId | string | null | undefined
): boolean {
  if (!actorSector || !itemSector) return false;
  if (actorSector === "PRODUCCION" || actorSector === "DIRECCION") return true;
  return actorSector === itemSector;
}
