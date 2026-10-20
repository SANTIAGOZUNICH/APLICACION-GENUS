import "server-only";

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { parseQuantity } from "@/lib/planning/circuit/delivery-math";
import { OrdersForbiddenError, OrdersNotFoundError, OrdersValidationError } from "@/lib/orders/types";
import {
  computeBalances,
  computeDeliveryState,
  computeInvoicingState,
  isValidIsoDate,
  normalizeClientKey,
  normalizeInvoiceNumber,
  round6,
  validateInvoiceQuantity,
  type DeliveryState,
  type InvoicingState,
} from "./billing-state";

type Row = Record<string, unknown>;
type Tx = { execute: (q: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }> };

export type BillingActor = { email: string; sector: string; displayName?: string | null };

/** Administración registra y consulta; Producción y Dirección solo consultan. Nadie más entra. */
export const canWriteBilling = (sector: string) => String(sector).toUpperCase() === "ADMINISTRACION";
export const canReadBilling = (sector: string) => ["ADMINISTRACION", "PRODUCCION", "DIRECCION"].includes(String(sector).toUpperCase());

export function assertBillingRead(actor: BillingActor) {
  if (!canReadBilling(actor.sector)) throw new OrdersForbiddenError("Solo Administración (y Producción/Dirección en consulta) acceden al Control de facturación.");
}
export function assertBillingWrite(actor: BillingActor) {
  if (!canWriteBilling(actor.sector)) throw new OrdersForbiddenError("Solo Administración puede registrar facturación.");
}

const iso = (v: unknown): string | null => (v == null ? null : new Date(String(v)).toISOString());
const num = (v: unknown): number => (v == null ? 0 : Number(v));
const strArr = (v: unknown): string[] => (Array.isArray(v) ? (v as unknown[]).map(String).filter(Boolean) : []);

export type BillingRowView = {
  /** Id de la programación original (clave de la fila; agrupa programaciones de la misma OE/OA). */
  key: string;
  workItemIds: string[];
  client: string;
  pedido: string | null;
  product: string;
  orderRef: string | null;
  unit: string | null;
  requested: number | null;
  produced: number | null;
  delivered: number;
  pendingDelivery: number | null;
  invoiced: number;
  pendingInvoice: number;
  remitos: string[];
  invoices: string[];
  lastDeliveryAt: string | null;
  lastInvoiceDate: string | null;
  deliveryState: DeliveryState;
  invoicingState: InvoicingState;
  observations: string | null;
  incidence: string | null;
};

export type BillingFilters = {
  q?: string;
  client?: string;
  pedido?: string;
  product?: string;
  state?: string;
  deliveryState?: string;
  /** Rango de «última entrega» (YYYY-MM-DD, zona Buenos Aires). */
  from?: string;
  to?: string;
  workItemId?: string;
};

const BASE_ROWS = sql`
  with dl as (
    select work_item_id, sum(quantity)::float8 as delivered, max(actual_delivered_at) as last_at,
           array_remove(array_agg(distinct nullif(remito, '')), null) as remitos
      from work_item_delivery_lines where status = 'ACTIVA' group by work_item_id
  ), inv as (
    select il.work_item_id, sum(il.quantity)::float8 as invoiced, max(i.invoice_date)::text as last_date,
           array_agg(distinct i.invoice_number) as numbers,
           bool_or(l.id is null or l.status <> 'ACTIVA') as on_annulled
      from billing_invoice_lines il
      join billing_invoices i on i.id = il.invoice_id and i.status = 'ACTIVA'
      left join work_item_delivery_lines l on l.id = il.delivery_line_id
     where il.status = 'ACTIVA' group by il.work_item_id
  )
  select w.id::text as id, coalesce(w.schedule_root_id, w.id)::text as root_id, w.client, w.product, w.order_number, w.unit,
         w.planned_quantity, w.schedule_total, w.finished_qty, w.packaging_total_units, w.deliverable_units, w.sector,
         p.op as pedido_op, p.q as pedido_q,
         coalesce(dl.delivered, 0) as delivered, dl.last_at, coalesce(dl.remitos, '{}') as remitos,
         coalesce(inv.invoiced, 0) as invoiced, inv.last_date, coalesce(inv.numbers, '{}') as numbers, coalesce(inv.on_annulled, false) as on_annulled,
         (w.schedule_root_id is null) as is_root
    from work_items w
    left join production_pedidos p on p.id = w.production_pedido_id
    left join dl on dl.work_item_id = w.id
    left join inv on inv.work_item_id = w.id
   where w.deleted_at is null
     and (dl.work_item_id is not null or inv.work_item_id is not null
          or (w.sector in ('ENVASADO_MASIVO', 'ENVASADO_PREMIUM', 'CODIFICADO') and w.operational_status <> 'cancelado'))
`;

