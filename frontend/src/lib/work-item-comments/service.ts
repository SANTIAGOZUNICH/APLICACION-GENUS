import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { workItemComments, workItems } from "@/lib/db/schema";
import { isFloorPlanSector, isWeeklyPlanViewerSector } from "@/lib/planning/weekly-plans-rbac";

export const MAX_COMMENT_LENGTH = 2000;
const MAX_LIST = 300;

export class CommentForbiddenError extends Error {}
export class CommentNotFoundError extends Error {}
export class CommentValidationError extends Error {}

export interface WorkItemCommentDto {
  id: string;
  workItemId: string;
  body: string;
  authorName: string;
  authorSector: string;
  authorSectorLabel: string;
  createdAt: string;
}

/** Identidad tomada de la sesión autenticada (nunca del cuerpo de la petición). */
export interface CommentActor {
  email: string;
  displayName?: string | null;
  sector: string;
  sectorLabel?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toDto(row: typeof workItemComments.$inferSelect): WorkItemCommentDto {
  return {
    id: row.id,
    workItemId: row.workItemId,
    body: row.body,
    authorName: row.authorName,
    authorSector: row.authorSector,
    authorSectorLabel: row.authorSectorLabel,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Los mismos sectores que consultan la Vista mensual; y solo trabajos de piso (los que esa vista muestra). */
async function assertCanAccess(actor: CommentActor, workItemId: string): Promise<void> {
  if (!isWeeklyPlanViewerSector(actor.sector)) throw new CommentForbiddenError("No tenés permiso para ver ni publicar comentarios de trabajos.");
  if (!UUID_RE.test(workItemId)) throw new CommentValidationError("Identificador de trabajo inválido.");
  const [item] = await getDb().select({ id: workItems.id, sector: workItems.sector }).from(workItems).where(eq(workItems.id, workItemId)).limit(1);
  if (!item) throw new CommentNotFoundError("El trabajo no existe o fue eliminado.");
  if (!isFloorPlanSector(item.sector)) throw new CommentForbiddenError("Este trabajo no admite comentarios desde la Vista mensual.");
}

/** Comentarios del trabajo, en orden cronológico (los más recientes al final). Solo lectura. */
export async function listWorkItemComments(actor: CommentActor, workItemId: string): Promise<WorkItemCommentDto[]> {
  await assertCanAccess(actor, workItemId);
  const rows = await getDb()
    .select()
    .from(workItemComments)
    .where(eq(workItemComments.workItemId, workItemId))
    .orderBy(asc(workItemComments.createdAt), asc(workItemComments.id))
    .limit(MAX_LIST);
  return rows.map(toDto);
}

/**
 * Publica un comentario. Solo escribe en work_item_comments: no toca el trabajo (fecha, cantidad, asignación, estado, observaciones).
 * Idempotente por (trabajo, autor, clientRequestId): un reintento o doble clic devuelve el mismo comentario sin duplicar.
 */
export async function postWorkItemComment(
  actor: CommentActor,
  input: { workItemId: string; body: unknown; clientRequestId: unknown }
): Promise<{ comment: WorkItemCommentDto; created: boolean }> {
  await assertCanAccess(actor, input.workItemId);
  const body = typeof input.body === "string" ? input.body.replace(/\r\n/g, "\n").trim() : "";
  if (!body) throw new CommentValidationError("Escribí un comentario antes de publicar.");
  if (body.length > MAX_COMMENT_LENGTH) throw new CommentValidationError(`El comentario supera los ${MAX_COMMENT_LENGTH} caracteres.`);
  const requestId = typeof input.clientRequestId === "string" ? input.clientRequestId.trim() : "";
  if (!requestId || requestId.length > 100) throw new CommentValidationError("Falta la clave de publicación.");

  const db = getDb();
  const inserted = await db
    .insert(workItemComments)
    .values({
      workItemId: input.workItemId,
      body,
      authorEmail: actor.email.toLowerCase(),
      authorName: actor.displayName?.trim() || actor.email.split("@")[0]!,
      authorSector: actor.sector,
      authorSectorLabel: actor.sectorLabel?.trim() || actor.sector,
      clientRequestId: requestId,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return { comment: toDto(inserted[0]), created: true };
  const [existing] = await db
    .select()
    .from(workItemComments)
    .where(and(eq(workItemComments.workItemId, input.workItemId), eq(workItemComments.authorEmail, actor.email.toLowerCase()), eq(workItemComments.clientRequestId, requestId)))
    .limit(1);
  if (!existing) throw new CommentValidationError("No se pudo publicar el comentario.");
  return { comment: toDto(existing), created: false };
}
