/**
 * Entregas INTERNAS (Elaboración / Envasado / Codificado → Producción o Codificado): listado unificado, edición y cancelación.
 *
 * No es un circuito paralelo: opera sobre los registros reales que ya existen —
 *  - kind PRODUCCION: renglones de entrega a Producción (`work_item_delivery_lines`),
 *  - kind CODIFICADO: entregas parciales de Envasado a Codificado (`work_item_codificado_transfers`).
 *
 * Reglas:
 *  - Se puede editar la CANTIDAD y las OBSERVACIONES; cliente, producto, lote, origen y destino no cambian.
 *  - Cancelar NO borra: la entrega queda como CANCELADA, visible en el historial, y deja de sumar en todos los totales.
 *  - Cada cambio inserta una fila en `internal_delivery_changes` (antes/después, usuario, sector, motivo): nada se pisa en silencio.
 *  - Todo corre en UNA transacción con el trabajo bloqueado (FOR UPDATE) y control de versión: dos ediciones simultáneas se serializan y
 *    la segunda se rechaza si trabaja sobre un dato viejo. Doble clic = una sola modificación.
 *  - Una corrección hacia ARRIBA declara las unidades realizadas que faltaban (queda auditado); nunca se inventan unidades.
 *  - No se reduce ni cancela por debajo de lo que el sector receptor ya procesó. No se toman decisiones sobre trabajos posteriores.
 *  - No toca entregas a clientes, remitos ni stock de Depósito.
 */
import "server-only";

import { and, asc, desc, eq, inArray, like, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  internalDeliveryChanges,
  operationalEvents,
  workItemCodificadoTransfers,
  workItemDeliveries,
  workItemDeliveryLines,
  workItems,
} from "@/lib/db/schema";
import { sumActiveCodificadoTransfers } from "@/lib/planning/circuit/codificado-transfers-sum";
import { sumActiveDeliveredUnits } from "@/lib/planning/circuit/delivery-core";
import { DELIVERY_EPSILON, formatQty, parseQuantity, resolveDeliveryTarget } from "@/lib/planning/circuit/delivery-math";
import { syncObsMark } from "@/lib/planning/circuit/delivery-group";
import { mergePackingGroups, packingTotals, samePacking } from "@/lib/remitos/delivery-boxes-input";
import { describeDeliveryPacking, validateDeliveryPacking, type DeliveryPackingGroup } from "@/lib/remitos/delivery-packing";
import { annulDeliveryInTx } from "@/lib/planning/work-item-progress-repository";
import { loadResolvedPackingByLine } from "@/lib/remitos/delivery-packing-resolve";
import type { PlanningActor } from "@/lib/planning/types";
import { PlanningForbiddenError, PlanningNotFoundError, PlanningValidationError } from "@/lib/planning/types";
import { isIntegerUnit } from "@/lib/utils/ar-number-parsing";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

/** La entrega cambió mientras se editaba (otra persona la modificó): se responde 409 con este mismo mensaje. */
export class InternalDeliveryConflictError extends Error {
  readonly code = "INTERNAL_DELIVERY_CONFLICT";
  readonly status = 409;
}

export type InternalDeliveryKind = "PRODUCCION" | "CODIFICADO";
export type InternalDeliveryStatus = "ACTIVA" | "CANCELADA";

const OPERATIONAL_SECTORS = new Set(["ELABORACION", "ENVASADO_MASIVO", "ENVASADO_PREMIUM", "CODIFICADO"]);
const SECTOR_LABELS: Record<string, string> = {
  ELABORACION: "Elaboración",
  ENVASADO_MASIVO: "Envasado Masivo",
  ENVASADO_PREMIUM: "Envasado Premium",
  CODIFICADO: "Codificado",
  PRODUCCION: "Producción",
};
const MAX_OBSERVATION = 1000;

const sectorOf = (actor: PlanningActor) => String(actor.sector ?? "").toUpperCase();
const isAdminSector = (s: string) => s === "PRODUCCION" || s === "DIRECCION";

/** Quién ve el módulo: Producción/Dirección (todo) y los sectores operativos (solo sus entregas). */
export function canViewInternalDeliveries(actorSector: string | null | undefined): boolean {
  const s = String(actorSector ?? "").toUpperCase();
  return isAdminSector(s) || OPERATIONAL_SECTORS.has(s);
}

/** Quién edita/cancela una entrega: Producción/Dirección (todas) o el sector de ORIGEN de esa entrega. */
export function canManageInternalDelivery(actorSector: string | null | undefined, originSector: string | null | undefined): boolean {
  const a = String(actorSector ?? "").toUpperCase();
  if (isAdminSector(a)) return true;
  return OPERATIONAL_SECTORS.has(a) && a === String(originSector ?? "").toUpperCase();
}

export type InternalDeliveryChangeDto = {
  id: string;
  action: "EDITAR" | "CANCELAR";
  oldQuantity: number | null;
  newQuantity: number | null;
  oldObservations: string | null;
  newObservations: string | null;
  finishedBefore: string | null;
  finishedAfter: string | null;
  oldPacking: DeliveryPackingGroup[] | null;
  newPacking: DeliveryPackingGroup[] | null;
  reason: string | null;
  actorName: string | null;
  actorEmail: string;
  actorSector: string;
  actorSectorLabel: string;
  createdAt: string;
};

export type InternalDeliveryDto = {
  id: string;
  kind: InternalDeliveryKind;
  workItemId: string;
  client: string;
  product: string;
  lote: string | null;
  originSector: string;
  originLabel: string;
  destination: "PRODUCCION" | "CODIFICADO";
  destinationLabel: string;
  /** Orden de la entrega dentro del trabajo (#1, #2…). */
  sequence: number;
  date: string;
  quantity: number;
  unit: string;
  observations: string | null;
  /** Cajas de la entrega (cada tipo de caja por separado); [] = sin detalle de embalaje. */
  packingGroups: DeliveryPackingGroup[];
  /** Total de cajas y texto «8 cajas de 100 u. + 1 caja de 50 u. = 9 cajas / 850 u.» (null sin cajas). */
  cajas: number;
  boxesText: string | null;
  /** true = las cajas vienen de las entregas de Envasado a Codificado (no son propias de esta entrega). */
  packingInherited: boolean;
  /** Remito vigente (no anulado) que ya incluye esta entrega: la entrega no se corrige hasta resolver el remito. */
  remito: { id: string; number: string | null; status: string } | null;
  status: InternalDeliveryStatus;
  cumulative: number | null;
  pending: number | null;
  deliveredBy: string;
  deliveredBySector: string;
  /** Cantidad de modificaciones registradas: sirve de versión para detectar ediciones simultáneas. */
  version: number;
  cancelReason: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  canManage: boolean;
};

export type InternalDeliveryFilters = {
  q?: string | null;
  workItemId?: string | null;
  sector?: string | null;
  status?: InternalDeliveryStatus | null;
  from?: string | null;
  to?: string | null;
  limit?: number | null;
};