/** Agrupa las programaciones de una misma OE/OA en una sola fila y calcula cantidades y estados. */
export function buildBillingRows(raw: Row[], notes: Map<string, string>): BillingRowView[] {
  const groups = new Map<string, Row[]>();
  for (const r of raw) {
    const k = String(r.root_id);
    const list = groups.get(k);
    if (list) list.push(r);
    else groups.set(k, [r]);
  }
  const out: BillingRowView[] = [];
  for (const [key, members] of groups) {
    const root = members.find((m) => m.is_root === true) ?? members[0];
    const unit = root.unit == null ? null : String(root.unit);
    const delivered = round6(members.reduce((s, m) => s + num(m.delivered), 0));
    const invoiced = round6(members.reduce((s, m) => s + num(m.invoiced), 0));
    const pedidoQ = root.pedido_q == null ? null : Number(root.pedido_q);
    const planned = root.schedule_total != null ? parseQuantity(String(root.schedule_total), unit) : parseQuantity(root.planned_quantity as string, unit);
    const requested = pedidoQ != null && pedidoQ > 0 ? pedidoQ : members.length > 1 ? members.reduce((s, m) => s + (parseQuantity(m.planned_quantity as string, unit) ?? 0), 0) || null : planned;
    const produced = (() => {
      const d = root.deliverable_units != null ? Number(root.deliverable_units) : null;
      const p = root.packaging_total_units != null ? Number(root.packaging_total_units) : null;
      const f = parseQuantity(root.finished_qty as string, unit);
      return [d, p, f].find((x) => x != null && x > 0) ?? null;
    })();
    const onAnnulled = members.some((m) => m.on_annulled === true);
    const q = { requested, delivered, invoiced, hasIncidence: onAnnulled };
    const lastAt = members.map((m) => iso(m.last_at)).filter(Boolean).sort().pop() ?? null;
    const lastInv = members.map((m) => (m.last_date == null ? null : String(m.last_date))).filter(Boolean).sort().pop() ?? null;
    const bal = computeBalances(q);
    out.push({
      key,
      workItemIds: members.map((m) => String(m.id)),
      client: String(root.client ?? ""),
      pedido: root.pedido_op == null ? null : String(root.pedido_op),
      product: String(root.product ?? ""),
      orderRef: root.order_number == null ? null : String(root.order_number),
      unit,
      requested,
      produced,
      delivered,
      pendingDelivery: bal.pendingDelivery,
      invoiced,
      pendingInvoice: bal.pendingInvoice,
      remitos: [...new Set(members.flatMap((m) => strArr(m.remitos)))],
      invoices: [...new Set(members.flatMap((m) => strArr(m.numbers)))],
      lastDeliveryAt: lastAt,
      lastInvoiceDate: lastInv,
      deliveryState: computeDeliveryState(q),
      invoicingState: computeInvoicingState(q),
      observations: notes.get(key) ?? null,
      incidence: onAnnulled ? "Hay facturación sobre una entrega anulada." : invoiced > delivered + 1e-6 ? "Lo facturado supera lo entregado." : null,
    });
  }
  return out;
}

const buenosAiresDay = (isoDate: string | null): string | null =>
  isoDate ? new Date(isoDate).toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }) : null;

export function filterBillingRows(rows: BillingRowView[], f: BillingFilters): BillingRowView[] {
  const has = (hay: string | null | undefined, needle: string) => (hay ?? "").toLowerCase().includes(needle.toLowerCase());
  return rows.filter((r) => {
    if (f.workItemId && !r.workItemIds.includes(f.workItemId) && r.key !== f.workItemId) return false;
    if (f.client && !has(r.client, f.client)) return false;
    if (f.pedido && !has(r.pedido, f.pedido) && !has(r.orderRef, f.pedido)) return false;
    if (f.product && !has(r.product, f.product)) return false;
    if (f.state && f.state !== "TODOS" && r.invoicingState !== f.state) return false;
    if (f.deliveryState && f.deliveryState !== "TODOS" && r.deliveryState !== f.deliveryState) return false;
    const day = buenosAiresDay(r.lastDeliveryAt);
    if (f.from && (!day || day < f.from)) return false;
    if (f.to && (!day || day > f.to)) return false;
    if (f.q?.trim()) {
      const n = f.q.trim();
      const hit = [r.client, r.pedido, r.product, r.orderRef, ...r.remitos, ...r.invoices].some((x) => has(x, n));
      if (!hit) return false;
    }
    return true;
  });
}

