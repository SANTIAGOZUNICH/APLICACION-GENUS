import "server-only";

import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  featureAuditEvents,
  operationalEvents,
  remitoLines,
  remitoWorkLinks,
  workItemDeliveries,
  workItems,
} from "@/lib/db/schema";
import { PlanningValidationError } from "@/lib/planning/types";
import { nativeIdFromItemId } from "@/lib/planning/work-item-progress-repository";
import {
  BULK_DELETE_MAX_ITEMS,
  BULK_DELETE_VERDICT_REASON,
  classifyBulkDelete,
  type BulkDeleteResult,
  type BulkDeleteVerdict,
} from "@/features/os/operational/lib/bulk-delete-verdicts";

export interface BulkDeleteWorksInput {
  /** IDs tal cual los usa la UI (`native:<uuid>`). */
  ids: string[];
  reason: string;
  actorEmail: string;
  /** true = solo evalúa y devuelve veredictos, sin escribir nada. */
  dryRun?: boolean;
  /** Clave de idempotencia de la operación (un reintento devuelve el mismo resultado). */
  batchKey?: string;
  /** Versión esperada por id (control optimista, igual que el borrado individual). */
  expectedVersions?: Record<string, number>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Borrado masivo de trabajos por Producción. Reutiliza EXACTAMENTE la regla del borrado individual
 * (deleteWorkItemDurable): soft delete con deletedAt/deletedBy/deleteReason, version+1 y un evento
 * WORK_ITEM_DELETED_BY_PRODUCCION por trabajo — nunca DELETE físico, sin cascada (work_item_deliveries
 * tiene FK ON DELETE CASCADE, por eso JAMÁS se borra la fila). Además protege el historial: no elimina
 * trabajos entregados, con entregas registradas o incluidos en un remito, y no toca stock ni consumos de MP.
 *
 * Todo ocurre en UNA transacción con las filas bloqueadas (FOR UPDATE) y un candado por batchKey: o se
 * aplican todas las elegibles y la auditoría, o nada. Los bloqueados quedan intactos y se informan.
 */
export async function bulkDeleteWorkItemsDurable(input: BulkDeleteWorksInput): Promise<BulkDeleteResult> {
  const reason = input.reason?.trim() ?? "";
  const dryRun = Boolean(input.dryRun);
  if (!dryRun && !reason) {
    throw new PlanningValidationError("El motivo es obligatorio para eliminar trabajos.");
  }
  const uniqueIds = [...new Set(input.ids.map((id) => String(id)))];
  if (uniqueIds.length === 0) {
    throw new PlanningValidationError("No hay trabajos seleccionados.");
  }
  if (uniqueIds.length > BULK_DELETE_MAX_ITEMS) {
    throw new PlanningValidationError(`Se pueden eliminar hasta ${BULK_DELETE_MAX_ITEMS} trabajos por operación.`);
  }
  const batchKey = input.batchKey?.trim() || null;

  const parsed = uniqueIds.map((id) => {
    const native = nativeIdFromItemId(id);
    return { id, native: native && UUID_RE.test(native) ? native : null };
  });

  const db = getDb();
  return db.transaction(async (tx): Promise<BulkDeleteResult> => {
    if (!dryRun && batchKey) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`genus-bulk-delete-works:${batchKey}`}))`);
      const [prior] = await tx
        .select({ payload: featureAuditEvents.payload })
        .from(featureAuditEvents)
        .where(
          and(
            eq(featureAuditEvents.domain, "work_items"),
            eq(featureAuditEvents.action, "BULK_DELETE"),
            eq(featureAuditEvents.idempotencyKey, batchKey)
          )
        )
        .limit(1);
      const result = (prior?.payload as { result?: BulkDeleteResult } | undefined)?.result;
      if (result) return { ...result, replayed: true };
    }

    const nativeIds = parsed.flatMap((p) => (p.native ? [p.native] : []));
    const base = tx
      .select({
        id: workItems.id,
        deletedAt: workItems.deletedAt,
        operationalStatus: workItems.operationalStatus,
        version: workItems.version,
        sector: workItems.sector,
        product: workItems.product,
        client: workItems.client,
        planningWeekId: workItems.planningWeekId,
      })
      .from(workItems)
      .where(inArray(workItems.id, nativeIds.length ? nativeIds : ["00000000-0000-0000-0000-000000000000"]));
    const rows = dryRun ? await base : await base.for("update");
    const byId = new Map(rows.map((r) => [r.id, r]));

    const deliveryCounts = new Map<string, number>();
    const remitoCounts = new Map<string, number>();
    if (rows.length > 0) {
      const found = rows.map((r) => r.id);
      const deliveries = await tx
        .select({ workItemId: workItemDeliveries.workItemId, n: sql<number>`count(*)::int` })
        .from(workItemDeliveries)
        .where(
          and(
            inArray(workItemDeliveries.workItemId, found),
            isNull(workItemDeliveries.deletedAt),
            isNull(workItemDeliveries.annulledAt)
          )
        )
        .groupBy(workItemDeliveries.workItemId);
      for (const d of deliveries) deliveryCounts.set(d.workItemId, d.n);

      const candidates = found.flatMap((id) => [id, `native:${id}`]);
      const lines = await tx
        .select({ workItemId: remitoLines.workItemId })
        .from(remitoLines)
        .where(inArray(remitoLines.workItemId, candidates));
      const links = await tx
        .select({ workItemId: remitoWorkLinks.workItemId })
        .from(remitoWorkLinks)
        .where(inArray(remitoWorkLinks.workItemId, candidates));
      for (const l of [...lines, ...links]) {
        const key = l.workItemId.replace(/^native:/, "");
        remitoCounts.set(key, (remitoCounts.get(key) ?? 0) + 1);
      }
    }

    const verdicts: BulkDeleteVerdict[] = [];
    const eligible: typeof rows = [];
    for (const p of parsed) {
      if (!p.native) {
        verdicts.push({ id: p.id, code: "INVALID_ID", reason: BULK_DELETE_VERDICT_REASON.INVALID_ID });
        continue;
      }
      const row = byId.get(p.native);
      if (!row) {
        verdicts.push({ id: p.id, code: "NOT_FOUND", reason: BULK_DELETE_VERDICT_REASON.NOT_FOUND });
        continue;
      }
      const code = classifyBulkDelete(
        {
          deletedAt: row.deletedAt,
          operationalStatus: row.operationalStatus,
          version: row.version,
          activeDeliveries: deliveryCounts.get(row.id) ?? 0,
          remitoLinks: remitoCounts.get(row.id) ?? 0,
        },
        input.expectedVersions?.[p.id]
      );
      verdicts.push({
        id: p.id,
        code,
        reason: code === "ELIGIBLE" ? "" : BULK_DELETE_VERDICT_REASON[code],
        product: row.product,
        client: row.client,
      });
      if (code === "ELIGIBLE") eligible.push(row);
    }

    if (dryRun) {
      return { dryRun: true, batchKey, requested: uniqueIds.length, deleted: [], verdicts };
    }

    const now = new Date();
    const deleted: string[] = [];
    for (const row of eligible) {
      const updated = await tx
        .update(workItems)
        .set({
          deletedAt: now,
          deletedBy: input.actorEmail,
          deleteReason: reason,
          updatedAt: now,
          version: row.version + 1,
        })
        .where(and(eq(workItems.id, row.id), isNull(workItems.deletedAt), ne(workItems.operationalStatus, "entregado")))
        .returning({ id: workItems.id });
      if (updated.length === 0) throw new Error("No se pudo eliminar un trabajo seleccionado; no se aplicó ningún cambio.");
      await tx.insert(operationalEvents).values({
        workItemId: row.id,
        planningWeekId: row.planningWeekId,
        type: "WORK_ITEM_DELETED_BY_PRODUCCION",
        fromStatus: row.operationalStatus,
        toStatus: row.operationalStatus,
        actorEmail: input.actorEmail,
        actorSector: "PRODUCCION",
        note: `sector=${row.sector} · producto=${row.product} · cliente=${row.client} · motivo=${reason} · eliminación masiva${batchKey ? ` (${batchKey})` : ""}`,
      });
      deleted.push(`native:${row.id}`);
    }

    const result: BulkDeleteResult = {
      dryRun: false,
      batchKey,
      requested: uniqueIds.length,
      deleted,
      verdicts,
    };
    await tx.insert(featureAuditEvents).values({
      domain: "work_items",
      action: "BULK_DELETE",
      actorEmail: input.actorEmail,
      actorSector: "PRODUCCION",
      entityId: null,
      idempotencyKey: batchKey,
      payload: { reason, requested: uniqueIds.length, deletedCount: deleted.length, deleted, result },
    });
    return result;
  });
}
