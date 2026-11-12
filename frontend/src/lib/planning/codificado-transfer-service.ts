/**
 * Entregas parciales de Envasado a CODIFICADO — servicio durable (Postgres).
 *
 * Modelo (sin circuitos paralelos):
 *  - El trabajo de ENVASADO sigue siendo el mismo y sigue abierto mientras queden unidades por terminar o entregar.
 *  - Cada entrega es un MOVIMIENTO INTERNO propio (`work_item_codificado_transfers`): cantidad, acumulado, saldo, lote, usuario,
 *    fecha y referencia al trabajo original.
 *  - Codificado recibe UN solo trabajo vinculado (`parent_work_item_id`) que se crea con la primera entrega y que no se duplica:
 *    las entregas siguientes solo suman unidades recibidas. Ese trabajo usa toda la maquinaria actual de Codificado.
 *  - Todo corre en UNA transacción con el trabajo de Envasado bloqueado (FOR UPDATE): dos entregas simultáneas se serializan y
 *    la segunda se valida contra el saldo real. La idempotencia (clave única) evita duplicados por doble clic o reintento.
 *  - No genera entregas al cliente ni toca el stock de Depósito.
 */
import "server-only";

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { operationalEvents, workItemCodificadoTransfers, workItems } from "@/lib/db/schema";
import { canTransferToCodificado, canWorkReceivedCodificado, planCodificadoTransfer, summarizeCodificado, type CodificadoSummary } from "@/lib/planning/circuit/codificado-transfer";
import { sumActiveDeliveredUnits } from "@/lib/planning/circuit/delivery-core";
import { parseQuantity } from "@/lib/planning/circuit/delivery-math";
import { validateDeliveryPacking, type DeliveryPackingGroup } from "@/lib/remitos/delivery-packing";
import { sumActiveCodificadoTransfers } from "@/lib/planning/circuit/codificado-transfers-sum";
import type { PlanningActor } from "@/lib/planning/types";
import { PlanningForbiddenError, PlanningNotFoundError, PlanningValidationError } from "@/lib/planning/types";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type TransferRow = typeof workItemCodificadoTransfers.$inferSelect;

export type CodificadoTransferDto = {
  id: string;
  seq: number;
  quantity: number;
  cumulative: number;
  pending: number;
  originSector: string;
  lote: string | null;
  vto: string | null;
  deliveredBy: string;
  deliveredByName: string | null;
  deliveredAt: string;
  status: string;
  note: string | null;
  /** Cajas de esta entrega ([{cajas, unidadesPorCaja}]); vacío = sin detalle de embalaje. */
  packingGroups: DeliveryPackingGroup[];
};

export type CodificadoTransferView = {
  /** Trabajo de Envasado (origen). */
  parentId: string;
  /** Trabajo de Codificado que recibe (null si todavía no hubo ninguna entrega). */
  childId: string | null;
  client: string;
  product: string;
  lote: string | null;
  originSector: string;
  unit: string;
  summary: CodificadoSummary;
  transfers: CodificadoTransferDto[];
};

export type TransferInput = {
  workItemId: string;
  quantity: number;
  /** Total de unidades terminadas a registrar antes de entregar (solo sube; nunca baja de lo ya entregado). */
  finishedQty?: number | null;
  observation?: string | null;
  /** Cajas de ESTA entrega (cantidades distintas por caja); si vienen, deben sumar exactamente la cantidad entregada. */
  packingGroups?: unknown;
  idempotencyKey: string;
};

const norm = (raw: string) => (String(raw ?? "").trim().startsWith("native:") ? String(raw).trim().slice(7) : String(raw ?? "").trim());
const sectorOf = (a: PlanningActor) => String(a.sector ?? "").toUpperCase();
const toDto = (r: TransferRow): CodificadoTransferDto => ({ id: r.id, seq: r.seq, quantity: r.quantity, cumulative: r.cumulative, pending: r.pending, originSector: r.originSector, lote: r.lote, vto: r.vto, deliveredBy: r.deliveredBy, deliveredByName: r.deliveredByName, deliveredAt: r.deliveredAt.toISOString(), status: r.status, note: r.note, packingGroups: Array.isArray(r.packingGroups) ? (r.packingGroups as DeliveryPackingGroup[]) : [] });