async function loadNotes(db: Tx): Promise<Map<string, string>> {
  const res = await db.execute(sql`select work_item_id::text as id, observations from billing_work_notes where observations is not null and observations <> ''`);
  return new Map((res.rows as Row[]).map((r) => [String(r.id), String(r.observations)]));
}

export async function listBillingRows(actor: BillingActor, filters: BillingFilters = {}): Promise<BillingRowView[]> {
  assertBillingRead(actor);
  const db = getDb() as unknown as Tx;
  const [res, notes] = await Promise.all([db.execute(BASE_ROWS), loadNotes(db)]);
  const rows = buildBillingRows(res.rows as Row[], notes);
  const sorted = rows.sort((a, b) => (b.lastDeliveryAt ?? "").localeCompare(a.lastDeliveryAt ?? "") || a.client.localeCompare(b.client));
  return filterBillingRows(sorted, filters);
}

// ── Entregas facturables ─────────────────────────────────────────────────────────────────────────────────────────

export type BillableDelivery = {
  deliveryLineId: string;
  workItemId: string;
  client: string;
  product: string;
  pedido: string | null;
  orderRef: string | null;
  unit: string | null;
  quantity: number;
  invoiced: number;
  available: number;
  deliveredAt: string;
  remito: string | null;
  kind: string;
};

export async function listBillableDeliveries(actor: BillingActor, opts: { rootKey?: string; workItemId?: string; client?: string; onlyPending?: boolean }): Promise<BillableDelivery[]> {
  assertBillingRead(actor);
  const conds = [sql`l.status = 'ACTIVA'`, sql`w.deleted_at is null`];
  if (opts.rootKey) conds.push(sql`coalesce(w.schedule_root_id, w.id) = ${opts.rootKey}::uuid`);
  if (opts.workItemId) conds.push(sql`l.work_item_id = ${opts.workItemId}::uuid`);
  if (opts.client) conds.push(sql`lower(w.client) = ${normalizeClientKey(opts.client)}`);
  const res = await (getDb() as unknown as Tx).execute(sql`
    select l.id::text as id, l.work_item_id::text as work_item_id, w.client, w.product, w.order_number, d.pedido_op, l.unit, l.quantity::float8 as quantity,
           coalesce(i.invoiced, 0)::float8 as invoiced, l.actual_delivered_at, l.remito, l.kind
      from work_item_delivery_lines l
      join work_items w on w.id = l.work_item_id
      left join work_item_deliveries d on d.id = l.delivery_id
      left join (select il.delivery_line_id, sum(il.quantity) as invoiced
                   from billing_invoice_lines il join billing_invoices inv on inv.id = il.invoice_id
                  where il.status = 'ACTIVA' and inv.status = 'ACTIVA' group by il.delivery_line_id) i on i.delivery_line_id = l.id
     where ${sql.join(conds, sql` and `)}
     order by l.actual_delivered_at desc limit 500`);
  const out = (res.rows as Row[]).map((r) => {
    const quantity = num(r.quantity);
    const invoiced = num(r.invoiced);
    return {
      deliveryLineId: String(r.id),
      workItemId: String(r.work_item_id),
      client: String(r.client ?? ""),
      product: String(r.product ?? ""),
      pedido: r.pedido_op == null ? null : String(r.pedido_op),
      orderRef: r.order_number == null ? null : String(r.order_number),
      unit: r.unit == null ? null : String(r.unit),
      quantity,
      invoiced,
      available: Math.max(0, round6(quantity - invoiced)),
      deliveredAt: new Date(String(r.actual_delivered_at)).toISOString(),
      remito: r.remito == null || r.remito === "" ? null : String(r.remito),
      kind: String(r.kind ?? "PARCIAL"),
    };
  });
  return opts.onlyPending ? out.filter((d) => d.available > 0) : out;
}

// ── Registro de facturación ──────────────────────────────────────────────────────────────────────────────────────

