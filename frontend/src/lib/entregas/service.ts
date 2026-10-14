import "server-only";

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { OrdersForbiddenError, OrdersNotFoundError, OrdersUnavailableError, OrdersValidationError } from "@/lib/orders/types";
import { applyWorkItemCellChanges } from "@/lib/planning/work-item-cells-service";
import type { WorkItemCellChange } from "@/lib/planning/work-item-cell-edit";
import {
  canManageEntregas,
  canViewEntregas,
  DELIVERY_SECTOR_LABEL,
  EntregasConflictError,
  entregasVisibleSector,
  type DeliveryHistoryEntry,
  type DeliverySector,
  type DeliverySuggestion,
  type LinkedWork,
  type ScheduledDelivery,
  type ScheduledDeliveryItem,
  type WorkDivergence,
} from "./types";
import {
  clientKey,
  computeWorkDivergences,
  deriveDeliveryStatus,
  deriveItemStatus,
  matchDeliveryCandidates,
  validateDeliveryInput,
  validateReason,
  type CleanDelivery,
  type DeliveryInput,
} from "./rules";

export type EntregasActor = { email: string; sector: string; displayName?: string };

type Row = Record<string, unknown>;
type SqlTx = { execute: (q: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }> };

const str = (v: unknown): string | null => (v == null || v === "" ? null : String(v));
const iso = (v: unknown): string => new Date(String(v)).toISOString();

function requireDb() {
  if (!isDatabaseConfigured()) {
    throw new OrdersUnavailableError("Entregas requiere la base de datos: no está configurada en este entorno.");
  }
  return getDb();
}

function assertView(actor: EntregasActor) {
  if (!canViewEntregas(actor.sector)) throw new OrdersForbiddenError("Tu sector no tiene acceso a Entregas.");
}
function assertManage(actor: EntregasActor) {
  if (!canManageEntregas(actor.sector)) throw new OrdersForbiddenError("Solo Producción puede crear, modificar o cancelar entregas.");
}

/** Auditoría en feature_audit_events (dominio «entregas»): quién, cuándo, qué y valores antes/después. */
async function audit(
  tx: SqlTx,
  actor: EntregasActor,
  event: { action: string; deliveryId: string; payload?: Record<string, unknown> }
): Promise<void> {
  await tx.execute(sql`
    insert into feature_audit_events (id, domain, action, actor_email, actor_sector, entity_id, idempotency_key, payload, created_at)
    values (${randomUUID()}::uuid, 'entregas', ${event.action}, ${actor.email}, ${actor.sector}, ${event.deliveryId}, null, ${JSON.stringify(event.payload ?? {})}::jsonb, now())
  `);
}

const DELIVERY_COLS = sql`
  d.id, d.client, to_char(d.delivery_date, 'YYYY-MM-DD') as delivery_date, d.responsible, d.notes, d.status, d.reschedule_count,
  d.version, d.cancelled_at, d.cancelled_by, d.cancel_reason, d.created_by, d.created_at, d.updated_at
`;