type RawRow = Omit<InternalDeliveryDto, "version" | "cancelReason" | "cancelledAt" | "cancelledBy" | "canManage" | "originLabel" | "destinationLabel" | "status" | "cajas" | "boxesText" | "remito" | "packingInherited"> & {
  status: InternalDeliveryStatus;
  cancelledAtRaw: Date | null;
  cancelledByRaw: string | null;
};

const asGroups = (raw: unknown): DeliveryPackingGroup[] =>
  Array.isArray(raw)
    ? (raw as Array<{ cajas?: unknown; unidadesPorCaja?: unknown }>)
        .map((g) => ({ cajas: Number(g?.cajas) || 0, unidadesPorCaja: Number(g?.unidadesPorCaja) || 0 }))
        .filter((g) => g.cajas > 0 && g.unidadesPorCaja > 0)
    : [];

/** Remitos vigentes (no anulados) que ya incluyen estas entregas a Producción. */
async function loadRemitoLinks(tx: Tx, lineIds: string[]): Promise<Map<string, { id: string; number: string | null; status: string }>> {
  const out = new Map<string, { id: string; number: string | null; status: string }>();
  if (lineIds.length === 0) return out;
  try {
    const keys = lineIds.map((i) => `dl:${i}`);
    const res = await tx.execute(sql`select k.work_item_id as key, r.id::text as id, r.remito_number as number, r.status as status
      from remito_work_links k join remitos r on r.id = k.remito_id where r.status <> 'ANULADO' and k.work_item_id in (${sql.join(keys.map((k: string) => sql`${k}`), sql`, `)})`);
    for (const r of res.rows as Array<Record<string, unknown>>) out.set(String(r.key).slice(3), { id: String(r.id), number: r.number == null ? null : String(r.number), status: String(r.status) });
  } catch {
    // remitos no disponibles: no se bloquea la corrección por esto
  }
  return out;
}

function fmtQtyFor(unit: string | null | undefined, n: number): string {
  return isIntegerUnit(unit) ? String(Math.round(n)) : formatQty(n);
}

async function loadLineRows(tx: Tx, where: ReturnType<typeof and> | undefined, limit: number): Promise<RawRow[]> {
  const rows = await tx
    .select({
      id: workItemDeliveryLines.id,
      workItemId: workItemDeliveryLines.workItemId,
      sequence: workItemDeliveryLines.sequence,
      quantity: workItemDeliveryLines.quantity,
      unit: workItemDeliveryLines.unit,
      status: workItemDeliveryLines.status,
      sourceSector: workItemDeliveryLines.sourceSector,
      deliveredBy: workItemDeliveryLines.deliveredBy,
      deliveredBySector: workItemDeliveryLines.deliveredBySector,
      at: workItemDeliveryLines.actualDeliveredAt,
      observations: workItemDeliveryLines.observations,
      packing: workItemDeliveryLines.packingGroups,
      cumulative: workItemDeliveryLines.cumulativeAfter,
      pending: workItemDeliveryLines.pendingAfter,
      annulledAt: workItemDeliveryLines.annulledAt,
      annulledBy: workItemDeliveryLines.annulledBy,
      client: workItems.client,
      product: workItems.product,
      lote: workItems.packagingLote,
      itemUnit: workItems.unit,
      parentWorkItemId: workItems.parentWorkItemId,
    })
    .from(workItemDeliveryLines)
    .innerJoin(workItems, eq(workItems.id, workItemDeliveryLines.workItemId))
    .where(where)
    .orderBy(desc(workItemDeliveryLines.actualDeliveredAt))
    .limit(limit);
  return rows.map((r: Record<string, unknown>) => ({
    id: String(r.id),
    kind: "PRODUCCION" as const,
    workItemId: String(r.workItemId),
    client: String(r.client ?? ""),
    product: String(r.product ?? ""),
    lote: (r.lote as string | null) ?? null,
    originSector: String(r.sourceSector),
    destination: "PRODUCCION" as const,
    sequence: Number(r.sequence),
    date: (r.at as Date).toISOString(),
    quantity: Number(r.quantity),
    unit: String(r.unit ?? r.itemUnit ?? ""),
    observations: (r.observations as string | null) ?? null,
    packingGroups: asGroups(r.packing),
    status: r.status === "ACTIVA" ? ("ACTIVA" as const) : ("CANCELADA" as const),
    cumulative: r.cumulative != null ? Number(r.cumulative) : null,
    pending: r.pending != null ? Number(r.pending) : null,
    deliveredBy: String(r.deliveredBy),
    deliveredBySector: String(r.deliveredBySector),
    cancelledAtRaw: (r.annulledAt as Date | null) ?? null,
    cancelledByRaw: (r.annulledBy as string | null) ?? null,
  }));
}

async function loadTransferRows(tx: Tx, where: ReturnType<typeof and> | undefined, limit: number): Promise<RawRow[]> {
  const rows = await tx
    .select({
      id: workItemCodificadoTransfers.id,
      workItemId: workItemCodificadoTransfers.workItemId,
      seq: workItemCodificadoTransfers.seq,
      quantity: workItemCodificadoTransfers.quantity,
      cumulative: workItemCodificadoTransfers.cumulative,
      pending: workItemCodificadoTransfers.pending,
      originSector: workItemCodificadoTransfers.originSector,
      deliveredBy: workItemCodificadoTransfers.deliveredByName,
      deliveredByEmail: workItemCodificadoTransfers.deliveredBy,
      deliveredBySector: workItemCodificadoTransfers.deliveredBySector,
      at: workItemCodificadoTransfers.deliveredAt,
      status: workItemCodificadoTransfers.status,
      note: workItemCodificadoTransfers.note,
      packing: workItemCodificadoTransfers.packingGroups,
      lote: workItemCodificadoTransfers.lote,
      client: workItems.client,
      product: workItems.product,
      unit: workItems.unit,
    })
    .from(workItemCodificadoTransfers)
    .innerJoin(workItems, eq(workItems.id, workItemCodificadoTransfers.workItemId))
    .where(where)
    .orderBy(desc(workItemCodificadoTransfers.deliveredAt))
    .limit(limit);
  return rows.map((r: Record<string, unknown>) => ({
    id: String(r.id),
    kind: "CODIFICADO" as const,
    workItemId: String(r.workItemId),
    client: String(r.client ?? ""),
    product: String(r.product ?? ""),
    lote: (r.lote as string | null) ?? null,
    originSector: String(r.originSector),
    destination: "CODIFICADO" as const,
    sequence: Number(r.seq),
    date: (r.at as Date).toISOString(),
    quantity: Number(r.quantity),
    unit: String(r.unit ?? ""),
    observations: (r.note as string | null) ?? null,
    packingGroups: asGroups(r.packing),
    status: r.status === "ACTIVA" ? ("ACTIVA" as const) : ("CANCELADA" as const),
    cumulative: r.cumulative != null ? Number(r.cumulative) : null,
    pending: r.pending != null ? Number(r.pending) : null,
    deliveredBy: String(r.deliveredBy ?? r.deliveredByEmail ?? ""),
    deliveredBySector: String(r.deliveredBySector),
    cancelledAtRaw: null,
    cancelledByRaw: null,
  }));
}