export type RegisterInvoiceInput = {
  invoiceNumber: string;
  invoiceDate: string;
  observations?: string | null;
  lines: Array<{ deliveryLineId: string; quantity: number }>;
  /** Clave por apertura del formulario: un doble clic o reintento no duplica. */
  idempotencyKey: string;
};

export type RegisterInvoiceResult = { invoiceId: string; invoiceNumber: string; client: string; units: number; lines: number; replayed: boolean; appended: boolean };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Registra una factura emitida FUERA de GENUS OS sobre una o varias entregas reales. Solo escribe en las tablas billing_*:
 * no crea movimientos de stock, no cambia lo entregado, no toca remitos ni producción. Transaccional, con las entregas
 * bloqueadas (dos usuarios no pueden facturar la misma unidad dos veces) e idempotente por clave.
 */
export async function registerInvoice(actor: BillingActor, input: RegisterInvoiceInput): Promise<RegisterInvoiceResult> {
  assertBillingWrite(actor);
  const number = String(input.invoiceNumber ?? "").trim();
  if (!number || number.length > 60) throw new OrdersValidationError("Ingresá el número de factura (hasta 60 caracteres).");
  if (!isValidIsoDate(String(input.invoiceDate ?? ""))) throw new OrdersValidationError("Ingresá una fecha de factura válida.");
  const key = String(input.idempotencyKey ?? "").trim();
  if (key.length < 8 || key.length > 100) throw new OrdersValidationError("Falta la clave de operación (idempotencyKey).");
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new OrdersValidationError("Elegí al menos una entrega a facturar.");
  if (input.lines.length > 200) throw new OrdersValidationError("Demasiadas entregas en una sola factura (máx. 200).");
  const merged = new Map<string, number>();
  for (const l of input.lines) {
    if (!UUID_RE.test(String(l.deliveryLineId))) throw new OrdersValidationError("Entrega inválida.");
    merged.set(l.deliveryLineId, (merged.get(l.deliveryLineId) ?? 0) + Number(l.quantity));
  }
  const observations = input.observations?.trim() ? input.observations.trim().slice(0, 1000) : null;

  return getDb().transaction(async (tx: Tx) => {
    // Replay: la misma clave devuelve lo ya registrado.
    const prior = await tx.execute(sql`
      select e.invoice_id::text as id, i.invoice_number, i.client,
             (select coalesce(sum(quantity), 0)::float8 from billing_invoice_lines where invoice_id = e.invoice_id and (e.detail->'lineIds') ? id::text) as units,
             jsonb_array_length(e.detail->'lineIds') as n
        from billing_invoice_events e join billing_invoices i on i.id = e.invoice_id
       where e.detail->>'idempotencyKey' = ${key} limit 1`);
    const p = (prior.rows as Row[])[0];
    if (p) return { invoiceId: String(p.id), invoiceNumber: String(p.invoice_number), client: String(p.client), units: num(p.units), lines: num(p.n), replayed: true, appended: false };

    const ids = [...merged.keys()];
    const list = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
    const found = await tx.execute(sql`
      select l.id::text as id, l.work_item_id::text as work_item_id, l.quantity::float8 as quantity, l.unit, l.status, w.client, w.product
        from work_item_delivery_lines l join work_items w on w.id = l.work_item_id
       where l.id in (${list}) order by l.id for update of l`);
    const lines = found.rows as Row[];
    if (lines.length !== ids.length) throw new OrdersNotFoundError("Alguna entrega ya no existe.");
    const clients = new Set(lines.map((l) => normalizeClientKey(String(l.client ?? ""))));
    if (clients.size > 1) throw new OrdersValidationError("Una factura corresponde a un solo cliente: elegí entregas del mismo cliente.");
    const clientName = String(lines[0].client ?? "");
    const clientNorm = normalizeClientKey(clientName);

    const invd = await tx.execute(sql`
      select il.delivery_line_id::text as id, sum(il.quantity)::float8 as invoiced
        from billing_invoice_lines il join billing_invoices inv on inv.id = il.invoice_id
       where il.status = 'ACTIVA' and inv.status = 'ACTIVA' and il.delivery_line_id in (${list}) group by il.delivery_line_id`);
    const already = new Map((invd.rows as Row[]).map((r) => [String(r.id), num(r.invoiced)]));

    for (const l of lines) {
      if (l.status !== "ACTIVA") throw new OrdersValidationError(`La entrega de «${String(l.product)}» está anulada: no se puede facturar.`);
      const v = validateInvoiceQuantity({
        quantity: merged.get(String(l.id)) ?? 0,
        deliveredLine: num(l.quantity),
        invoicedLine: already.get(String(l.id)) ?? 0,
        integerUnits: String(l.unit ?? "").toLowerCase().startsWith("u"),
      });
      if (!v.ok) throw new OrdersValidationError(`${String(l.product)}: ${v.error}`);
    }

    const numberNorm = normalizeInvoiceNumber(number);
    const existing = await tx.execute(sql`select id::text as id, status from billing_invoices where client_norm = ${clientNorm} and invoice_number_norm = ${numberNorm} for update`);
    const ex = (existing.rows as Row[])[0];
    if (ex && ex.status !== "ACTIVA") throw new OrdersValidationError("Ese número de factura ya existe para el cliente y fue anulado: usá otro número.");
    let invoiceId: string;
    const appended = Boolean(ex);
    if (ex) {
      invoiceId = String(ex.id);
    } else {
      invoiceId = randomUUID();
      await tx.execute(sql`
        insert into billing_invoices (id, client, client_norm, invoice_number, invoice_number_norm, invoice_date, observations, status, idempotency_key, created_by, created_by_sector)
        values (${invoiceId}::uuid, ${clientName}, ${clientNorm}, ${number}, ${numberNorm}, ${input.invoiceDate}::date, ${observations}, 'ACTIVA', ${key}, ${actor.email}, ${actor.sector})`);
    }
    const lineIds: string[] = [];
    let units = 0;
    for (const l of lines) {
      const qty = round6(merged.get(String(l.id)) ?? 0);
      const lineId = randomUUID();
      lineIds.push(lineId);
      units += qty;
      await tx.execute(sql`
        insert into billing_invoice_lines (id, invoice_id, delivery_line_id, work_item_id, quantity, status, created_by)
        values (${lineId}::uuid, ${invoiceId}::uuid, ${String(l.id)}::uuid, ${String(l.work_item_id)}::uuid, ${qty}, 'ACTIVA', ${actor.email})`);
    }
    if (appended) await tx.execute(sql`update billing_invoices set updated_at = now() where id = ${invoiceId}::uuid`);
    await tx.execute(sql`
      insert into billing_invoice_events (invoice_id, event_type, actor_email, actor_sector, detail)
      values (${invoiceId}::uuid, ${appended ? "LINEAS_AGREGADAS" : "REGISTRADA"}, ${actor.email}, ${actor.sector},
              ${JSON.stringify({ idempotencyKey: key, lineIds, invoiceDate: input.invoiceDate, units: round6(units), observations, deliveries: ids })}::jsonb)`);
    return { invoiceId, invoiceNumber: number, client: clientName, units: round6(units), lines: lineIds.length, replayed: false, appended };
  });
}