/** Carga entregas (con productos y trabajos vinculados frescos) y deriva los estados. Sin recorte por sector. */
async function loadDeliveries(db: { execute: SqlTx["execute"] }, where: ReturnType<typeof sql>): Promise<ScheduledDelivery[]> {
  const dRows = (await db.execute(sql`select ${DELIVERY_COLS} from scheduled_deliveries d where ${where} order by d.delivery_date, d.client`)).rows as Row[];
  if (dRows.length === 0) return [];
  const ids = dRows.map((r) => String(r.id));
  const idList = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);

  const iRows = (await db.execute(sql`
    select i.id, i.delivery_id, i.product, i.quantity, i.unit, i.sector,
           to_char(i.planned_production_date, 'YYYY-MM-DD') as planned_production_date,
           i.lot, i.vto, i.notes, i.position, i.version, i.created_at, i.updated_at
    from scheduled_delivery_items i
    where i.delivery_id in (${idList}) and i.deleted_at is null
    order by i.position, i.created_at
  `)).rows as Row[];
  const itemIds = iRows.map((r) => String(r.id));

  let wRows: Row[] = [];
  if (itemIds.length) {
    const itemList = sql.join(itemIds.map((i) => sql`${i}::uuid`), sql`, `);
    wRows = (await db.execute(sql`
      select l.id as link_id, l.item_id, l.work_item_id, l.linked_at, l.linked_by,
             w.client, w.product, w.sector, w.line,
             to_char(w.planned_date, 'YYYY-MM-DD') as planned_date, to_char(w.planned_date_to, 'YYYY-MM-DD') as planned_date_to,
             w.planned_quantity, w.unit, to_char(w.delivery_date, 'YYYY-MM-DD') as delivery_date, w.packaging_lote, w.packaging_vto,
             w.operational_status, w.quality_status, w.finished_qty, w.order_number, w.deleted_at, w.operational_cancelled_at,
             exists (select 1 from work_item_deliveries wd where wd.work_item_id = w.id and wd.status = 'ENTREGADO') as delivered
      from scheduled_delivery_links l
      join work_items w on w.id = l.work_item_id
      where l.unlinked_at is null and l.item_id in (${itemList})
      order by l.linked_at
    `)).rows as Row[];
  }

  const worksByItem = new Map<string, LinkedWork[]>();
  for (const r of wRows) {
    const w: LinkedWork = {
      linkId: String(r.link_id),
      workItemId: String(r.work_item_id),
      linkedAt: iso(r.linked_at),
      linkedBy: String(r.linked_by),
      client: str(r.client),
      product: str(r.product),
      sector: String(r.sector),
      line: str(r.line),
      plannedDate: str(r.planned_date),
      plannedDateTo: str(r.planned_date_to),
      plannedQuantity: str(r.planned_quantity),
      unit: str(r.unit),
      deliveryDate: str(r.delivery_date),
      packagingLote: str(r.packaging_lote),
      packagingVto: str(r.packaging_vto),
      operationalStatus: String(r.operational_status ?? "pendiente"),
      qualityStatus: String(r.quality_status ?? "pendiente"),
      finishedQty: str(r.finished_qty),
      orderNumber: str(r.order_number),
      delivered: Boolean(r.delivered),
      cancelled: Boolean(r.deleted_at) || Boolean(r.operational_cancelled_at) || r.operational_status === "cancelado",
    };
    const k = String(r.item_id);
    worksByItem.set(k, [...(worksByItem.get(k) ?? []), w]);
  }

  const itemsByDelivery = new Map<string, ScheduledDeliveryItem[]>();
  for (const r of iRows) {
    const item: ScheduledDeliveryItem = {
      id: String(r.id),
      deliveryId: String(r.delivery_id),
      product: String(r.product),
      quantity: str(r.quantity),
      unit: str(r.unit),
      sector: (str(r.sector) as DeliverySector | null) ?? null,
      plannedProductionDate: str(r.planned_production_date),
      lot: str(r.lot),
      vto: str(r.vto),
      notes: str(r.notes),
      position: Number(r.position ?? 0),
      version: Number(r.version ?? 1),
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
      works: worksByItem.get(String(r.id)) ?? [],
      status: "programada",
    };
    item.status = deriveItemStatus(item);
    const k = String(r.delivery_id);
    itemsByDelivery.set(k, [...(itemsByDelivery.get(k) ?? []), item]);
  }

  return dRows.map((r) => {
    const d: ScheduledDelivery = {
      id: String(r.id),
      client: String(r.client),
      deliveryDate: String(r.delivery_date),
      responsible: str(r.responsible),
      notes: str(r.notes),
      state: r.status === "cancelada" ? "cancelada" : "programada",
      rescheduleCount: Number(r.reschedule_count ?? 0),
      version: Number(r.version ?? 1),
      cancelledAt: r.cancelled_at ? iso(r.cancelled_at) : null,
      cancelledBy: str(r.cancelled_by),
      cancelReason: str(r.cancel_reason),
      createdBy: String(r.created_by),
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
      items: itemsByDelivery.get(String(r.id)) ?? [],
      status: "programada",
    };
    d.status = deriveDeliveryStatus(d);
    return d;
  });
}

