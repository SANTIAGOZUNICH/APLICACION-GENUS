/**
 * Vínculo persistente Asignación de Lotes ↔ trabajo (Elaboración/Envasado) ↔ OE ↔ OA.
 *
 * La fuente única del lote de producto terminado es Asignación de Lotes. El vínculo vive en
 * `work_items.asignacion_lote_id` (migración 0067), no en coincidencia de texto: una vez vinculado,
 * un cambio del lote en Asignación se propaga por id a los trabajos vinculados y a sus OE/OA.
 *
 * Reglas (todas conservadoras, nunca pisan en silencio):
 *  - Trabajo vinculado + OE/OA sin cerrar  => se actualiza lote/VTO (trabajo y orden) con evento LOTE_SYNCED.
 *  - Trabajo cerrado/terminado o OE/OA COMPLETA/ANULADA/ARCHIVADA => NO se toca; se registra LOTE_SYNC_CONFLICT
 *    para que Producción haga una corrección auditada (updateWorkItemLoteVtoDurable, exige motivo).
 *  - Reconciliación de trabajos existentes sin vínculo: solo si hay UNA coincidencia inequívoca
 *    (resolveAsignacionLoteForWorkItem === found); ambiguos o sin coincidencia quedan pendientes.
 *  - Nunca se borra ni se reescribe historial; todo cambio deja un operational_event.
 */
import "server-only";

import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { asignacionLotes, operationalEvents, operationalOrders, orderAuditEvents, workItems } from "@/lib/db/schema";
import { resolveAsignacionLoteForWorkItem } from "./resolve-for-work-item";
import type { AsignacionLote } from "./types";

const OPEN_ORDER_STATUSES = new Set(["BORRADOR", "PENDIENTE", "EN_PROCESO", "DEVUELTA_PARA_CORRECCION"]);
const CLOSED_WORK_STATUSES = new Set(["TERMINADO_SECTOR", "PENDIENTE_CALIDAD", "APROBADO_CALIDAD", "LIBERADO", "CANCELADO"]);

export interface LoteSyncResult {
  synced: string[];
  conflicts: Array<{ workItemId: string; reason: string }>;
  unchanged: string[];
}

type LoteRecord = Pick<AsignacionLote, "id" | "lote" | "vto"> & { updatedBy?: string | null; archived?: boolean };