/** Anula una factura registrada (motivo obligatorio): sus unidades vuelven a «pendientes de facturar». No toca entregas ni stock. */
export async function annulInvoice(actor: BillingActor, invoiceId: string, reason: string): Promise<{ invoiceId: string; replayed: boolean }> {
  assertBillingWrite(actor);
  if (!UUID_RE.test(String(invoiceId))) throw new OrdersValidationError("Factura inválida.");
  const why = String(reason ?? "").trim();
  if (why.length < 3) throw new OrdersValidationError("Indicá el motivo de la anulación.");
  return getDb().transaction(async (tx: Tx) => {
    const r = await tx.execute(sql`select status from billing_invoices where id = ${invoiceId}::uuid for update`);
    const inv = (r.rows as Row[])[0];
    if (!inv) throw new OrdersNotFoundError("Factura no encontrada.");
    if (inv.status === "ANULADA") return { invoiceId, replayed: true };
    await tx.execute(sql`update billing_invoices set status = 'ANULADA', annulled_at = now(), annulled_by = ${actor.email}, annul_reason = ${why.slice(0, 500)}, updated_at = now() where id = ${invoiceId}::uuid`);
    await tx.execute(sql`update billing_invoice_lines set status = 'ANULADA' where invoice_id = ${invoiceId}::uuid and status = 'ACTIVA'`);
    await tx.execute(sql`insert into billing_invoice_events (invoice_id, event_type, actor_email, actor_sector, detail) values (${invoiceId}::uuid, 'ANULADA', ${actor.email}, ${actor.sector}, ${JSON.stringify({ reason: why.slice(0, 500) })}::jsonb)`);
    return { invoiceId, replayed: false };
  });
}