/** Recorta lo que el sector no puede ver (Envasado: solo los productos de su sector). El recorte es del SERVIDOR. */
function restrictForActor(actor: EntregasActor, deliveries: ScheduledDelivery[]): ScheduledDelivery[] {
  const only = entregasVisibleSector(actor.sector);
  if (!only) return deliveries;
  return deliveries
    .map((d) => {
      const items = d.items.filter((i) => i.sector === only);
      const next: ScheduledDelivery = { ...d, items };
      next.status = deriveDeliveryStatus(next);
      return next;
    })
    .filter((d) => d.items.length > 0);
}

const isoDate = (v: string, label: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new OrdersValidationError(`${label} no es una fecha válida.`);
  return v;
};

export const entregasService = {
  /** Entregas con fecha entre `from` y `to` (inclusive). Incluye canceladas (se ven tachadas) para conservar historial. */
  async list(actor: EntregasActor, range: { from: string; to: string }): Promise<ScheduledDelivery[]> {
    assertView(actor);
    const db = requireDb();
    const from = isoDate(range.from, "Desde");
    const to = isoDate(range.to, "Hasta");
    const all = await loadDeliveries(db, sql`d.delivery_date between ${from}::date and ${to}::date`);
    return restrictForActor(actor, all);
  },

  async get(actor: EntregasActor, id: string): Promise<ScheduledDelivery> {
    assertView(actor);
    const db = requireDb();
    const [d] = restrictForActor(actor, await loadDeliveries(db, sql`d.id = ${id}::uuid`));
    if (!d) throw new OrdersNotFoundError("Entrega no encontrada.");
    return d;
  },

  async create(actor: EntregasActor, input: DeliveryInput): Promise<ScheduledDelivery> {
    assertManage(actor);
    const v = validateDeliveryInput(input);
    if (!v.ok) throw new OrdersValidationError(v.message);
    const db = requireDb();
    const c = v.value;
    const id = randomUUID();
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        insert into scheduled_deliveries (id, client, client_key, delivery_date, responsible, notes, created_by, created_by_sector)
        values (${id}::uuid, ${c.client}, ${clientKey(c.client)}, ${c.deliveryDate}::date, ${c.responsible}, ${c.notes}, ${actor.email}, ${actor.sector})
      `);
      await insertItems(tx, id, c.items, 0);
      await audit(tx, actor, { action: "create", deliveryId: id, payload: { after: snapshot(c) } });
    });
    return this.get(actor, id);
  },

  /**
   * Modifica cliente, observaciones, responsable y productos (agregar / editar / quitar). La FECHA no se cambia acá:
   * se usa «Reprogramar», que exige motivo. Quitar un producto con trabajos vinculados no está permitido.
   * Versión optimista: si otra persona modificó la entrega, se rechaza (nunca se pisa).
   */
  async update(actor: EntregasActor, id: string, input: DeliveryInput, expectedVersion: number): Promise<ScheduledDelivery> {
    assertManage(actor);
    const v = validateDeliveryInput(input);
    if (!v.ok) throw new OrdersValidationError(v.message);
    const c = v.value;
    const db = requireDb();
    await db.transaction(async (tx) => {
      const cur = await lockDelivery(tx, id);
      if (cur.status === "cancelada") throw new EntregasConflictError("La entrega está cancelada: no se puede modificar.");
      if (Number(cur.version) !== expectedVersion) throw new EntregasConflictError("Otra persona modificó esta entrega. Recargá y volvé a aplicar tu cambio.");
      if (c.deliveryDate !== cur.delivery_date) throw new OrdersValidationError("Para cambiar la fecha usá «Reprogramar» (queda con motivo en el historial).");

      const before = await loadDeliveries(tx, sql`d.id = ${id}::uuid`);
      const beforeItems = before[0]?.items ?? [];
      const keep = new Map(beforeItems.map((i) => [i.id, i]));
      const incomingIds = new Set(c.items.flatMap((i) => (i.id ? [i.id] : [])));
      for (const i of c.items) {
        if (i.id && !keep.has(i.id)) throw new OrdersValidationError("Un producto ya no existe en esta entrega. Recargá.");
      }
      for (const old of beforeItems) {
        if (!incomingIds.has(old.id) && old.works.some((w) => !w.cancelled)) {
          throw new EntregasConflictError(`«${old.product}» tiene trabajos vinculados: desvinculalos antes de quitarlo.`);
        }
      }
      await tx.execute(sql`
        update scheduled_deliveries set client = ${c.client}, client_key = ${clientKey(c.client)}, responsible = ${c.responsible}, notes = ${c.notes},
          version = version + 1, updated_at = now() where id = ${id}::uuid
      `);
      // Productos: se quitan (baja lógica), se actualizan y se agregan.
      for (const old of beforeItems) {
        if (!incomingIds.has(old.id)) {
          await tx.execute(sql`update scheduled_delivery_items set deleted_at = now(), deleted_by = ${actor.email}, updated_at = now() where id = ${old.id}::uuid`);
        }
      }
      let position = 0;
      for (const i of c.items) {
        if (i.id) {
          await tx.execute(sql`
            update scheduled_delivery_items set product = ${i.product}, quantity = ${i.quantity}, unit = ${i.unit}, sector = ${i.sector},
              planned_production_date = ${i.plannedProductionDate}::date, lot = ${i.lot}, vto = ${i.vto}, notes = ${i.notes},
              position = ${position}, version = version + 1, updated_at = now()
            where id = ${i.id}::uuid and delivery_id = ${id}::uuid
          `);
        } else {
          await insertItems(tx, id, [i], position);
        }
        position += 1;
      }
      await audit(tx, actor, {
        action: "update",
        deliveryId: id,
        payload: { before: snapshotFromDelivery(before[0]!), after: snapshot(c) },
      });
    });
    return this.get(actor, id);
  },

  /** Reprograma la fecha de entrega. Motivo obligatorio y auditado; no toca los trabajos (se muestran las diferencias). */
  async reschedule(actor: EntregasActor, id: string, newDate: string, reason: unknown, expectedVersion: number): Promise<ScheduledDelivery> {
    assertManage(actor);
    const date = isoDate(newDate, "La nueva fecha");
    const r = validateReason(reason);
    if (!r.ok) throw new OrdersValidationError(r.message);
    const db = requireDb();
    await db.transaction(async (tx) => {
      const cur = await lockDelivery(tx, id);
      if (cur.status === "cancelada") throw new EntregasConflictError("La entrega está cancelada: no se puede reprogramar.");
      if (Number(cur.version) !== expectedVersion) throw new EntregasConflictError("Otra persona modificó esta entrega. Recargá y volvé a aplicar tu cambio.");
      if (date === cur.delivery_date) throw new OrdersValidationError("La nueva fecha es igual a la actual.");
      await tx.execute(sql`
        update scheduled_deliveries set delivery_date = ${date}::date, reschedule_count = reschedule_count + 1, version = version + 1, updated_at = now()
        where id = ${id}::uuid
      `);
      await audit(tx, actor, { action: "reschedule", deliveryId: id, payload: { from: cur.delivery_date, to: date, reason: r.value } });
    });
    return this.get(actor, id);
  },

  /**
   * Cancela una entrega PROGRAMADA (queda como historial, nunca se borra). No es lo mismo que anular o eliminar una
   * entrega REAL: esas viven en «Entregados» y no se tocan. Los trabajos vinculados siguen su curso.
   */
  async cancel(actor: EntregasActor, id: string, reason: unknown, expectedVersion: number): Promise<ScheduledDelivery> {
    assertManage(actor);
    const r = validateReason(reason);
    if (!r.ok) throw new OrdersValidationError(r.message);
    const db = requireDb();
    await db.transaction(async (tx) => {
      const cur = await lockDelivery(tx, id);
      if (cur.status === "cancelada") return; // idempotente
      if (Number(cur.version) !== expectedVersion) throw new EntregasConflictError("Otra persona modificó esta entrega. Recargá y volvé a aplicar tu cambio.");
      await tx.execute(sql`
        update scheduled_deliveries set status = 'cancelada', cancelled_at = now(), cancelled_by = ${actor.email}, cancel_reason = ${r.value},
          version = version + 1, updated_at = now() where id = ${id}::uuid
      `);
      await audit(tx, actor, { action: "cancel", deliveryId: id, payload: { reason: r.value, previousDate: cur.delivery_date } });
    });
    return this.get(actor, id);
  },

  /** Vincula manualmente un trabajo existente con un producto de la entrega (Producción confirma). */
  async linkWork(actor: EntregasActor, itemId: string, workItemId: string): Promise<ScheduledDelivery> {
    assertManage(actor);
    const db = requireDb();
    let deliveryId = "";
    await db.transaction(async (tx) => {
      deliveryId = await linkWorkInTx(tx, actor, { itemId, workItemId, requireMatch: false });
    });
    return this.get(actor, deliveryId);
  },

  async unlinkWork(actor: EntregasActor, linkId: string, reason: unknown): Promise<ScheduledDelivery> {
    assertManage(actor);
    const r = validateReason(reason);
    if (!r.ok) throw new OrdersValidationError(r.message);
    const db = requireDb();
    let deliveryId = "";
    await db.transaction(async (tx) => {
      const res = (await tx.execute(sql`
        select l.id, l.item_id, l.work_item_id, l.unlinked_at, i.delivery_id
        from scheduled_delivery_links l join scheduled_delivery_items i on i.id = l.item_id
        where l.id = ${linkId}::uuid for update of l
      `)).rows as Row[];
      const row = res[0];
      if (!row) throw new OrdersNotFoundError("Vínculo no encontrado.");
      deliveryId = String(row.delivery_id);
      if (row.unlinked_at) return; // idempotente
      await tx.execute(sql`update scheduled_delivery_links set unlinked_at = now(), unlinked_by = ${actor.email}, unlink_reason = ${r.value} where id = ${linkId}::uuid`);
      await audit(tx, actor, { action: "unlink", deliveryId, payload: { itemId: String(row.item_id), workItemId: String(row.work_item_id), reason: r.value } });
    });
    return this.get(actor, deliveryId);
  },

  /** Entregas pendientes que coinciden con cliente + producto + sector (para «Asignar trabajo»). Nunca vincula solo. */
  async suggestions(actor: EntregasActor, criteria: { client: string; product: string; sector: string | null }): Promise<DeliverySuggestion[]> {
    assertManage(actor);
    const db = requireDb();
    if (!criteria.client.trim() || !criteria.product.trim()) return [];
    // Ventana: entregas desde hace 60 días en adelante (lo viejo sin trabajo ya no es candidato razonable).
    const all = await loadDeliveries(db, sql`d.status = 'programada' and d.delivery_date >= (current_date - interval '60 days')`);
    return matchDeliveryCandidates(all, criteria);
  },

  /** Diferencias entre lo programado y cada trabajo vinculado (solo lectura; se confirma antes de aplicar). */
  divergencesFor(delivery: ScheduledDelivery): Array<{ itemId: string; linkId: string; workItemId: string; divergences: WorkDivergence[] }> {
    const out: Array<{ itemId: string; linkId: string; workItemId: string; divergences: WorkDivergence[] }> = [];
    for (const it of delivery.items) {
      for (const w of it.works) {
        if (w.cancelled) continue;
        const divergences = computeWorkDivergences(delivery, it, w);
        if (divergences.length) out.push({ itemId: it.id, linkId: w.linkId, workItemId: w.workItemId, divergences });
      }
    }
    return out;
  },

  /**
   * Aplica al trabajo los cambios que Producción CONFIRMÓ (campos elegidos) usando la edición por celda canónica:
   * respeta protecciones, versión y motivo. Nunca toca la cantidad realizada ni los avances del operario.
   */
  async applyToWork(
    actor: EntregasActor,
    linkId: string,
    fields: string[],
    reason: unknown
  ): Promise<{ applied: string[]; delivery: ScheduledDelivery }> {
    assertManage(actor);
    const r = validateReason(reason);
    if (!r.ok) throw new OrdersValidationError(r.message);
    const db = requireDb();
    const linkRows = (await db.execute(sql`
      select l.id, i.delivery_id, l.work_item_id from scheduled_delivery_links l join scheduled_delivery_items i on i.id = l.item_id
      where l.id = ${linkId}::uuid and l.unlinked_at is null
    `)).rows as Row[];
    const link = linkRows[0];
    if (!link) throw new OrdersNotFoundError("Vínculo no encontrado.");
    const deliveryId = String(link.delivery_id);
    const [delivery] = await loadDeliveries(db, sql`d.id = ${deliveryId}::uuid`);
    if (!delivery) throw new OrdersNotFoundError("Entrega no encontrada.");
    if (delivery.state === "cancelada") throw new EntregasConflictError("La entrega está cancelada.");
    const item = delivery.items.find((i) => i.works.some((w) => w.linkId === linkId));
    const work = item?.works.find((w) => w.linkId === linkId);
    if (!item || !work) throw new OrdersNotFoundError("Vínculo no encontrado.");

    const divergences = computeWorkDivergences(delivery, item, work);
    const chosen = divergences.filter((d) => fields.includes(d.field));
    if (chosen.length === 0) throw new OrdersValidationError("No hay diferencias para aplicar (puede que ya estén al día).");

    const versionRow = (await db.execute(sql`select version from work_items where id = ${work.workItemId}::uuid`)).rows as Row[];
    const version = Number(versionRow[0]?.version ?? 0);
    const changes: WorkItemCellChange[] = chosen.map((d) => ({
      id: `native:${work.workItemId}`,
      field: d.field,
      value: d.itemValue,
      expectedVersion: version,
      reason: `Entrega programada ${delivery.client} (${delivery.deliveryDate}): ${r.value}`,
    }));
    const { results, ok } = await applyWorkItemCellChanges(
      { email: actor.email, sector: actor.sector, displayName: actor.displayName ?? actor.email },
      changes
    );
    if (!ok) {
      const first = results.find((x) => !x.ok) as { message?: string } | undefined;
      throw new EntregasConflictError(first?.message ?? "No se pudo aplicar el cambio al trabajo.");
    }
    await db.transaction(async (tx) => {
      await audit(tx, actor, {
        action: "apply_to_work",
        deliveryId,
        payload: { itemId: item.id, workItemId: work.workItemId, fields: chosen.map((d) => ({ field: d.field, from: d.workValue, to: d.itemValue })), reason: r.value },
      });
    });
    return { applied: chosen.map((d) => d.field), delivery: await this.get(actor, deliveryId) };
  },

  async history(actor: EntregasActor, deliveryId: string): Promise<DeliveryHistoryEntry[]> {
    assertView(actor);
    const db = requireDb();
    await this.get(actor, deliveryId); // valida visibilidad
    // El historial guarda la entrega COMPLETA (todos los productos y sectores): solo lo ve quien administra Entregas.
    // Envasado/Depósito consultan la entrega recortada, nunca el historial (evita filtrar productos de otro sector).
    if (!canManageEntregas(actor.sector)) return [];
    const rows = (await db.execute(sql`
      select id, action, actor_email, actor_sector, entity_id, payload, created_at
      from feature_audit_events where domain = 'entregas' and entity_id = ${deliveryId}
      order by created_at desc, id desc limit 200
    `)).rows as Row[];
    return rows.map((r) => ({
      id: String(r.id),
      action: String(r.action),
      actorEmail: String(r.actor_email),
      actorSector: String(r.actor_sector),
      entityId: str(r.entity_id),
      payload: (r.payload ?? {}) as Record<string, unknown>,
      createdAt: iso(r.created_at),
    }));
  },
};

// ───────────────────────── helpers de escritura ─────────────────────────

async function lockDelivery(tx: SqlTx, id: string): Promise<Row & { delivery_date: string }> {
  const res = (await tx.execute(sql`
    select id, status, version, to_char(delivery_date, 'YYYY-MM-DD') as delivery_date from scheduled_deliveries where id = ${id}::uuid for update
  `)).rows as Row[];
  const row = res[0];
  if (!row) throw new OrdersNotFoundError("Entrega no encontrada.");
  return row as Row & { delivery_date: string };
}

async function insertItems(tx: SqlTx, deliveryId: string, items: CleanDelivery["items"], startPosition: number) {
  let position = startPosition;
  for (const i of items) {
    await tx.execute(sql`
      insert into scheduled_delivery_items (id, delivery_id, product, quantity, unit, sector, planned_production_date, lot, vto, notes, position)
      values (${randomUUID()}::uuid, ${deliveryId}::uuid, ${i.product}, ${i.quantity}, ${i.unit}, ${i.sector}, ${i.plannedProductionDate}::date, ${i.lot}, ${i.vto}, ${i.notes}, ${position})
    `);
    position += 1;
  }
}

const snapshot = (c: CleanDelivery) => ({
  client: c.client,
  deliveryDate: c.deliveryDate,
  responsible: c.responsible,
  notes: c.notes,
  items: c.items.map((i) => ({ product: i.product, quantity: i.quantity, unit: i.unit, sector: i.sector, plannedProductionDate: i.plannedProductionDate, lot: i.lot, vto: i.vto, notes: i.notes })),
});
const snapshotFromDelivery = (d: ScheduledDelivery) => ({
  client: d.client,
  deliveryDate: d.deliveryDate,
  responsible: d.responsible,
  notes: d.notes,
  items: d.items.map((i) => ({ product: i.product, quantity: i.quantity, unit: i.unit, sector: i.sector, plannedProductionDate: i.plannedProductionDate, lot: i.lot, vto: i.vto, notes: i.notes })),
});

/**
 * Inserta el vínculo producto ↔ trabajo dentro de una transacción (la usa «Asignar trabajo» y la vinculación manual).
 * Valida: entrega no cancelada, producto vigente, sector compatible, trabajo vigente y no vinculado a otro producto
 * (índice único parcial: no se duplica), y —cuando viene de «Asignar trabajo»— que cliente y producto coincidan con
 * las mismas reglas con las que se sugirió. Idempotente: si ya estaba vinculado a este mismo producto, no hace nada.
 */
export async function linkWorkInTx(
  tx: SqlTx,
  actor: EntregasActor,
  params: { itemId: string; workItemId: string; requireMatch: boolean }
): Promise<string> {
  const itemRows = (await tx.execute(sql`
    select i.id, i.product, i.sector, i.deleted_at, d.id as delivery_id, d.client, d.status
    from scheduled_delivery_items i join scheduled_deliveries d on d.id = i.delivery_id
    where i.id = ${params.itemId}::uuid for update of d
  `)).rows as Row[];
  const item = itemRows[0];
  if (!item || item.deleted_at) throw new OrdersNotFoundError("El producto de la entrega ya no existe.");
  if (item.status === "cancelada") throw new EntregasConflictError("La entrega está cancelada: no se puede vincular.");
  const workRows = (await tx.execute(sql`
    select id, client, product, sector, deleted_at, operational_cancelled_at from work_items where id = ${params.workItemId}::uuid
  `)).rows as Row[];
  const work = workRows[0];
  if (!work || work.deleted_at || work.operational_cancelled_at) throw new OrdersNotFoundError("El trabajo no existe o fue cancelado/eliminado.");
  const sector = String(work.sector);
  if (sector !== "ENVASADO_MASIVO" && sector !== "ENVASADO_PREMIUM") {
    throw new OrdersValidationError("Solo se vinculan trabajos de Envasado Masivo o Premium.");
  }
  if (item.sector && String(item.sector) !== sector) {
    throw new OrdersValidationError(`Este producto es de ${DELIVERY_SECTOR_LABEL[String(item.sector) as DeliverySector]}: el trabajo es de ${DELIVERY_SECTOR_LABEL[sector as DeliverySector]}.`);
  }
  if (params.requireMatch) {
    const { clienteRelation, productoRelation } = await import("@/lib/asignacion-lotes/resolve-for-work-item");
    if (clienteRelation(String(work.client), String(item.client)) === "NONE" || productoRelation({ producto: String(item.product), codigo: "", marca: String(item.client) }, String(work.product)) === "NONE") {
      throw new OrdersValidationError("El trabajo no coincide con el cliente y producto de la entrega elegida.");
    }
  }
  const existing = (await tx.execute(sql`
    select id, item_id from scheduled_delivery_links where work_item_id = ${params.workItemId}::uuid and unlinked_at is null
  `)).rows as Row[];
  if (existing[0]) {
    if (String(existing[0].item_id) === params.itemId) return String(item.delivery_id); // idempotente
    throw new EntregasConflictError("Este trabajo ya está vinculado a otra entrega. Desvinculalo primero.");
  }
  await tx.execute(sql`
    insert into scheduled_delivery_links (id, item_id, work_item_id, linked_by, linked_by_sector)
    values (${randomUUID()}::uuid, ${params.itemId}::uuid, ${params.workItemId}::uuid, ${actor.email}, ${actor.sector})
  `);
  await audit(tx, actor, {
    action: "link",
    deliveryId: String(item.delivery_id),
    payload: { itemId: params.itemId, product: String(item.product), workItemId: params.workItemId, workSector: sector },
  });
  return String(item.delivery_id);
}

/** Datos de la entrega que «Asignar trabajo» usa para completar (solo lo vacío) campos del trabajo. */
export async function readDeliveryItemForAssignment(
  tx: SqlTx,
  itemId: string
): Promise<{ itemId: string; deliveryId: string; client: string; product: string; sector: DeliverySector | null; deliveryDate: string; unit: string | null; lot: string | null; vto: string | null; state: string; deleted: boolean } | null> {
  const rows = (await tx.execute(sql`
    select i.id, i.product, i.sector, i.unit, i.lot, i.vto, i.deleted_at, d.id as delivery_id, d.client, d.status,
           to_char(d.delivery_date, 'YYYY-MM-DD') as delivery_date
    from scheduled_delivery_items i join scheduled_deliveries d on d.id = i.delivery_id where i.id = ${itemId}::uuid
  `)).rows as Row[];
  const r = rows[0];
  if (!r) return null;
  return {
    itemId: String(r.id),
    deliveryId: String(r.delivery_id),
    client: String(r.client),
    product: String(r.product),
    sector: (str(r.sector) as DeliverySector | null) ?? null,
    deliveryDate: String(r.delivery_date),
    unit: str(r.unit),
    lot: str(r.lot),
    vto: str(r.vto),
    state: String(r.status),
    deleted: Boolean(r.deleted_at),
  };
}