async function buildView(tx: Tx | Db, parent: typeof workItems.$inferSelect, child: typeof workItems.$inferSelect | null): Promise<CodificadoTransferView> {
  const rows = await tx.select().from(workItemCodificadoTransfers).where(eq(workItemCodificadoTransfers.workItemId, parent.id)).orderBy(asc(workItemCodificadoTransfers.seq));
  const active = rows.filter((r) => r.status === "ACTIVA");
  const transferred = active.reduce((s, r) => s + r.quantity, 0);
  const unit = parent.unit;
  const assigned = parseQuantity(parent.plannedQuantity, unit) ?? 0;
  const produced = parseQuantity(parent.finishedQty, unit);
  const deliveredToProd = await sumActiveDeliveredUnits(tx as Tx, parent.id);
  const coded = child ? (parseQuantity(child.finishedQty, unit) ?? 0) : 0;
  const deliveredByCod = child ? await sumActiveDeliveredUnits(tx as Tx, child.id) : 0;
  return {
    parentId: parent.id,
    childId: child?.id ?? null,
    client: parent.client,
    product: parent.product,
    lote: parent.packagingLote ?? null,
    originSector: parent.sector === "CODIFICADO" ? (parent.codificadoOriginSector ?? parent.sector) : parent.sector,
    unit,
    summary: summarizeCodificado({ assigned, produced, deliveredToProduccion: deliveredToProd, transferred, coded, deliveredByCodificado: deliveredByCod }),
    transfers: rows.map(toDto),
  };
}

async function loadPair(tx: Tx | Db, anyId: string): Promise<{ parent: typeof workItems.$inferSelect; child: typeof workItems.$inferSelect | null }> {
  const [row] = await tx.select().from(workItems).where(eq(workItems.id, anyId)).limit(1);
  if (!row) throw new PlanningNotFoundError("Trabajo no encontrado.");
  if (row.parentWorkItemId) {
    const [parent] = await tx.select().from(workItems).where(eq(workItems.id, row.parentWorkItemId)).limit(1);
    if (!parent) throw new PlanningNotFoundError("Trabajo de Envasado de origen no encontrado.");
    return { parent, child: row };
  }
  const [child] = await tx.select().from(workItems).where(and(eq(workItems.parentWorkItemId, row.id), isNull(workItems.deletedAt))).limit(1);
  return { parent: row, child: child ?? null };
}

/** Quién puede VER las entregas de un trabajo: su Envasado, Codificado, Producción y Dirección. */
function assertCanView(actor: PlanningActor, parent: typeof workItems.$inferSelect) {
  const s = sectorOf(actor);
  if (canWorkReceivedCodificado(s)) return;
  if ((s === "ENVASADO_MASIVO" || s === "ENVASADO_PREMIUM") && s === parent.sector) return;
  throw new PlanningForbiddenError("No tenés permiso para ver las entregas a Codificado de este trabajo.");
}

export async function getCodificadoTransferView(workItemId: string, actor: PlanningActor): Promise<CodificadoTransferView> {
  const { parent, child } = await loadPair(getDb(), norm(workItemId));
  assertCanView(actor, parent);
  return buildView(getDb(), parent, child);
}

/** Todas las entregas recibidas por Codificado (bandeja): una fila por entrega, con cliente, producto, lote, origen, cantidad, fecha y usuario. */
export async function listCodificadoReceipts(actor: PlanningActor, opts: { limit?: number } = {}) {
  if (!canWorkReceivedCodificado(sectorOf(actor))) throw new PlanningForbiddenError("Solo Codificado, Producción y Dirección consultan las entregas recibidas.");
  const db = getDb();
  const rows = await db.select().from(workItemCodificadoTransfers).where(eq(workItemCodificadoTransfers.status, "ACTIVA")).orderBy(desc(workItemCodificadoTransfers.deliveredAt)).limit(Math.min(opts.limit ?? 100, 500));
  if (!rows.length) return [];
  const ids = [...new Set(rows.flatMap((r) => [r.workItemId, r.codificadoItemId]))];
  const items = await db.select({ id: workItems.id, client: workItems.client, product: workItems.product, lote: workItems.packagingLote }).from(workItems).where(inArray(workItems.id, ids));
  const by = new Map(items.map((i) => [i.id, i]));
  return rows.map((r) => ({ ...toDto(r), workItemId: r.workItemId, codificadoItemId: r.codificadoItemId, client: by.get(r.workItemId)?.client ?? "", product: by.get(r.workItemId)?.product ?? "" }));
}