export async function saveBillingNote(actor: BillingActor, rootKey: string, observations: string): Promise<void> {
  assertBillingWrite(actor);
  if (!UUID_RE.test(String(rootKey))) throw new OrdersValidationError("Pedido inválido.");
  const text = String(observations ?? "").trim().slice(0, 1000);
  await (getDb() as unknown as Tx).execute(sql`
    insert into billing_work_notes (work_item_id, observations, updated_by, updated_at) values (${rootKey}::uuid, ${text || null}, ${actor.email}, now())
    on conflict (work_item_id) do update set observations = excluded.observations, updated_by = excluded.updated_by, updated_at = now()`);
}

export type InvoiceView = {
  id: string; client: string; invoiceNumber: string; invoiceDate: string; observations: string | null; status: string;
  createdBy: string; createdAt: string; annulReason: string | null; units: number;
  lines: Array<{ deliveryLineId: string; workItemId: string; product: string; orderRef: string | null; quantity: number; status: string }>;
  history: Array<{ type: string; actor: string; at: string; detail: unknown }>;
};

export async function listInvoices(actor: BillingActor, opts: { client?: string; q?: string; limit?: number } = {}): Promise<InvoiceView[]> {
  assertBillingRead(actor);
  const db = getDb() as unknown as Tx;
  const conds = [sql`true`];
  if (opts.client) conds.push(sql`i.client_norm = ${normalizeClientKey(opts.client)}`);
  if (opts.q?.trim()) conds.push(sql`(i.invoice_number_norm like ${`%${normalizeInvoiceNumber(opts.q)}%`} or i.client_norm like ${`%${normalizeClientKey(opts.q)}%`})`);
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 300);
  const heads = (await db.execute(sql`select i.* from billing_invoices i where ${sql.join(conds, sql` and `)} order by i.created_at desc limit ${limit}`)).rows as Row[];
  if (heads.length === 0) return [];
  const idList = sql.join(heads.map((h) => sql`${String(h.id)}::uuid`), sql`, `);
  const lines = (await db.execute(sql`
    select il.invoice_id::text as invoice_id, il.delivery_line_id::text as delivery_line_id, il.work_item_id::text as work_item_id, il.quantity::float8 as quantity, il.status,
           w.product, w.order_number
      from billing_invoice_lines il left join work_items w on w.id = il.work_item_id where il.invoice_id in (${idList})`)).rows as Row[];
  const events = (await db.execute(sql`select invoice_id::text as invoice_id, event_type, actor_email, created_at, detail from billing_invoice_events where invoice_id in (${idList}) order by created_at`)).rows as Row[];
  return heads.map((h) => {
    const id = String(h.id);
    const ls = lines.filter((l) => l.invoice_id === id);
    return {
      id,
      client: String(h.client),
      invoiceNumber: String(h.invoice_number),
      invoiceDate: String(h.invoice_date).slice(0, 10),
      observations: h.observations == null ? null : String(h.observations),
      status: String(h.status),
      createdBy: String(h.created_by),
      createdAt: new Date(String(h.created_at)).toISOString(),
      annulReason: h.annul_reason == null ? null : String(h.annul_reason),
      units: round6(ls.filter((l) => l.status === "ACTIVA").reduce((s, l) => s + num(l.quantity), 0)),
      lines: ls.map((l) => ({ deliveryLineId: String(l.delivery_line_id), workItemId: String(l.work_item_id), product: String(l.product ?? ""), orderRef: l.order_number == null ? null : String(l.order_number), quantity: num(l.quantity), status: String(l.status) })),
      history: events.filter((e) => e.invoice_id === id).map((e) => ({ type: String(e.event_type), actor: String(e.actor_email), at: new Date(String(e.created_at)).toISOString(), detail: e.detail })),
    };
  });
}

// ── Tablero ──────────────────────────────────────────────────────────────────────────────────────────────────────

export type DashboardFilters = { client?: string; from?: string; to?: string };

export type BillingDashboard = {
  period: { from: string; to: string };
  ordersPendingInvoice: number;
  ordersPartiallyInvoiced: number;
  ordersFullyInvoiced: number;
  unitsPendingInvoice: number;
  unitsInvoicedInPeriod: number;
  deliveriesToday: { count: number; units: number };
  deliveriesInPeriod: { count: number; units: number };
  ordersReadyToDeliver: number;
  pendingByClient: Array<{ client: string; orders: number; units: number }>;
};

