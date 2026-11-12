import "server-only";

import { asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { workItemMeHistory, workItems } from "@/lib/db/schema";
import { buildMeInfo, canSetMeStatus, ME_MAX_OBSERVATION, meAppliesToSector, meStatusFromDb, meStatusToDb, type MeInfo, type MeStatus } from "@/lib/me-status/me-status";
import { PlanningForbiddenError, PlanningNotFoundError, PlanningValidationError, type PlanningActor } from "@/lib/planning/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const norm = (id: string) => String(id ?? "").trim().replace(/^native:/, "");

export interface SetMeResult {
  workItemId: string;
  me: MeInfo;
  /** false = no cambió nada (mismo estado y observación): no se agrega historial. */
  changed: boolean;
}

/**
 * Cambia el estado de ME de UN trabajo de Envasado (Depósito / Dirección). En una transacción con el trabajo bloqueado: registra quién, cuándo,
 * el estado anterior y la observación. NO toca stock ni inventario y NO sube la versión del trabajo (no choca con ediciones de planificación).
 */
export async function setWorkItemMeStatus(actor: PlanningActor, workItemId: string, input: { status: MeStatus; observation?: string | null }): Promise<SetMeResult> {
  if (!canSetMeStatus(actor.sector)) throw new PlanningForbiddenError("Solo Depósito puede cambiar el estado del Material de Envase (ME).");
  const id = norm(workItemId);
  if (!UUID.test(id)) throw new PlanningValidationError("Trabajo inválido.");
  const observation = input.observation == null ? null : String(input.observation).trim() || null;
  if (observation && observation.length > ME_MAX_OBSERVATION) throw new PlanningValidationError(`La observación supera los ${ME_MAX_OBSERVATION} caracteres.`);
  return getDb().transaction(async (tx) => {
    const [row] = await tx.select().from(workItems).where(eq(workItems.id, id)).for("update").limit(1);
    if (!row || row.deletedAt) throw new PlanningNotFoundError("Trabajo no encontrado.");
    if (!meAppliesToSector(row.sector)) throw new PlanningValidationError("El control de ME aplica solo a trabajos de Envasado Masivo y Premium.");
    const before = meStatusFromDb(row.meStatus);
    const sameObs = (row.meObservation?.trim() || null) === observation;
    if (before === input.status && sameObs) return { workItemId: id, me: buildMeInfo(row), changed: false };
    const now = new Date();
    const actorName = actor.displayName || actor.email;
    const [updated] = await tx
      .update(workItems)
      .set({ meStatus: meStatusToDb(input.status), meObservation: observation, meUpdatedBy: actorName, meUpdatedAt: now })
      .where(eq(workItems.id, id))
      .returning();
    await tx.insert(workItemMeHistory).values({ workItemId: id, fromStatus: row.meStatus ?? null, toStatus: meStatusToDb(input.status), observation, actorEmail: actor.email, actorName, actorSector: String(actor.sector) });
    return { workItemId: id, me: buildMeInfo(updated ?? row), changed: true };
  });
}

export async function listMeHistory(workItemId: string) {
  const id = norm(workItemId);
  if (!UUID.test(id)) throw new PlanningValidationError("Trabajo inválido.");
  const rows = await getDb().select().from(workItemMeHistory).where(eq(workItemMeHistory.workItemId, id)).orderBy(asc(workItemMeHistory.createdAt));
  return rows.map((r) => ({ at: r.createdAt.toISOString(), from: meStatusFromDb(r.fromStatus), to: meStatusFromDb(r.toStatus), observation: r.observation, actorName: r.actorName ?? r.actorEmail, actorSector: r.actorSector }));
}