export type TransferResult = { replayed: boolean; transfer: CodificadoTransferDto; view: CodificadoTransferView; complete: boolean };

export async function transferToCodificadoDurable(input: TransferInput, actor: PlanningActor): Promise<TransferResult> {
  const id = norm(input.workItemId);
  const key = String(input.idempotencyKey ?? "").trim();
  if (!id) throw new PlanningValidationError("workItemId requerido.");
  if (key.length < 8) throw new PlanningValidationError("idempotencyKey inválida.");
  const requested = Number(input.quantity);
  if (!Number.isFinite(requested) || requested <= 0) throw new PlanningValidationError("La cantidad a entregar debe ser mayor que 0.");
  const boxes = validateDeliveryPacking(input.packingGroups ?? null, requested, { lenient: true });
  if (!boxes.ok) throw new PlanningValidationError(boxes.error);

  return getDb().transaction(async (tx) => {
    // Idempotencia: la misma clave devuelve la entrega ya registrada (doble clic, reintento de red).
    const replay = async (): Promise<TransferResult | null> => {
      const [prior] = await tx.select().from(workItemCodificadoTransfers).where(eq(workItemCodificadoTransfers.idempotencyKey, key)).limit(1);
      if (!prior) return null;
      if (prior.workItemId !== id) throw new PlanningValidationError("La clave de idempotencia ya se usó en otro trabajo.");
      const { parent, child } = await loadPair(tx, id);
      return { replayed: true, transfer: toDto(prior), view: await buildView(tx, parent, child), complete: prior.pending <= 1e-6 };
    };
    const early = await replay();
    if (early) return early;

    // Serializa con cualquier otra entrega del MISMO trabajo (la segunda espera y se valida contra el saldo real).
    const [row] = await tx.select().from(workItems).where(eq(workItems.id, id)).for("update").limit(1);
    if (!row) throw new PlanningNotFoundError("Trabajo no encontrado.");
    // Un reintento simultáneo con la misma clave espera el candado: al entrar, la entrega ya existe y se devuelve tal cual.
    const late = await replay();
    if (late) return late;
    if (row.deletedAt) throw new PlanningValidationError("El trabajo fue eliminado.");
    if (row.parentWorkItemId) throw new PlanningValidationError("Elegí el trabajo de Envasado: este es el trabajo que recibe en Codificado.");
    if (row.sector !== "ENVASADO_MASIVO" && row.sector !== "ENVASADO_PREMIUM") {
      throw new PlanningValidationError("Solo los trabajos de Envasado Masivo/Premium entregan a Codificado.");
    }
    if (!canTransferToCodificado(sectorOf(actor), row.sector)) {
      throw new PlanningForbiddenError(
        sectorOf(actor).startsWith("ENVASADO") ? "Solo el Envasado propietario puede entregar este trabajo a Codificado." : "No tenés permiso para entregar a Codificado."
      );
    }
    if (row.status !== "PUBLICADO") throw new PlanningValidationError("Solo se pueden entregar trabajos publicados.");
    if (row.operationalStatus === "entregado" || row.operationalStatus === "cancelado") {
      throw new PlanningValidationError("Este trabajo ya está entregado o cancelado.");
    }
    if (row.viaCodificado) throw new PlanningValidationError("Este trabajo ya fue enviado completo a Codificado: no admite entregas parciales.");

    const unit = row.unit;
    const assigned = parseQuantity(row.plannedQuantity, unit);
    if (assigned == null || !(assigned > 0)) throw new PlanningValidationError("Este trabajo no tiene una cantidad asignada numérica: no admite entrega a Codificado por partes.");
    const deliveredToProd = await sumActiveDeliveredUnits(tx, id);
    const transferred = await sumActiveCodificadoTransfers(tx, id);
    const alreadyOut = deliveredToProd + transferred;

    // Registrar lo realizado antes de entregar (simple, sin pasar por otra pantalla). Solo puede subir.
    let finished = parseQuantity(row.finishedQty, unit);
    let finishedRegistered = false;
    if (input.finishedQty != null) {
      const f = Number(input.finishedQty);
      if (!Number.isFinite(f) || f <= 0) throw new PlanningValidationError("Las unidades terminadas deben ser un número mayor que 0.");
      if (f < alreadyOut - 1e-6) throw new PlanningValidationError(`Las unidades terminadas (${f}) no pueden ser menos que lo ya entregado (${alreadyOut}).`);
      if (finished == null || f > finished) {
        finished = f;
        finishedRegistered = true;
      }
    }

    const plan = planCodificadoTransfer({ assigned, alreadyOut, produced: finished, requested, unit });
    if (!plan.ok) throw new PlanningValidationError(plan.error);

    const now = new Date();
    const actorName = actor.displayName || actor.email;
    const [lastSeq] = await tx.select({ n: sql<number>`coalesce(max(${workItemCodificadoTransfers.seq}), 0)` }).from(workItemCodificadoTransfers).where(eq(workItemCodificadoTransfers.workItemId, id));
    const seq = Number(lastSeq?.n ?? 0) + 1;
    const cumulativeToCod = transferred + plan.quantity;
    const pendingAssigned = Math.max(0, assigned - alreadyOut - plan.quantity);

    // Trabajo de Codificado: UNO por trabajo de Envasado (se crea con la primera entrega; después solo suma lo recibido).
    let [child] = await tx.select().from(workItems).where(and(eq(workItems.parentWorkItemId, id), isNull(workItems.deletedAt))).for("update").limit(1);
    if (!child) {
      [child] = await tx
        .insert(workItems)
        .values({
          planningWeekId: row.planningWeekId,
          plannedDate: row.plannedDate,
          plannedDateTo: row.plannedDateTo,
          client: row.client,
          product: row.product,
          plannedQuantity: row.plannedQuantity,
          unit: row.unit,
          sector: "CODIFICADO",
          line: null,
          branchOwner: null,
          homeLine: row.homeLine ?? row.line,
          homeBranchOwner: row.homeBranchOwner ?? row.branchOwner,
          priority: row.priority,
          notes: row.notes,
          packagingLote: row.packagingLote,
          packagingVto: row.packagingVto,
          asignacionLoteId: row.asignacionLoteId,
          loteLinkMethod: row.loteLinkMethod,
          packagingTotalUnits: assigned,
          viaCodificado: true,
          codificadoOriginSector: row.sector,
          sentToCodificadoAt: now,
          sentToCodificadoBy: actorName,
          codificadoRevision: 1,
          productionPedidoId: row.productionPedidoId,
          orderId: row.orderId,
          orderNumber: row.orderNumber,
          deliveryDate: row.deliveryDate,
          status: "PUBLICADO",
          publishedAt: now,
          createdBy: actor.email,
          source: "native",
          operationalStatus: "pendiente",
          parentWorkItemId: id,
        })
        .returning();
      await tx.insert(operationalEvents).values({ workItemId: child!.id, planningWeekId: row.planningWeekId, type: "CODIFICADO_RECEIVING_ITEM_CREATED", fromStatus: row.sector, toStatus: "EN_CODIFICADO", actorEmail: actor.email, actorSector: actor.sector, note: `parent:${id}` });
    } else {
      [child] = await tx.update(workItems).set({ codificadoCancelledAt: null, codificadoCancelledBy: null, codificadoCancelReason: null, packagingLote: row.packagingLote ?? child.packagingLote, packagingVto: row.packagingVto ?? child.packagingVto, version: sql`${workItems.version} + 1`, updatedAt: now }).where(eq(workItems.id, child.id)).returning();
    }

    const [transfer] = await tx
      .insert(workItemCodificadoTransfers)
      .values({
        workItemId: id,
        codificadoItemId: child!.id,
        seq,
        quantity: plan.quantity,
        cumulative: cumulativeToCod,
        pending: pendingAssigned,
        originSector: row.sector,
        lote: row.packagingLote,
        vto: row.packagingVto,
        deliveredBy: actor.email,
        deliveredByName: actorName,
        deliveredBySector: sectorOf(actor),
        deliveredAt: now,
        idempotencyKey: key,
        note: input.observation?.trim() || null,
        packingGroups: boxes.groups.length > 0 ? boxes.groups : null,
      })
      .returning();

    // El trabajo de Envasado NO se cierra por entregar: solo cuando no queda nada por entregar ni terminar.
    const allOut = alreadyOut + plan.quantity;
    const fullyOut = assigned - allOut <= 1e-6;
    const [parentAfter] = await tx
      .update(workItems)
      .set({
        ...(finishedRegistered ? { finishedQty: String(finished) } : {}),
        ...(fullyOut && row.operationalStatus !== "completo" ? { operationalStatus: "completo", completedAt: now, completedBy: actorName } : {}),
        version: sql`${workItems.version} + 1`,
        updatedAt: now,
      })
      .where(eq(workItems.id, id))
      .returning();
    await tx.insert(operationalEvents).values({
      workItemId: id,
      planningWeekId: row.planningWeekId,
      type: "CODIFICADO_PARTIAL_TRANSFER",
      fromStatus: row.sector,
      toStatus: fullyOut ? "ENTREGA_A_CODIFICADO_COMPLETA" : "ENTREGA_A_CODIFICADO_PARCIAL",
      actorEmail: actor.email,
      actorSector: actor.sector,
      note: `#${seq} ${plan.quantity} un. (acumulado ${cumulativeToCod}) · ${key}`,
    });
    await tx.insert(operationalEvents).values({ workItemId: child!.id, planningWeekId: row.planningWeekId, type: "CODIFICADO_RECEIVED", fromStatus: row.sector, toStatus: "EN_CODIFICADO", actorEmail: actor.email, actorSector: actor.sector, note: `#${seq} +${plan.quantity} (recibidas ${cumulativeToCod})` });

    return { replayed: false, transfer: toDto(transfer!), view: await buildView(tx, parentAfter!, child!), complete: fullyOut };
  });
}