const todayBA = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
export const monthRange = (today = todayBA()) => {
  const [y, m] = today.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${y}-${String(m).padStart(2, "0")}-01`, to: `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}` };
};

export async function billingDashboard(actor: BillingActor, f: DashboardFilters = {}): Promise<BillingDashboard> {
  assertBillingRead(actor);
  const db = getDb() as unknown as Tx;
  const range = { ...monthRange(), ...(f.from && isValidIsoDate(f.from) ? { from: f.from } : {}), ...(f.to && isValidIsoDate(f.to) ? { to: f.to } : {}) };
  const rows = await listBillingRows(actor, { client: f.client });
  const withDeliveries = rows.filter((r) => r.delivered > 0);
  const pending = withDeliveries.filter((r) => r.pendingInvoice > 1e-6);
  const clientCond = f.client ? sql`and lower(w.client) like ${`%${normalizeClientKey(f.client)}%`}` : sql``;
  const today = todayBA();
  const inv = await db.execute(sql`
    select coalesce(sum(il.quantity), 0)::float8 as units
      from billing_invoice_lines il join billing_invoices i on i.id = il.invoice_id and i.status = 'ACTIVA' join work_items w on w.id = il.work_item_id
     where il.status = 'ACTIVA' and i.invoice_date between ${range.from}::date and ${range.to}::date ${clientCond}`);
  const del = await db.execute(sql`
    select count(*) filter (where (l.actual_delivered_at at time zone 'America/Argentina/Buenos_Aires')::date = ${today}::date)::int as today_n,
           coalesce(sum(l.quantity) filter (where (l.actual_delivered_at at time zone 'America/Argentina/Buenos_Aires')::date = ${today}::date), 0)::float8 as today_u,
           count(*) filter (where (l.actual_delivered_at at time zone 'America/Argentina/Buenos_Aires')::date between ${range.from}::date and ${range.to}::date)::int as period_n,
           coalesce(sum(l.quantity) filter (where (l.actual_delivered_at at time zone 'America/Argentina/Buenos_Aires')::date between ${range.from}::date and ${range.to}::date), 0)::float8 as period_u
      from work_item_delivery_lines l join work_items w on w.id = l.work_item_id where l.status = 'ACTIVA' and w.deleted_at is null ${clientCond}`);
  const ready = await db.execute(sql`
    select count(*)::int as n from (
      select m.work_item_id, sum(m.quantity) as marked
        from portal_availability_marks m join work_items w on w.id = m.work_item_id
       where m.retracted_at is null and w.deleted_at is null ${clientCond} group by m.work_item_id) x
      left join (select work_item_id, sum(quantity) as d from work_item_delivery_lines where status = 'ACTIVA' group by work_item_id) d on d.work_item_id = x.work_item_id
     where x.marked - coalesce(d.d, 0) > 0.000001`).catch(() => ({ rows: [{ n: 0 }] }));
  const byClient = new Map<string, { orders: number; units: number }>();
  for (const r of pending) {
    const cur = byClient.get(r.client) ?? { orders: 0, units: 0 };
    cur.orders += 1;
    cur.units = round6(cur.units + r.pendingInvoice);
    byClient.set(r.client, cur);
  }
  const d0 = (del.rows as Row[])[0] ?? {};
  return {
    period: range,
    ordersPendingInvoice: rows.filter((r) => r.invoicingState === "PENDIENTE_DE_FACTURAR").length,
    ordersPartiallyInvoiced: rows.filter((r) => r.invoicingState === "FACTURACION_PARCIAL").length,
    ordersFullyInvoiced: rows.filter((r) => r.invoicingState === "FACTURADO").length,
    unitsPendingInvoice: round6(pending.reduce((s, r) => s + r.pendingInvoice, 0)),
    unitsInvoicedInPeriod: num(((inv.rows as Row[])[0] ?? {}).units),
    deliveriesToday: { count: num(d0.today_n), units: num(d0.today_u) },
    deliveriesInPeriod: { count: num(d0.period_n), units: num(d0.period_u) },
    ordersReadyToDeliver: num(((ready.rows as Row[])[0] ?? {}).n),
    pendingByClient: [...byClient.entries()].map(([client, v]) => ({ client, ...v })).sort((a, b) => b.units - a.units),
  };
}