/** Completa versión (cantidad de cambios), datos de cancelación (último CANCELAR) y permisos del actor. */
async function decorate(tx: Tx, actor: PlanningActor, rows: RawRow[]): Promise<InternalDeliveryDto[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const changes: Array<{ kind: string; deliveryId: string; action: string; reason: string | null; actorName: string | null; actorEmail: string; createdAt: Date }> = await tx
    .select({
      kind: internalDeliveryChanges.kind,
      deliveryId: internalDeliveryChanges.deliveryId,
      action: internalDeliveryChanges.action,
      reason: internalDeliveryChanges.reason,
      actorName: internalDeliveryChanges.actorName,
      actorEmail: internalDeliveryChanges.actorEmail,
      createdAt: internalDeliveryChanges.createdAt,
    })
    .from(internalDeliveryChanges)
    .where(inArray(internalDeliveryChanges.deliveryId, ids))
    .orderBy(asc(internalDeliveryChanges.createdAt));
  const byKey = new Map<string, typeof changes>();
  for (const c of changes) {
    const k = `${c.kind}:${c.deliveryId}`;
    const list = byKey.get(k) ?? [];
    list.push(c);
    byKey.set(k, list);
  }
  const s = sectorOf(actor);
  const remitos = await loadRemitoLinks(tx, rows.filter((r) => r.kind === "PRODUCCION").map((r) => r.id));
  // Entrega a Producción sin cajas propias (p. ej. Codificado → Producción): se muestran las cajas que Envasado informó en sus entregas a
  // Codificado (solo lectura; no se guardan en la entrega). Es el mismo dato que usa el remito.
  const inherited = new Map<string, DeliveryPackingGroup[]>();
  const needResolve = rows.filter((r) => r.kind === "PRODUCCION" && r.packingGroups.length === 0);
  if (needResolve.length > 0) {
    try {
      const resolved = await loadResolvedPackingByLine([...new Set(needResolve.map((r) => r.workItemId))]);
      for (const r of needResolve) {
        const rp = resolved.get(r.id);
        if (rp && rp.source !== "NINGUNA" && rp.groups.length > 0) inherited.set(r.id, rp.groups);
      }
    } catch {
      // solo lectura: si no se pudo resolver, se muestra «sin detalle»
    }
  }
  return rows.map(({ cancelledAtRaw, cancelledByRaw, ...r }) => {
    const list = byKey.get(`${r.kind}:${r.id}`) ?? [];
    const cancel = [...list].reverse().find((c) => c.action === "CANCELAR");
    return {
      ...r,
      cajas: packingTotals(inherited.get(r.id) ?? r.packingGroups).cajas,
      boxesText: describeDeliveryPacking(inherited.get(r.id) ?? r.packingGroups),
      packingInherited: inherited.has(r.id),
      remito: r.kind === "PRODUCCION" ? (remitos.get(r.id) ?? null) : null,
      originLabel: SECTOR_LABELS[r.originSector] ?? r.originSector,
      destinationLabel: SECTOR_LABELS[r.destination] ?? r.destination,
      version: list.length,
      cancelReason: r.status === "CANCELADA" ? (cancel?.reason ?? null) : null,
      cancelledAt: r.status === "CANCELADA" ? (cancel?.createdAt.toISOString() ?? cancelledAtRaw?.toISOString() ?? null) : null,
      cancelledBy: r.status === "CANCELADA" ? (cancel?.actorName ?? cancel?.actorEmail ?? cancelledByRaw ?? null) : null,
      canManage: r.status === "ACTIVA" && canManageInternalDelivery(s, r.originSector),
    };
  });
}

/** Lista unificada de entregas internas (más recientes primero). Cada sector ve las suyas; Producción/Dirección, todas. */
export async function listInternalDeliveries(actor: PlanningActor, filters: InternalDeliveryFilters = {}): Promise<InternalDeliveryDto[]> {
  const s = sectorOf(actor);
  if (!canViewInternalDeliveries(s)) throw new PlanningForbiddenError("No tenés permiso para consultar las entregas internas.");
  const db = getDb();
  const limit = Math.min(Math.max(Number(filters.limit ?? 300) || 300, 1), 500);
  const originFilter = isAdminSector(s) ? (filters.sector ? String(filters.sector).toUpperCase() : null) : s;
  const text = String(filters.q ?? "").trim();
  const like_ = text ? `%${text.replace(/[%_\\]/g, (m) => `\\${m}`)}%` : null;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(filters.from ?? "")) ? String(filters.from) : null;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(filters.to ?? "")) ? String(filters.to) : null;

  const lineConds = [
    filters.workItemId && /^[0-9a-f-]{36}$/i.test(String(filters.workItemId)) ? eq(workItemDeliveryLines.workItemId, String(filters.workItemId)) : undefined,
    originFilter ? eq(workItemDeliveryLines.sourceSector, originFilter) : undefined,
    filters.status === "ACTIVA" ? eq(workItemDeliveryLines.status, "ACTIVA") : filters.status === "CANCELADA" ? eq(workItemDeliveryLines.status, "ANULADA") : undefined,
    from ? sql`${workItemDeliveryLines.actualDeliveredAt} >= ${from}::date` : undefined,
    to ? sql`${workItemDeliveryLines.actualDeliveredAt} < (${to}::date + 1)` : undefined,
    like_ ? sql`(${workItems.client} ilike ${like_} or ${workItems.product} ilike ${like_} or coalesce(${workItems.packagingLote}, '') ilike ${like_})` : undefined,
  ].filter(Boolean);
  const transferConds = [
    filters.workItemId && /^[0-9a-f-]{36}$/i.test(String(filters.workItemId)) ? eq(workItemCodificadoTransfers.workItemId, String(filters.workItemId)) : undefined,
    originFilter ? eq(workItemCodificadoTransfers.originSector, originFilter) : undefined,
    filters.status === "ACTIVA" ? eq(workItemCodificadoTransfers.status, "ACTIVA") : filters.status === "CANCELADA" ? eq(workItemCodificadoTransfers.status, "ANULADA") : undefined,
    from ? sql`${workItemCodificadoTransfers.deliveredAt} >= ${from}::date` : undefined,
    to ? sql`${workItemCodificadoTransfers.deliveredAt} < (${to}::date + 1)` : undefined,
    like_ ? sql`(${workItems.client} ilike ${like_} or ${workItems.product} ilike ${like_} or coalesce(${workItemCodificadoTransfers.lote}, '') ilike ${like_})` : undefined,
  ].filter(Boolean);

  const [lines, transfers] = await Promise.all([
    loadLineRows(db, lineConds.length ? and(...(lineConds as never[])) : undefined, limit),
    loadTransferRows(db, transferConds.length ? and(...(transferConds as never[])) : undefined, limit),
  ]);
  const merged = [...lines, ...transfers].sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
  return decorate(db, actor, merged);
}