/** Propaga el lote/VTO de una fila de Asignación a todos los trabajos vinculados por id. */
export async function syncLinkedWorkItemsForLote(record: LoteRecord, actorSector = "SYSTEM"): Promise<LoteSyncResult> {
  const result: LoteSyncResult = { synced: [], conflicts: [], unchanged: [] };
  const lote = record.lote?.trim() || null;
  const vto = record.vto?.trim() || null;
  if (!lote || record.archived) return result;
  const actor = record.updatedBy?.trim() || "asignacion-lotes-sync";
  const db = getDb();

  const linked = await db
    .select({
      id: workItems.id,
      status: workItems.status,
      planningWeekId: workItems.planningWeekId,
      packagingLote: workItems.packagingLote,
      packagingVto: workItems.packagingVto,
      orderId: workItems.orderId,
    })
    .from(workItems)
    .where(and(eq(workItems.asignacionLoteId, record.id), isNull(workItems.deletedAt)));

  for (const wi of linked) {
    const sameLote = (wi.packagingLote ?? null) === lote;
    const sameVto = vto == null || (wi.packagingVto ?? null) === vto;
    if (sameLote && sameVto) {
      result.unchanged.push(wi.id);
      continue;
    }
    const nextVto = vto ?? wi.packagingVto ?? null;

    let order: { id: string; status: string; formData: unknown } | null = null;
    if (wi.orderId) {
      const [o] = await db
        .select({ id: operationalOrders.id, status: operationalOrders.status, formData: operationalOrders.formData })
        .from(operationalOrders)
        .where(eq(operationalOrders.id, wi.orderId))
        .limit(1);
      order = o ?? null;
    }
    const workClosed = CLOSED_WORK_STATUSES.has(String(wi.status));
    const orderClosed = order ? !OPEN_ORDER_STATUSES.has(String(order.status)) : false;

    if (workClosed || orderClosed) {
      const reason = workClosed ? `el trabajo está ${wi.status}` : `la orden está ${order?.status}`;
      result.conflicts.push({ workItemId: wi.id, reason });
      await db.insert(operationalEvents).values({
        workItemId: wi.id,
        planningWeekId: wi.planningWeekId,
        type: "LOTE_SYNC_CONFLICT",
        fromStatus: JSON.stringify({ lote: wi.packagingLote ?? null, vto: wi.packagingVto ?? null }),
        toStatus: JSON.stringify({ lote, vto: nextVto }),
        actorEmail: actor,
        actorSector,
        note:
          `Asignación de Lotes (id=${record.id}) cambió a lote=${lote}/vto=${nextVto ?? "—"} pero ${reason}: ` +
          `no se modificó. Requiere corrección auditada con motivo.`,
      });
      if (order) {
        await db.insert(orderAuditEvents).values({
          orderId: order.id,
          eventType: "LOTE_SYNC_CONFLICT",
          actor,
          actorSector,
          metadata: { asignacionLoteId: record.id, proposedLote: lote, proposedVto: nextVto, currentLote: wi.packagingLote },
        });
      }
      continue;
    }

    const now = new Date();
    await db
      .update(workItems)
      .set({ packagingLote: lote, packagingVto: nextVto, updatedAt: now, version: sql`${workItems.version} + 1` })
      .where(eq(workItems.id, wi.id));
    if (order) {
      let form = order.formData as { header?: Record<string, unknown> } | null;
      if (form && typeof form === "object" && form.header && typeof form.header === "object") {
        form = { ...form, header: { ...form.header, lot: lote, ...(nextVto ? { vto: nextVto } : {}) } };
      }
      await db
        .update(operationalOrders)
        .set({
          lot: lote,
          ...(form ? { formData: form } : {}),
          updatedBy: actor,
          updatedAt: now,
          version: sql`${operationalOrders.version} + 1`,
        })
        .where(eq(operationalOrders.id, order.id));
      await db.insert(orderAuditEvents).values({
        orderId: order.id,
        eventType: "LOTE_SYNCED_FROM_ASIGNACION",
        actor,
        actorSector,
        metadata: { asignacionLoteId: record.id, from: wi.packagingLote, to: lote, vto: nextVto },
      });
    }
    await db.insert(operationalEvents).values({
      workItemId: wi.id,
      planningWeekId: wi.planningWeekId,
      type: "LOTE_SYNCED",
      fromStatus: JSON.stringify({ lote: wi.packagingLote ?? null, vto: wi.packagingVto ?? null }),
      toStatus: JSON.stringify({ lote, vto: nextVto }),
      actorEmail: actor,
      actorSector,
      note: `Sincronizado desde Asignación de Lotes (id=${record.id}) por vínculo persistente.`,
    });
    result.synced.push(wi.id);
  }
  return result;
}

export interface ReconcileLoteLinksResult {
  linked: Array<{ workItemId: string; asignacionLoteId: string }>;
  ambiguous: string[];
  pending: string[];
  skippedClosed: string[];
  /** Informe para revisión humana: nada de esto se modifica automáticamente. */
  report: {
    examined: number;
    alreadyLinked: number;
    /** Vinculados cuyo lote del trabajo/OE-OA difiere del de Asignación (requieren sync o corrección auditada). */
    linkedMismatch: Array<{ workItemId: string; asignacionLoteId: string; workLote: string | null; asignacionLote: string | null; blockedByClosed: boolean }>;
    ambiguousDetail: Array<{ workItemId: string; client: string; product: string; reason: "VARIOS_LOTES" | "LOTE_PROPIO_DISTINTO"; candidates: Array<{ id: string; lote: string }> }>;
  };
}

/**
 * Vincula trabajos existentes SIN vínculo cuando la coincidencia es inequívoca. Ambiguos y sin
 * coincidencia quedan pendientes (LOTE PENDIENTE DE ASIGNACIÓN). No cambia trabajos cerrados ni
 * valores de lote/VTO existentes: solo agrega el id de vínculo (o completa lote/VTO si estaban vacíos).
 */