export type CodedProgressInput = { workItemId: string; codedUnits: number };

/** Avance de Codificado: cuántas de las unidades recibidas ya están codificadas (nunca más que las recibidas). */
export async function recordCodificadoProgressDurable(input: CodedProgressInput, actor: PlanningActor): Promise<CodificadoTransferView> {
  if (sectorOf(actor) !== "CODIFICADO") throw new PlanningForbiddenError("Solo Codificado registra el avance de lo recibido.");
  const id = norm(input.workItemId);
  const coded = Number(input.codedUnits);
  if (!Number.isFinite(coded) || coded < 0) throw new PlanningValidationError("Las unidades codificadas deben ser un número válido (0 o más).");
  return getDb().transaction(async (tx) => {
    const [row] = await tx.select().from(workItems).where(eq(workItems.id, id)).for("update").limit(1);
    if (!row) throw new PlanningNotFoundError("Trabajo no encontrado.");
    if (!row.parentWorkItemId) throw new PlanningValidationError("Este trabajo no recibe entregas parciales de Envasado.");
    const received = await sumActiveCodificadoTransfers(tx, row.parentWorkItemId);
    if (coded > received + 1e-6) throw new PlanningValidationError(`No se pueden registrar ${coded} codificadas: Codificado recibió ${received}.`);
    if (Number.isInteger(coded) === false && /^(un|u|unid)/i.test(row.unit.trim())) throw new PlanningValidationError("Las unidades codificadas deben ser un número entero.");
    const now = new Date();
    await tx.update(workItems).set({ finishedQty: String(coded), operationalStatus: coded > 0 && row.operationalStatus === "pendiente" ? "en_curso" : row.operationalStatus, progressUpdatedAt: now, progressUpdatedBy: actor.displayName || actor.email, version: sql`${workItems.version} + 1`, updatedAt: now }).where(eq(workItems.id, id));
    await tx.insert(operationalEvents).values({ workItemId: id, planningWeekId: row.planningWeekId, type: "CODIFICADO_PROGRESS", fromStatus: String(row.finishedQty ?? ""), toStatus: String(coded), actorEmail: actor.email, actorSector: actor.sector, note: `codificadas ${coded} de ${received} recibidas` });
    const { parent, child } = await loadPair(tx, id);
    return buildView(tx, parent, child);
  });
}

/** Unidades recibidas por un trabajo de Codificado vinculado (0 si no recibe entregas parciales). Para topes en la entrega de Codificado. */
export async function receivedUnitsForCodificadoItem(tx: Tx, row: { id: string; parentWorkItemId: string | null }): Promise<number | null> {
  if (!row.parentWorkItemId) return null;
  return sumActiveCodificadoTransfers(tx, row.parentWorkItemId);
}