async function loadOne(tx: Tx, actor: PlanningActor, kind: InternalDeliveryKind, id: string): Promise<InternalDeliveryDto> {
  const rows = kind === "PRODUCCION" ? await loadLineRows(tx, eq(workItemDeliveryLines.id, id), 1) : await loadTransferRows(tx, eq(workItemCodificadoTransfers.id, id), 1);
  const [dto] = await decorate(tx, actor, rows);
  if (!dto) throw new PlanningNotFoundError("Entrega no encontrada.");
  return dto;
}

/** Historial de modificaciones de UNA entrega (solo quien puede ver sus entregas; los sectores, únicamente las suyas). */
export async function getInternalDeliveryHistory(actor: PlanningActor, kind: InternalDeliveryKind, id: string): Promise<InternalDeliveryChangeDto[]> {
  const s = sectorOf(actor);
  if (!canViewInternalDeliveries(s)) throw new PlanningForbiddenError("No tenés permiso para consultar las entregas internas.");
  const db = getDb();
  const dto = await loadOne(db, actor, kind, id);
  if (!isAdminSector(s) && s !== dto.originSector) throw new PlanningForbiddenError("Solo podés consultar el historial de las entregas de tu sector.");
  const rows = await db.select().from(internalDeliveryChanges).where(and(eq(internalDeliveryChanges.kind, kind), eq(internalDeliveryChanges.deliveryId, id))).orderBy(asc(internalDeliveryChanges.createdAt));
  return rows.map((r) => ({
    id: r.id,
    action: r.action === "CANCELAR" ? "CANCELAR" : "EDITAR",
    oldQuantity: r.oldQuantity,
    newQuantity: r.newQuantity,
    oldObservations: r.oldObservations,
    newObservations: r.newObservations,
    finishedBefore: r.finishedBefore,
    finishedAfter: r.finishedAfter,
    oldPacking: r.oldPacking == null ? null : asGroups(r.oldPacking),
    newPacking: r.newPacking == null ? null : asGroups(r.newPacking),
    reason: r.reason,
    actorName: r.actorName,
    actorEmail: r.actorEmail,
    actorSector: r.actorSector,
    actorSectorLabel: SECTOR_LABELS[r.actorSector] ?? r.actorSector,
    createdAt: r.createdAt.toISOString(),
  }));
}

export type InternalDeliveryEditInput = {
  kind: InternalDeliveryKind;
  id: string;
  /** Nueva cantidad (omitir para dejarla igual). */
  quantity?: number | string | null;
  /** Nuevas observaciones (omitir para dejarlas; "" las borra). */
  observations?: string | null;
  /** Cajas de la entrega ([{cajas, unidadesPorCaja}], tipos de caja distintos); omitir = sin cambios; [] = quitar el detalle. */
  packingGroups?: unknown;
  /** Versión que el cliente tenía al abrir el formulario (detecta ediciones simultáneas). */
  expectedVersion?: number | null;
};

export type InternalDeliveryCancelInput = {
  kind: InternalDeliveryKind;
  id: string;
  reason: string;
  expectedVersion?: number | null;
};

export type InternalDeliveryMutationResult = {
  delivery: InternalDeliveryDto;
  /** Totales del trabajo ya recalculados. */
  totals: { delivered: number; transferredToCodificado: number; finishedQty: string | null };
  /** Mensaje informativo (p. ej. «se registraron N unidades realizadas»). */
  notice: string | null;
};

type MutationInput = { kind: InternalDeliveryKind; id: string; mode: "edit" | "cancel"; quantity?: number | string | null; observations?: string | null; packingGroups?: unknown; reason?: string; expectedVersion?: number | null };

function parseNewQuantity(raw: number | string | null | undefined, unit: string): number {
  const value = typeof raw === "number" ? raw : parseQuantity(String(raw ?? "").trim(), unit);
  if (value == null || !Number.isFinite(value) || value <= 0) throw new PlanningValidationError("La cantidad entregada debe ser un número mayor que 0.");
  if (isIntegerUnit(unit) && !Number.isInteger(value)) throw new PlanningValidationError("La cantidad entregada debe ser un número entero de unidades.");
  return value;
}

function cleanObservation(raw: string | null | undefined): string | null {
  const t = String(raw ?? "").replace(/\r\n/g, "\n").trim();
  if (t.length > MAX_OBSERVATION) throw new PlanningValidationError(`Las observaciones superan los ${MAX_OBSERVATION} caracteres.`);
  return t || null;
}

async function currentVersion(tx: Tx, kind: InternalDeliveryKind, id: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(internalDeliveryChanges)
    .where(and(eq(internalDeliveryChanges.kind, kind), eq(internalDeliveryChanges.deliveryId, id)));
  return Number(row?.n ?? 0);
}

function assertVersion(expected: number | null | undefined, actual: number) {
  if (expected != null && Number(expected) !== actual) {
    throw new InternalDeliveryConflictError("La entrega fue modificada por otra persona mientras la editabas. Recargá la lista y volvé a intentar.");
  }
}

export async function editInternalDelivery(actor: PlanningActor, input: InternalDeliveryEditInput): Promise<InternalDeliveryMutationResult> {
  return runMutation(actor, { ...input, mode: "edit" });
}

export async function cancelInternalDelivery(actor: PlanningActor, input: InternalDeliveryCancelInput): Promise<InternalDeliveryMutationResult> {
  const reason = String(input.reason ?? "").trim();
  if (!reason) throw new PlanningValidationError("Indicá el motivo de la cancelación.");
  if (reason.length > 500) throw new PlanningValidationError("El motivo supera los 500 caracteres.");
  return runMutation(actor, { kind: input.kind, id: input.id, mode: "cancel", reason, expectedVersion: input.expectedVersion });
}

/** Cajas resultantes de una edición: las informadas (deben sumar la cantidad), las de antes si no se tocan, o ninguna. */
function resolveNewPacking(raw: unknown, oldPacking: DeliveryPackingGroup[], oldQty: number, newQty: number): DeliveryPackingGroup[] {
  if (raw !== undefined) {
    const chk = validateDeliveryPacking(raw ?? [], newQty);
    if (!chk.ok) throw new PlanningValidationError(chk.error);
    return chk.groups;
  }
  if (oldPacking.length > 0 && Math.abs(newQty - oldQty) > DELIVERY_EPSILON) {
    throw new PlanningValidationError(`Cambiaste la cantidad: actualizá también el desglose de cajas (hoy suma ${packingTotals(oldPacking).unidades} u. y la entrega pasa a ${newQty} u.).`);
  }
  return oldPacking;
}