export async function reconcileLoteLinks(opts: {
  actorEmail: string;
  actorSector?: string;
  dryRun?: boolean;
}): Promise<ReconcileLoteLinksResult> {
  const out: ReconcileLoteLinksResult = {
    linked: [],
    ambiguous: [],
    pending: [],
    skippedClosed: [],
    report: { examined: 0, alreadyLinked: 0, linkedMismatch: [], ambiguousDetail: [] },
  };
  const db = getDb();
  const rows = await db.select().from(asignacionLotes).where(eq(asignacionLotes.archived, false));
  const candidates = rows.map((row: typeof asignacionLotes.$inferSelect) => ({
    id: row.id,
    lote: row.lote,
    vto: row.vto,
    producto: row.producto,
    marca: row.marca,
    codigo: row.codigo,
    cantidades: Number(row.cantidades) || 0,
    fecha: row.fecha,
    archived: row.archived,
  }));
  const linkedRows = await db
    .select({
      id: workItems.id,
      status: workItems.status,
      asignacionLoteId: workItems.asignacionLoteId,
      packagingLote: workItems.packagingLote,
      orderId: workItems.orderId,
    })
    .from(workItems)
    .where(and(isNotNull(workItems.asignacionLoteId), isNull(workItems.deletedAt)));
  out.report.alreadyLinked = linkedRows.length;
  const loteById = new Map(candidates.map((c) => [c.id, c.lote]));
  for (const lw of linkedRows) {
    const al = loteById.get(lw.asignacionLoteId as string) ?? null;
    if (al == null || (lw.packagingLote ?? null) === al) continue;
    let orderClosed = false;
    if (lw.orderId) {
      const [o] = await db.select({ status: operationalOrders.status }).from(operationalOrders).where(eq(operationalOrders.id, lw.orderId)).limit(1);
      orderClosed = o ? !OPEN_ORDER_STATUSES.has(String(o.status)) : false;
    }
    out.report.linkedMismatch.push({
      workItemId: lw.id,
      asignacionLoteId: lw.asignacionLoteId as string,
      workLote: lw.packagingLote ?? null,
      asignacionLote: al,
      blockedByClosed: CLOSED_WORK_STATUSES.has(String(lw.status)) || orderClosed,
    });
  }

  const unlinked = await db
    .select({
      id: workItems.id,
      client: workItems.client,
      product: workItems.product,
      status: workItems.status,
      planningWeekId: workItems.planningWeekId,
      packagingLote: workItems.packagingLote,
      packagingVto: workItems.packagingVto,
    })
    .from(workItems)
    .where(and(isNull(workItems.asignacionLoteId), isNull(workItems.deletedAt)));

  out.report.examined = unlinked.length + linkedRows.length;
  for (const wi of unlinked) {
    if (CLOSED_WORK_STATUSES.has(String(wi.status))) {
      out.skippedClosed.push(wi.id);
      continue;
    }
    const resolution = resolveAsignacionLoteForWorkItem(candidates, { cliente: wi.client, producto: wi.product });
    if (resolution.status === "ambiguous") {
      out.ambiguous.push(wi.id);
      out.report.ambiguousDetail.push({
        workItemId: wi.id,
        client: wi.client,
        product: wi.product,
        reason: "VARIOS_LOTES",
        candidates: resolution.candidates.map((c) => ({ id: c.id, lote: c.lote })),
      });
      continue;
    }
    if (resolution.status === "none") {
      out.pending.push(wi.id);
      continue;
    }
    const c = resolution.candidate;
    // Si el trabajo ya tiene un lote propio distinto, no se vincula (no se adivina cuál manda).
    if (wi.packagingLote && wi.packagingLote.trim() !== c.lote.trim()) {
      out.ambiguous.push(wi.id);
      out.report.ambiguousDetail.push({
        workItemId: wi.id,
        client: wi.client,
        product: wi.product,
        reason: "LOTE_PROPIO_DISTINTO",
        candidates: [{ id: c.id, lote: c.lote }],
      });
      continue;
    }
    out.linked.push({ workItemId: wi.id, asignacionLoteId: c.id });
    if (opts.dryRun) continue;
    const now = new Date();
    const updated = await db
      .update(workItems)
      .set({
        asignacionLoteId: c.id,
        loteLinkMethod: "RECONCILED",
        loteLinkedAt: now,
        loteLinkedBy: opts.actorEmail,
        packagingLote: wi.packagingLote ?? c.lote,
        packagingVto: wi.packagingVto ?? c.vto,
      })
      .where(and(eq(workItems.id, wi.id), isNull(workItems.asignacionLoteId)))
      .returning({ id: workItems.id });
    if (updated.length) {
      await db.insert(operationalEvents).values({
        workItemId: wi.id,
        planningWeekId: wi.planningWeekId,
        type: "LOTE_LINKED",
        fromStatus: null,
        toStatus: JSON.stringify({ asignacionLoteId: c.id, lote: c.lote }),
        actorEmail: opts.actorEmail,
        actorSector: opts.actorSector ?? "SYSTEM",
        note: "Reconciliación segura: coincidencia única con Asignación de Lotes.",
      });
    }
  }
  return out;
}