async function runMutation(actor: PlanningActor, input: MutationInput): Promise<InternalDeliveryMutationResult> {
  if (input.kind !== "PRODUCCION" && input.kind !== "CODIFICADO") throw new PlanningValidationError("Tipo de entrega inválido.");
  const id = String(input.id ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new PlanningValidationError("Identificador de entrega inválido.");
  if (!canViewInternalDeliveries(sectorOf(actor))) throw new PlanningForbiddenError("No tenés permiso para modificar entregas internas.");
  return getDb().transaction(async (tx: Tx) => (input.kind === "PRODUCCION" ? mutateLine(tx, actor, { ...input, id }) : mutateTransfer(tx, actor, { ...input, id })));
}

const FORBIDDEN_MSG = "Solo podés modificar las entregas de tu propio sector. Producción puede modificar las de todos los sectores.";

// ─────────────────────────── Entregas a Producción (renglones de entrega) ───────────────────────────

async function mutateLine(tx: Tx, actor: PlanningActor, input: MutationInput): Promise<InternalDeliveryMutationResult> {
  const [peek] = await tx.select().from(workItemDeliveryLines).where(eq(workItemDeliveryLines.id, input.id)).limit(1);
  if (!peek) throw new PlanningNotFoundError("Entrega no encontrada.");
  // Serializa con cualquier otra entrega/edición del MISMO trabajo.
  const [item] = await tx.select().from(workItems).where(eq(workItems.id, peek.workItemId)).for("update").limit(1);
  if (!item) throw new PlanningNotFoundError("Trabajo no encontrado.");
  const [line] = await tx.select().from(workItemDeliveryLines).where(eq(workItemDeliveryLines.id, input.id)).limit(1);
  if (!canManageInternalDelivery(sectorOf(actor), line.sourceSector)) throw new PlanningForbiddenError(FORBIDDEN_MSG);
  if (line.status !== "ACTIVA") throw new PlanningValidationError("Esta entrega ya está cancelada: no se puede modificar.");
  assertVersion(input.expectedVersion, await currentVersion(tx, "PRODUCCION", line.id));

  const unit = String(item.unit ?? line.unit ?? "");
  const now = new Date();
  const actorName = actor.displayName || actor.email;
  const oldQty = Number(line.quantity);
  const oldObs: string | null = line.observations ?? null;
  const cancel = input.mode === "cancel";
  const newQty = cancel ? 0 : input.quantity != null && input.quantity !== "" ? parseNewQuantity(input.quantity, unit) : oldQty;
  const newObs = cancel ? oldObs : input.observations !== undefined ? cleanObservation(input.observations) : oldObs;
  const oldPacking = asGroups(line.packingGroups);
  const newPacking = cancel ? oldPacking : resolveNewPacking(input.packingGroups, oldPacking, oldQty, newQty);
  if (!cancel && Math.abs(newQty - oldQty) <= DELIVERY_EPSILON && newObs === oldObs && samePacking(newPacking, oldPacking)) throw new PlanningValidationError("No hay cambios para guardar.");
  // Una entrega que ya figura en un remito vigente no se modifica en silencio: el remito histórico se corrige con su propio mecanismo.
  const inRemito = (await loadRemitoLinks(tx, [line.id])).get(line.id);
  if (inRemito) {
    throw new PlanningValidationError(
      `Esta entrega ya figura en el remito ${inRemito.number ?? "(borrador)"} (${inRemito.status}). Para corregirla, anulá o reemplazá primero ese remito: el documento no se modifica en silencio.`
    );
  }

  const activeLines: Array<typeof line> = await tx
    .select()
    .from(workItemDeliveryLines)
    .where(and(eq(workItemDeliveryLines.workItemId, item.id), eq(workItemDeliveryLines.status, "ACTIVA")))
    .orderBy(asc(workItemDeliveryLines.sequence), asc(workItemDeliveryLines.createdAt));
  const others = activeLines.filter((l) => l.id !== line.id).reduce((s, l) => s + Number(l.quantity), 0);
  const toCod = await sumActiveCodificadoTransfers(tx, item.id);
  const wasCompleteBefore = activeLines.reduce((s, l) => s + Number(l.quantity), 0) + toCod >= (resolveTarget(item, item.finishedQty, unit) ?? Infinity) - DELIVERY_EPSILON;

  // Tope de una corrección hacia arriba: lo recibido (trabajo de Codificado vinculado) o lo realizado; si se excede lo realizado, la
  // corrección MISMA declara esas unidades como realizadas (queda en el historial). Nunca se reduce lo ya registrado.
  const finishedBefore: string | null = item.finishedQty ?? null;
  let finishedAfter = finishedBefore;
  let notice: string | null = null;
  if (!cancel && newQty > oldQty + DELIVERY_EPSILON) {
    if (item.parentWorkItemId) {
      const received = await sumActiveCodificadoTransfers(tx, item.parentWorkItemId);
      if (others + newQty > received + DELIVERY_EPSILON) {
        throw new PlanningValidationError(`Codificado solo recibió ${fmtQtyFor(unit, received)} unidades: no se pueden entregar ${fmtQtyFor(unit, others + newQty)}.`);
      }
    } else {
      const newOut = others + newQty + toCod;
      const known = parseQuantity(item.finishedQty, unit);
      const base = known ?? resolveTarget(item, item.finishedQty, unit) ?? 0;
      if (newOut > base + DELIVERY_EPSILON) {
        finishedAfter = fmtQtyFor(unit, newOut);
        notice = `Se registraron ${fmtQtyFor(unit, newOut)} unidades realizadas en el trabajo.`;
      }
    }
  }

  // Estado recalculado de todo el trabajo (sin la entrega cancelada / con la cantidad nueva).
  const target = item.parentWorkItemId ? await sumActiveCodificadoTransfers(tx, item.parentWorkItemId) : resolveTarget(item, finishedAfter, unit);
  const nextQuantities = activeLines.filter((l) => !(cancel && l.id === line.id)).map((l) => ({ id: l.id, q: l.id === line.id ? newQty : Number(l.quantity) }));
  const cum = nextQuantities.reduce((s, l) => s + l.q, 0);
  const complete = nextQuantities.length > 0 && (target != null ? cum + toCod >= target - DELIVERY_EPSILON : true);

  // Una entrega sincronizada con otras programaciones del mismo trabajo no puede dejar de estar completa sin cancelarla entera.
  if (wasCompleteBefore && !complete && nextQuantities.length > 0) {
    const [sib] = await tx
      .select({ id: workItemDeliveries.id })
      .from(workItemDeliveries)
      .where(and(like(workItemDeliveries.observations, `%${syncObsMark(item.id)}%`), eq(workItemDeliveries.status, "ENTREGADO"), eq(workItemDeliveries.archived, false)))
      .limit(1);
    if (sib) throw new PlanningValidationError("Esta entrega está sincronizada con otras programaciones del mismo trabajo: cancelá la entrega completa en lugar de reducirla.");
  }

  // 1) la entrega
  if (cancel) {
    await tx.update(workItemDeliveryLines).set({ status: "ANULADA", annulledAt: now, annulledBy: actorName }).where(eq(workItemDeliveryLines.id, line.id));
  } else {
    await tx.update(workItemDeliveryLines).set({ quantity: newQty, observations: newObs, packingGroups: newPacking.length > 0 ? newPacking : null }).where(eq(workItemDeliveryLines.id, line.id));
  }
  // 2) acumulados y saldos de las entregas que siguen vigentes (en orden), sin duplicar nada
  let running = 0;
  for (let i = 0; i < nextQuantities.length; i++) {
    const q = nextQuantities[i]!;
    running += q.q;
    const last = i === nextQuantities.length - 1;
    await tx
      .update(workItemDeliveryLines)
      .set({
        cumulativeAfter: running,
        pendingAfter: complete || target == null ? 0 : Math.max(0, target - running - toCod),
        kind: last && complete ? "FINAL" : "PARCIAL",
      })
      .where(eq(workItemDeliveryLines.id, q.id));
  }
  // 3) agregado (entrega vigente del trabajo) y estado del trabajo
  const pendingNow = complete || target == null ? 0 : Math.max(0, target - cum - toCod);
  if (nextQuantities.length === 0) {
    // No queda ninguna entrega vigente: se anula el agregado (y las entregas sincronizadas del mismo trabajo); permite entregar de nuevo.
    await annulDeliveryInTx(tx, line.deliveryId, `Se canceló la última entrega registrada: ${input.reason ?? ""}`.slice(0, 500), actorName);
  } else {
    await tx
      .update(workItemDeliveries)
      .set({
        quantity: fmtQtyFor(unit, cum),
        finishedQty: finishedAfter ?? undefined,
        deliveryComplete: complete,
        pendingBalance: complete ? null : pendingNow,
        // Resumen de cajas de la entrega vigente = suma de las cajas de sus entregas activas (cada tipo de caja por separado).
        packingGroups: (() => {
          const merged = mergePackingGroups(nextQuantities.map((q) => (q.id === line.id ? newPacking : asGroups(activeLines.find((l) => l.id === q.id)?.packingGroups))));
          return merged.length > 0 ? merged : null;
        })(),
        updatedAt: now,
      })
      .where(eq(workItemDeliveries.id, line.deliveryId));
    await tx
      .update(workItems)
      .set({
        ...(finishedAfter !== finishedBefore ? { finishedQty: finishedAfter } : {}),
        operationalStatus: complete ? "entregado" : item.operationalStatus === "revision" ? "revision" : "en_curso",
        ...(complete ? {} : { completedAt: null, completedBy: null }),
        progressUpdatedAt: now,
        progressUpdatedBy: actorName,
        version: sql`${workItems.version} + 1`,
        updatedAt: now,
      })
      .where(eq(workItems.id, item.id));
  }
  if (nextQuantities.length === 0 && finishedAfter !== finishedBefore) {
    await tx.update(workItems).set({ finishedQty: finishedAfter }).where(eq(workItems.id, item.id));
  }

  await tx.insert(internalDeliveryChanges).values({
    kind: "PRODUCCION",
    deliveryId: line.id,
    workItemId: item.id,
    action: cancel ? "CANCELAR" : "EDITAR",
    oldQuantity: oldQty,
    newQuantity: cancel ? null : newQty,
    oldObservations: oldObs,
    newObservations: cancel ? oldObs : newObs,
    finishedBefore,
    finishedAfter,
    oldPacking: oldPacking.length > 0 ? oldPacking : null,
    newPacking: cancel ? null : newPacking.length > 0 ? newPacking : null,
    reason: cancel ? (input.reason ?? null) : null,
    actorEmail: actor.email,
    actorName,
    actorSector: sectorOf(actor),
  });
  await tx.insert(operationalEvents).values({
    workItemId: item.id,
    planningWeekId: item.planningWeekId,
    type: cancel ? "DELIVERY_CANCELLED" : "DELIVERY_EDITED",
    fromStatus: item.operationalStatus,
    toStatus: nextQuantities.length === 0 ? "revision" : complete ? "entregado" : "en_curso",
    actorEmail: actor.email,
    actorSector: actor.sector,
    note: `entrega #${line.sequence}: ${fmtQtyFor(unit, oldQty)} → ${cancel ? "cancelada" : fmtQtyFor(unit, newQty)} | acumulado=${fmtQtyFor(unit, cum)}`.slice(0, 500),
  });

  const delivery = await loadOne(tx, actor, "PRODUCCION", line.id);
  return { delivery, totals: { delivered: cum, transferredToCodificado: toCod, finishedQty: finishedAfter }, notice };
}

function resolveTarget(item: { unit: string; deliverableUnits: number | null; packagingTotalUnits: number | null; plannedQuantity: string }, finishedQty: string | null, unit: string): number | null {
  return resolveDeliveryTarget({
    unit,
    deliverableUnits: item.deliverableUnits,
    packagingTotalUnits: item.packagingTotalUnits != null ? Number(item.packagingTotalUnits) : null,
    finishedQty,
    plannedQuantity: item.plannedQuantity,
  });
}

// ─────────────────────────── Entregas a Codificado (movimientos internos) ───────────────────────────

async function mutateTransfer(tx: Tx, actor: PlanningActor, input: MutationInput): Promise<InternalDeliveryMutationResult> {
  const [peek] = await tx.select().from(workItemCodificadoTransfers).where(eq(workItemCodificadoTransfers.id, input.id)).limit(1);
  if (!peek) throw new PlanningNotFoundError("Entrega no encontrada.");
  // Orden de bloqueo = el de la entrega parcial (Envasado y después Codificado): sin interbloqueos.
  const [parent] = await tx.select().from(workItems).where(eq(workItems.id, peek.workItemId)).for("update").limit(1);
  if (!parent) throw new PlanningNotFoundError("Trabajo de Envasado no encontrado.");
  const [child] = await tx.select().from(workItems).where(eq(workItems.id, peek.codificadoItemId)).for("update").limit(1);
  const [transfer] = await tx.select().from(workItemCodificadoTransfers).where(eq(workItemCodificadoTransfers.id, input.id)).limit(1);
  if (!canManageInternalDelivery(sectorOf(actor), transfer.originSector)) throw new PlanningForbiddenError(FORBIDDEN_MSG);
  if (transfer.status !== "ACTIVA") throw new PlanningValidationError("Esta entrega ya está cancelada: no se puede modificar.");
  assertVersion(input.expectedVersion, await currentVersion(tx, "CODIFICADO", transfer.id));

  const unit = String(parent.unit ?? "");
  const now = new Date();
  const actorName = actor.displayName || actor.email;
  const cancel = input.mode === "cancel";
  const oldQty = Number(transfer.quantity);
  const oldObs: string | null = transfer.note ?? null;
  const newQty = cancel ? 0 : input.quantity != null && input.quantity !== "" ? parseNewQuantity(input.quantity, unit) : oldQty;
  const newObs = cancel ? oldObs : input.observations !== undefined ? cleanObservation(input.observations) : oldObs;
  const oldPacking = asGroups(transfer.packingGroups);
  const newPacking = cancel ? oldPacking : resolveNewPacking(input.packingGroups, oldPacking, oldQty, newQty);
  if (!cancel && Math.abs(newQty - oldQty) <= DELIVERY_EPSILON && newObs === oldObs && samePacking(newPacking, oldPacking)) throw new PlanningValidationError("No hay cambios para guardar.");

  const active: Array<typeof transfer> = await tx
    .select()
    .from(workItemCodificadoTransfers)
    .where(and(eq(workItemCodificadoTransfers.workItemId, parent.id), eq(workItemCodificadoTransfers.status, "ACTIVA")))
    .orderBy(asc(workItemCodificadoTransfers.seq));
  const oldTransferred = active.reduce((s, t) => s + Number(t.quantity), 0);
  const othersTransferred = oldTransferred - oldQty;
  const newTransferred = othersTransferred + (cancel ? 0 : newQty);
  const deliveredToProd = await sumActiveDeliveredUnits(tx, parent.id);
  const assigned = parseQuantity(parent.plannedQuantity, unit) ?? 0;

  // Protección: Codificado no puede quedar con menos unidades recibidas que las que ya procesó (codificó o entregó).
  const coded = child ? (parseQuantity(child.finishedQty, unit) ?? 0) : 0;
  const deliveredByCod = child ? await sumActiveDeliveredUnits(tx, child.id) : 0;
  const processed = Math.max(coded, deliveredByCod);
  if (newTransferred < processed - DELIVERY_EPSILON) {
    throw new PlanningValidationError(`No se puede ${cancel ? "cancelar" : "reducir"} esta entrega porque Codificado ya procesó ${fmtQtyFor(unit, processed)} unidades.`);
  }

  // Corrección hacia arriba: no más que lo realizado; si lo supera, la corrección declara esas unidades como realizadas (auditado).
  const finishedBefore: string | null = parent.finishedQty ?? null;
  let finishedAfter = finishedBefore;
  let notice: string | null = null;
  if (!cancel && newQty > oldQty + DELIVERY_EPSILON) {
    const newOut = deliveredToProd + newTransferred;
    const known = parseQuantity(parent.finishedQty, unit);
    const base = known ?? assigned;
    if (newOut > base + DELIVERY_EPSILON) {
      finishedAfter = fmtQtyFor(unit, newOut);
      notice = `Se registraron ${fmtQtyFor(unit, newOut)} unidades realizadas en el trabajo.`;
    }
  }

  if (cancel) {
    await tx.update(workItemCodificadoTransfers).set({ status: "ANULADA" }).where(eq(workItemCodificadoTransfers.id, transfer.id));
  } else {
    await tx.update(workItemCodificadoTransfers).set({ quantity: newQty, note: newObs, packingGroups: newPacking.length > 0 ? newPacking : null }).where(eq(workItemCodificadoTransfers.id, transfer.id));
  }
  // Acumulados y pendientes de las entregas vigentes, recalculados en orden.
  let running = 0;
  for (const t of active) {
    if (cancel && t.id === transfer.id) continue;
    running += t.id === transfer.id ? newQty : Number(t.quantity);
    await tx
      .update(workItemCodificadoTransfers)
      .set({ cumulative: running, pending: Math.max(0, assigned - deliveredToProd - running) })
      .where(eq(workItemCodificadoTransfers.id, t.id));
  }

  // Estado del trabajo de Envasado: «completo» solo mientras ya salió todo lo asignado (igual que al entregar).
  const wasFullyOut = assigned - (deliveredToProd + oldTransferred) <= DELIVERY_EPSILON;
  const fullyOut = assigned - (deliveredToProd + newTransferred) <= DELIVERY_EPSILON;
  const parentSet: Record<string, unknown> = { version: sql`${workItems.version} + 1`, updatedAt: now };
  if (finishedAfter !== finishedBefore) parentSet.finishedQty = finishedAfter;
  if (fullyOut && parent.operationalStatus !== "completo" && parent.operationalStatus !== "entregado") Object.assign(parentSet, { operationalStatus: "completo", completedAt: now, completedBy: actorName });
  if (!fullyOut && wasFullyOut && parent.operationalStatus === "completo") Object.assign(parentSet, { operationalStatus: "en_curso", completedAt: null, completedBy: null });
  await tx.update(workItems).set(parentSet).where(eq(workItems.id, parent.id));
  // Si Codificado se queda sin nada recibido, su trabajo vinculado se marca cancelado (una nueva entrega lo reactiva).
  if (child) {
    const childSet: Record<string, unknown> = { version: sql`${workItems.version} + 1`, updatedAt: now };
    if (newTransferred <= DELIVERY_EPSILON) Object.assign(childSet, { codificadoCancelledAt: now, codificadoCancelledBy: actorName, codificadoCancelReason: `Se cancelaron todas las entregas recibidas${input.reason ? `: ${input.reason}` : ""}`.slice(0, 500) });
    await tx.update(workItems).set(childSet).where(eq(workItems.id, child.id));
  }

  await tx.insert(internalDeliveryChanges).values({
    kind: "CODIFICADO",
    deliveryId: transfer.id,
    workItemId: parent.id,
    action: cancel ? "CANCELAR" : "EDITAR",
    oldQuantity: oldQty,
    newQuantity: cancel ? null : newQty,
    oldObservations: oldObs,
    newObservations: cancel ? oldObs : newObs,
    finishedBefore,
    finishedAfter,
    oldPacking: oldPacking.length > 0 ? oldPacking : null,
    newPacking: cancel ? null : newPacking.length > 0 ? newPacking : null,
    reason: cancel ? (input.reason ?? null) : null,
    actorEmail: actor.email,
    actorName,
    actorSector: sectorOf(actor),
  });
  const note = `entrega a Codificado #${transfer.seq}: ${fmtQtyFor(unit, oldQty)} → ${cancel ? "cancelada" : fmtQtyFor(unit, newQty)} | recibidas=${fmtQtyFor(unit, newTransferred)}`.slice(0, 500);
  await tx.insert(operationalEvents).values({ workItemId: parent.id, planningWeekId: parent.planningWeekId, type: cancel ? "CODIFICADO_TRANSFER_CANCELLED" : "CODIFICADO_TRANSFER_EDITED", fromStatus: parent.sector, toStatus: fullyOut ? "ENTREGA_A_CODIFICADO_COMPLETA" : "ENTREGA_A_CODIFICADO_PARCIAL", actorEmail: actor.email, actorSector: actor.sector, note });
  if (child) await tx.insert(operationalEvents).values({ workItemId: child.id, planningWeekId: child.planningWeekId, type: cancel ? "CODIFICADO_RECEIVED_CANCELLED" : "CODIFICADO_RECEIVED_EDITED", fromStatus: parent.sector, toStatus: "EN_CODIFICADO", actorEmail: actor.email, actorSector: actor.sector, note });

  const delivery = await loadOne(tx, actor, "CODIFICADO", transfer.id);
  return { delivery, totals: { delivered: deliveredToProd, transferredToCodificado: newTransferred, finishedQty: finishedAfter }, notice };
}

// ─────────────────────────── Editar un TRABAJO ENTREGADO (Producción → Entregados) ───────────────────────────

export type DeliveredWorkEdit = {
  /** Id de la entrega (renglón) a corregir. */
  id: string;
  quantity?: number | string | null;
  observations?: string | null;
  packingGroups?: unknown;
  expectedVersion?: number | null;
};

export type DeliveredWorkResult = {
  workItemId: string;
  deliveries: InternalDeliveryDto[];
  /** Totales ACTIVOS del trabajo ya recalculados: unidades y cajas entregadas. */
  totals: { delivered: number; cajas: number; groups: DeliveryPackingGroup[]; transferredToCodificado: number; finishedQty: string | null };
  notice: string | null;
};

/**
 * Corrige un trabajo que YA está entregado (sin devolverlo a Pendientes): cantidad, cajas, unidades por caja, distribución y
 * observaciones de una o más de sus entregas, TODO en una transacción y reutilizando la misma lógica (y la misma auditoría) que la
 * edición de entregas internas: no se crea ninguna entrega nueva, no se duplican unidades y la cantidad pedida no se toca.
 * Solo Producción / Dirección.
 */
export async function editDeliveredWork(actor: PlanningActor, input: { workItemId: string; edits: DeliveredWorkEdit[] }): Promise<DeliveredWorkResult> {
  if (!isAdminSector(sectorOf(actor))) throw new PlanningForbiddenError("Solo Producción puede corregir un trabajo ya entregado.");
  const workItemId = String(input.workItemId ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workItemId)) throw new PlanningValidationError("Identificador de trabajo inválido.");
  const edits = Array.isArray(input.edits) ? input.edits : [];
  if (edits.length === 0) throw new PlanningValidationError("No hay cambios para guardar.");
  if (new Set(edits.map((e) => e.id)).size !== edits.length) throw new PlanningValidationError("Una entrega aparece dos veces en los cambios.");
  return getDb().transaction(async (tx: Tx) => {
    const own: Array<{ id: string }> = await tx.select({ id: workItemDeliveryLines.id }).from(workItemDeliveryLines).where(eq(workItemDeliveryLines.workItemId, workItemId));
    const ids = new Set(own.map((o) => o.id));
    let notice: string | null = null;
    for (const e of edits) {
      if (!ids.has(String(e.id))) throw new PlanningValidationError("Una de las entregas no pertenece a este trabajo.");
      const r = await mutateLine(tx, actor, { kind: "PRODUCCION", id: String(e.id), mode: "edit", quantity: e.quantity, observations: e.observations, packingGroups: e.packingGroups, expectedVersion: e.expectedVersion });
      notice = r.notice ?? notice;
    }
    const lines = await loadLineRows(tx, eq(workItemDeliveryLines.workItemId, workItemId), 500);
    const deliveries = await decorate(tx, actor, lines.sort((a, b) => a.sequence - b.sequence));
    const active = deliveries.filter((d) => d.status === "ACTIVA");
    const [item] = await tx.select({ finishedQty: workItems.finishedQty }).from(workItems).where(eq(workItems.id, workItemId)).limit(1);
    const groups = mergePackingGroups(active.map((d) => d.packingGroups));
    return {
      workItemId,
      deliveries,
      totals: { delivered: active.reduce((s, d) => s + d.quantity, 0), cajas: packingTotals(groups).cajas, groups, transferredToCodificado: await sumActiveCodificadoTransfers(tx, workItemId), finishedQty: item?.finishedQty ?? null },
      notice,
    };
  });
}

/**
 * Entregas HISTÓRICAS (anteriores al seguimiento por renglones: la entrega no tiene renglones): se corrige el registro de la entrega
 * (cantidad, cajas, observaciones) con auditoría. No se crea ningún renglón ni se toca el pedido. Solo Producción / Dirección.
 */
export async function editLegacyDelivery(
  actor: PlanningActor,
  input: { deliveryId: string; quantity?: number | string | null; observations?: string | null; packingGroups?: unknown }
): Promise<{ deliveryId: string; quantity: string | null; observations: string | null; packingGroups: DeliveryPackingGroup[]; cajas: number }> {
  if (!isAdminSector(sectorOf(actor))) throw new PlanningForbiddenError("Solo Producción puede corregir un trabajo ya entregado.");
  const id = String(input.deliveryId ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new PlanningValidationError("Identificador de entrega inválido.");
  return getDb().transaction(async (tx: Tx) => {
    const [d] = await tx.select().from(workItemDeliveries).where(eq(workItemDeliveries.id, id)).for("update").limit(1);
    if (!d || d.status !== "ENTREGADO" || d.archived) throw new PlanningNotFoundError("Entrega no encontrada o ya no está vigente.");
    const [anyLine] = await tx.select({ id: workItemDeliveryLines.id }).from(workItemDeliveryLines).where(eq(workItemDeliveryLines.deliveryId, d.id)).limit(1);
    if (anyLine) throw new PlanningValidationError("Esta entrega tiene renglones: corregila entrega por entrega.");
    const unit = String(d.unit ?? "");
    const oldQty = parseQuantity(d.quantity, unit);
    const newQty = input.quantity != null && input.quantity !== "" ? parseNewQuantity(input.quantity, unit) : oldQty;
    if (newQty == null) throw new PlanningValidationError("La cantidad entregada debe ser un número mayor que 0.");
    const oldObs: string | null = d.observations ?? null;
    const newObs = input.observations !== undefined ? cleanObservation(input.observations) : oldObs;
    const oldPacking = asGroups(d.packingGroups);
    const newPacking = resolveNewPacking(input.packingGroups, oldPacking, oldQty ?? newQty, newQty);
    if (oldQty != null && Math.abs(newQty - oldQty) <= DELIVERY_EPSILON && newObs === oldObs && samePacking(newPacking, oldPacking)) throw new PlanningValidationError("No hay cambios para guardar.");
    const now = new Date();
    const actorName = actor.displayName || actor.email;
    await tx
      .update(workItemDeliveries)
      .set({ quantity: fmtQtyFor(unit, newQty), observations: newObs, packingGroups: newPacking.length > 0 ? newPacking : null, updatedAt: now })
      .where(eq(workItemDeliveries.id, d.id));
    await tx.insert(internalDeliveryChanges).values({
      kind: "ENTREGA",
      deliveryId: d.id,
      workItemId: d.workItemId,
      action: "EDITAR",
      oldQuantity: oldQty,
      newQuantity: newQty,
      oldObservations: oldObs,
      newObservations: newObs,
      oldPacking: oldPacking.length > 0 ? oldPacking : null,
      newPacking: newPacking.length > 0 ? newPacking : null,
      actorEmail: actor.email,
      actorName,
      actorSector: sectorOf(actor),
    });
    await tx.insert(operationalEvents).values({ workItemId: d.workItemId, type: "DELIVERY_EDITED", fromStatus: "entregado", toStatus: "entregado", actorEmail: actor.email, actorSector: actor.sector, note: `entrega histórica: ${oldQty ?? "s/d"} → ${fmtQtyFor(unit, newQty)}`.slice(0, 500) });
    return { deliveryId: d.id, quantity: fmtQtyFor(unit, newQty), observations: newObs, packingGroups: newPacking, cajas: packingTotals(newPacking).cajas };
  });
}
