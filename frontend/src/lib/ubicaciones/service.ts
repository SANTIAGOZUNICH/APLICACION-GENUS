/**
 * DEPÓSITO › UBICACIONES — servicio (Postgres, migración 0092). Dónde está cada pallet: NO es stock. Este módulo nunca escribe en tablas de stock
 * (ME/MP/Cajas/Insumos); solo LEE `inv_me_*` para validar el tope cuando el contenido está vinculado a un material ME.
 *
 * Garantías:
 *  - Cada operación es UNA transacción (si falla un renglón no queda nada a medias).
 *  - Candados de transacción por posición en orden estable (sin interbloqueos) + control de versión (bloqueo optimista) opcional.
 *  - Idempotencia por clave: reintento / doble toque / carrera con la misma clave ⇒ una sola aplicación (los reintentos devuelven `replayed`).
 *  - El historial (`deposito_ubicacion_movements`) solo se inserta: nunca se actualiza ni se borra, y guarda el snapshot de los códigos.
 */
import "server-only";

import { randomUUID } from "node:crypto";
import { asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { depositoMapaConfig, depositoMapaShapes, depositoUbicacionItems, depositoUbicacionMovements, depositoUbicaciones, invMeMaterials } from "@/lib/db/schema";
import { loadLedgerInputs, stockOf } from "@/lib/inventory/me-planilla-db";
import { OrdersForbiddenError, OrdersNotFoundError, OrdersUnavailableError, OrdersValidationError } from "@/lib/orders/types";
import type { MeMaterial } from "@/lib/inventory/types";
import {
  MAX_LINES,
  MAX_OBSERVATIONS,
  SHAPE_KINDS,
  canConfigUbicaciones,
  canReadUbicaciones,
  canRetireOrRename,
  canWriteUbicaciones,
  checkStockCap,
  clientKeyOf,
  cleanLabel,
  computeIndicators,
  findOverlap,
  fromMilli,
  mergeQuantity,
  normalizeMaterialCode,
  normalizeText,
  parseGeometry,
  parseLineInput,
  parseLocationCode,
  parsePolygon,
  planMove,
  toMilli,
  type MoveRequestLine,
  type ShapeKind,
} from "./rules";
import type { MapConfigView, MapView, MaterialOption, MovementLine, MovementView, ShapeView, UbicacionView, UbActor } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- la transacción se pasa entre funciones (misma convención que Cajas / Insumos)
type AnyTx = any;

export class UbicacionesConflictError extends Error {
  readonly status = 409;
  readonly code = "UBICACIONES_CONFLICT";
  constructor(message: string) {
    super(message);
    this.name = "UbicacionesConflictError";
  }
}

function db() {
  if (!isDatabaseConfigured()) throw new OrdersUnavailableError("La base de datos no está configurada: las ubicaciones necesitan Postgres.");
  return getDb();
}
function assertRead(a: UbActor) {
  if (!canReadUbicaciones(a.sector)) throw new OrdersForbiddenError("Tu sector no puede consultar las ubicaciones del depósito.");
}
function assertWrite(a: UbActor) {
  if (!canWriteUbicaciones(a.sector)) throw new OrdersForbiddenError("Solo Depósito puede asignar, mover o liberar ubicaciones. Tu sector puede consultarlas.");
}
function assertConfig(a: UbActor) {
  if (!canConfigUbicaciones(a.sector)) throw new OrdersForbiddenError("Solo Depósito y Dirección pueden configurar el mapa.");
}
function fail(message: string): never {
  throw new OrdersValidationError(message);
}
function checkKey(raw: unknown): string {
  const k = typeof raw === "string" ? raw.trim() : "";
  if (k.length < 8 || k.length > 120) fail("Falta la clave de la operación (se genera sola al tocar el botón).");
  return k;
}

// ───────────────────────── Lectura ─────────────────────────

type LocRow = typeof depositoUbicaciones.$inferSelect;
type ItemRow = typeof depositoUbicacionItems.$inferSelect;

const num = (v: string | number | null): number | null => (v == null ? null : Number(v));
const iso = (d: Date | null) => (d ? d.toISOString() : null);

function toView(l: LocRow, items: ItemRow[]): UbicacionView {
  return {
    id: l.id,
    code: l.code,
    zone: l.zone,
    x: l.x,
    y: l.y,
    w: l.w,
    h: l.h,
    sortOrder: l.sortOrder,
    active: l.active,
    version: l.version,
    observations: l.observations,
    lastModifiedAt: iso(l.lastContentAt) ?? iso(l.updatedAt),
    lastModifiedBy: l.lastContentByName ?? l.lastContentBy ?? l.updatedBy,
    items: items
      .filter((i) => i.locationId === l.id)
      .sort((a, b) => a.clientName.localeCompare(b.clientName) || a.materialName.localeCompare(b.materialName))
      .map((i) => ({ id: i.id, clientKey: i.clientKey, clientName: i.clientName, materialKey: i.materialKey, material: i.materialName, codigo: i.codigo, meMaterialId: i.meMaterialId, unit: i.unit, quantity: num(i.quantity) })),
  };
}

async function loadConfig(tx: AnyTx): Promise<MapConfigView> {
  const [row] = await tx.select().from(depositoMapaConfig).where(eq(depositoMapaConfig.id, "main")).limit(1);
  return { width: row?.viewWidth ?? 400, height: row?.viewHeight ?? 740, title: row?.title ?? "Planta alta · Depósito" };
}

export async function getMap(actor: UbActor): Promise<MapView> {
  assertRead(actor);
  const d = db();
  const [config, shapes, locs, items] = await Promise.all([
    loadConfig(d),
    d.select().from(depositoMapaShapes).orderBy(asc(depositoMapaShapes.sortOrder), asc(depositoMapaShapes.id)),
    d.select().from(depositoUbicaciones).orderBy(asc(depositoUbicaciones.sortOrder), asc(depositoUbicaciones.code)),
    d.select().from(depositoUbicacionItems),
  ]);
  const locations = (locs as LocRow[]).map((l) => toView(l, items as ItemRow[]));
  return {
    config,
    shapes: (shapes as Array<typeof depositoMapaShapes.$inferSelect>).map(
      (s): ShapeView => ({ id: s.id, kind: s.kind as ShapeKind, label: s.label, sublabel: s.sublabel, x: s.x, y: s.y, w: s.w, h: s.h, points: (s.points as Array<[number, number]> | null) ?? null, rotation: s.rotation, sortOrder: s.sortOrder, active: s.active })
    ),
    locations,
    indicators: computeIndicators(locations),
    capabilities: { read: true, write: canWriteUbicaciones(actor.sector), config: canConfigUbicaciones(actor.sector) },
    serverTime: new Date().toISOString(),
  };
}

function toMovementView(r: typeof depositoUbicacionMovements.$inferSelect): MovementView {
  return {
    id: r.id,
    seq: r.seq,
    kind: r.kind,
    fromLocationId: r.fromLocationId,
    fromCode: r.fromCode,
    toLocationId: r.toLocationId,
    toCode: r.toCode,
    lines: (r.lines as MovementLine[]) ?? [],
    note: r.note,
    detail: (r.detail as Record<string, unknown>) ?? {},
    actorEmail: r.actorEmail,
    actorName: r.actorName,
    actorSector: r.actorSector,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listMovements(actor: UbActor, f: { locationId?: string; kind?: string; limit?: number } = {}): Promise<MovementView[]> {
  assertRead(actor);
  const lim = Math.min(Math.max(f.limit ?? 200, 1), 500);
  const d = db();
  const where = f.locationId
    ? or(eq(depositoUbicacionMovements.fromLocationId, f.locationId), eq(depositoUbicacionMovements.toLocationId, f.locationId))
    : undefined;
  const rows = await d.select().from(depositoUbicacionMovements).where(f.kind ? (where ? sql`${where} and ${depositoUbicacionMovements.kind} = ${f.kind}` : eq(depositoUbicacionMovements.kind, f.kind)) : where).orderBy(desc(depositoUbicacionMovements.seq)).limit(lim);
  return rows.map(toMovementView);
}

/** Clientes conocidos (maestro del portal + pedidos + trabajos + materiales ME + los ya ubicados), unificados por la clave compartida. */
export async function listClients(actor: UbActor): Promise<Array<{ name: string; key: string }>> {
  assertRead(actor);
  const res = await db().execute(sql`
    select name from (
      select btrim(display_name) as name from portal_clients
      union select btrim(client_name) from deposito_ubicacion_items
      union select btrim(payload->>'cliente') from inv_me_materials
      union select btrim(client) from work_items where client is not null and deleted_at is null
      union select btrim(cliente) from production_pedidos where cliente is not null and deleted_at is null
    ) x where name is not null and name <> '' limit 800`);
  const byKey = new Map<string, string>();
  for (const r of res.rows as Array<{ name: string }>) {
    const k = clientKeyOf(r.name);
    if (!k) continue;
    const cur = byKey.get(k);
    if (!cur || r.name.length < cur.length) byKey.set(k, r.name);
  }
  return [...byKey.entries()].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Materiales ME existentes (autocompletar) con su stock disponible y lo ya distribuido en ubicaciones. */
export async function listMaterials(actor: UbActor, q?: string): Promise<MaterialOption[]> {
  assertRead(actor);
  const d = db();
  const ledger = await loadLedgerInputs(d);
  const needle = normalizeText(q ?? "");
  const rows = await d.select({ codigo: depositoUbicacionItems.codigo, quantity: depositoUbicacionItems.quantity }).from(depositoUbicacionItems).where(sql`${depositoUbicacionItems.codigo} is not null`);
  const dist = new Map<string, number>();
  for (const r of rows) dist.set(r.codigo as string, (dist.get(r.codigo as string) ?? 0) + toMilli(Number(r.quantity ?? 0)));
  const seen = new Set<string>();
  const out: MaterialOption[] = [];
  for (const m of ledger.materials.filter((x) => !x.archived)) {
    const codigo = normalizeMaterialCode(m.codigo);
    if (!codigo || seen.has(codigo)) continue;
    if (needle && !normalizeText(`${codigo} ${m.descripcion} ${m.cliente}`).includes(needle)) continue;
    seen.add(codigo);
    out.push({ id: m.id, codigo, descripcion: m.descripcion, cliente: m.cliente, unit: m.unidad || "u", stock: stockOf(codigo, ledger).stock, distributed: fromMilli(dist.get(codigo) ?? 0) });
    if (out.length >= 40) break;
  }
  return out.sort((a, b) => a.codigo.localeCompare(b.codigo));
}

// ───────────────────────── Piezas de bajo nivel ─────────────────────────

async function lockKeys(tx: AnyTx, keys: Iterable<string>): Promise<void> {
  for (const k of [...new Set(keys)].sort()) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${k}))`);
}
/** Primero las posiciones (orden estable), después los códigos de material, después la configuración: orden global fijo ⇒ sin interbloqueos. */
async function lockAll(tx: AnyTx, o: { locations?: string[]; codes?: string[]; config?: boolean }): Promise<void> {
  await lockKeys(tx, (o.locations ?? []).map((id) => `ubicaciones:loc:${id}`));
  await lockKeys(tx, (o.codes ?? []).map((c) => `ubicaciones:cap:${c}`));
  if (o.config) await lockKeys(tx, ["ubicaciones:config"]);
}

async function replayOf(tx: AnyTx, key: string) {
  const [m] = await tx.select().from(depositoUbicacionMovements).where(eq(depositoUbicacionMovements.idempotencyKey, key)).limit(1);
  return m as typeof depositoUbicacionMovements.$inferSelect | undefined;
}

type MovementInput = { kind: string; key: string; from?: LocRow | null; to?: LocRow | null; lines?: MovementLine[]; note?: string | null; detail?: Record<string, unknown> };
async function insertMovement(tx: AnyTx, actor: UbActor, m: MovementInput): Promise<string> {
  const [row] = await tx
    .insert(depositoUbicacionMovements)
    .values({
      kind: m.kind,
      fromLocationId: m.from?.id ?? null,
      fromCode: m.from?.code ?? null,
      toLocationId: m.to?.id ?? null,
      toCode: m.to?.code ?? null,
      lines: (m.lines ?? []) as never,
      note: m.note ?? null,
      detail: (m.detail ?? {}) as never,
      idempotencyKey: m.key,
      actorEmail: actor.email,
      actorName: actor.displayName ?? null,
      actorSector: actor.sector,
    })
    .returning({ id: depositoUbicacionMovements.id });
  return row.id as string;
}

async function getLocation(tx: AnyTx, id: unknown, opts: { activeOnly?: boolean } = {}): Promise<LocRow> {
  if (typeof id !== "string" || !id) fail("Elegí una ubicación.");
  const [l] = await tx.select().from(depositoUbicaciones).where(eq(depositoUbicaciones.id, id)).limit(1);
  if (!l) throw new OrdersNotFoundError("La ubicación no existe.");
  if (opts.activeOnly && !l.active) fail(`La ubicación ${l.code} está desactivada.`);
  return l as LocRow;
}
const itemsOf = async (tx: AnyTx, locationId: string): Promise<ItemRow[]> => tx.select().from(depositoUbicacionItems).where(eq(depositoUbicacionItems.locationId, locationId));

function checkVersion(l: LocRow, expected: unknown) {
  if (expected === undefined || expected === null) return;
  if (!Number.isInteger(expected)) fail("Versión inválida.");
  if (expected !== l.version) throw new UbicacionesConflictError(`La ubicación ${l.code} fue modificada por otra persona. Actualizamos la pantalla: revisá y volvé a intentar.`);
}

async function touch(tx: AnyTx, l: LocRow, actor: UbActor, patch: Partial<typeof depositoUbicaciones.$inferInsert> = {}) {
  const now = new Date();
  await tx
    .update(depositoUbicaciones)
    .set({ ...patch, version: l.version + 1, updatedAt: now, updatedBy: actor.email, lastContentAt: now, lastContentBy: actor.email, lastContentByName: actor.displayName ?? actor.email })
    .where(eq(depositoUbicaciones.id, l.id));
}

async function viewsOf(tx: AnyTx, ids: string[]): Promise<UbicacionView[]> {
  const locs = (await tx.select().from(depositoUbicaciones).where(inArray(depositoUbicaciones.id, ids))) as LocRow[];
  const items = (await tx.select().from(depositoUbicacionItems).where(inArray(depositoUbicacionItems.locationId, ids))) as ItemRow[];
  return locs.map((l) => toView(l, items));
}

const lineOf = (i: Pick<ItemRow, "clientName" | "clientKey" | "materialName" | "codigo" | "meMaterialId" | "unit">, quantity: number | null, remaining?: number | null): MovementLine => ({
  clientName: i.clientName,
  clientKey: i.clientKey,
  material: i.materialName,
  codigo: i.codigo,
  meMaterialId: i.meMaterialId,
  unit: i.unit,
  quantity,
  ...(remaining !== undefined ? { remaining } : {}),
});

export type OpResult = { replayed: boolean; movementId: string; locations: UbicacionView[] };
const done = async (tx: AnyTx, replayed: boolean, movementId: string, ids: string[]): Promise<OpResult> => ({ replayed, movementId, locations: await viewsOf(tx, ids) });

/** Tope por stock: cada material vinculado a ME no puede tener más cantidad distribuida que su stock disponible. Requiere el candado del código. */
async function assertStockCap(tx: AnyTx, adds: Array<{ codigo: string | null; meMaterialId: string | null; quantity: number | null; material: string }>): Promise<void> {
  const linked = adds.filter((a) => a.codigo && a.quantity != null);
  if (!linked.length) return;
  const mats = (await tx.select({ payload: invMeMaterials.payload }).from(invMeMaterials)) as Array<{ payload: MeMaterial }>;
  const ledger = await loadLedgerInputs(tx);
  const byCode = new Map<string, number>();
  for (const a of linked) byCode.set(a.codigo!, (byCode.get(a.codigo!) ?? 0) + toMilli(a.quantity!));
  for (const a of linked) {
    const m = mats.map((r) => r.payload).find((p) => (a.meMaterialId ? p.id === a.meMaterialId : false));
    if (a.meMaterialId && (!m || normalizeMaterialCode(m.codigo) !== a.codigo)) fail(`El material «${a.material}» no coincide con el inventario ME. Elegilo de nuevo de la lista.`);
  }
  for (const [codigo, addMilli] of byCode) {
    const rows = (await tx.select({ quantity: depositoUbicacionItems.quantity }).from(depositoUbicacionItems).where(eq(depositoUbicacionItems.codigo, codigo))) as Array<{ quantity: string | null }>;
    const elsewhere = rows.reduce((acc, r) => acc + toMilli(Number(r.quantity ?? 0)), 0);
    const label = linked.find((l) => l.codigo === codigo)!.material;
    const res = checkStockCap({ available: stockOf(codigo, ledger).stock, elsewhere: fromMilli(elsewhere), adding: fromMilli(addMilli), label });
    if (!res.ok) fail(res.message);
  }
}

type PreparedLine = ReturnType<typeof parseLineInput> extends infer R ? (R extends { ok: true; value: infer V } ? V : never) : never;
function parseLines(raw: unknown): PreparedLine[] {
  if (!Array.isArray(raw) || raw.length === 0) fail("Agregá al menos un material.");
  if (raw.length > MAX_LINES) fail(`No se pueden cargar más de ${MAX_LINES} materiales a la vez.`);
  const out: PreparedLine[] = [];
  for (const r of raw) {
    const p = parseLineInput(r);
    if (!p.ok) fail(p.message);
    out.push(p.value);
  }
  return out;
}

/** Suma las líneas a la posición (mismo cliente + material = un solo renglón con la cantidad sumada). */
async function upsertLines(tx: AnyTx, loc: LocRow, lines: PreparedLine[], actor: UbActor, ingresoId?: string): Promise<void> {
  const current = await itemsOf(tx, loc.id);
  const slots = new Map(current.map((i) => [`${i.clientKey}|${i.materialKey}`, i]));
  for (const ln of lines) {
    const slot = `${ln.clientKey}|${ln.materialKey}`;
    const ex = slots.get(slot);
    if (ex) {
      const q = mergeQuantity(num(ex.quantity), ln.quantity == null ? null : toMilli(ln.quantity));
      await tx
        .update(depositoUbicacionItems)
        .set({ quantity: q == null ? null : String(q), codigo: ex.codigo ?? ln.codigo, meMaterialId: ex.meMaterialId ?? ln.meMaterialId, updatedAt: new Date(), updatedBy: actor.email })
        .where(eq(depositoUbicacionItems.id, ex.id));
      slots.set(slot, { ...ex, quantity: q == null ? null : String(q) });
    } else {
      const [ins] = await tx
        .insert(depositoUbicacionItems)
        .values({ locationId: loc.id, clientKey: ln.clientKey, clientName: ln.clientName, materialKey: ln.materialKey, materialName: ln.material, codigo: ln.codigo, meMaterialId: ln.meMaterialId, unit: ln.unit, quantity: ln.quantity == null ? null : String(ln.quantity), ingresoId: ingresoId ?? null, updatedBy: actor.email })
        .returning();
      slots.set(slot, ins);
    }
  }
}

const linesOfPrepared = (lines: PreparedLine[]): MovementLine[] =>
  lines.map((l) => ({ clientName: l.clientName, clientKey: l.clientKey, material: l.material, codigo: l.codigo, meMaterialId: l.meMaterialId, unit: l.unit, quantity: l.quantity }));

// ───────────────────────── Operaciones de contenido (solo Depósito) ─────────────────────────

/** Asigna cliente(s) y material(es) a la posición, o agrega más a una ocupada. Varias líneas (de varios clientes) en una sola operación. */
export async function addContent(actor: UbActor, input: { key: unknown; locationId: unknown; expectedVersion?: unknown; lines: unknown; observations?: unknown }): Promise<OpResult> {
  assertWrite(actor);
  const key = checkKey(input.key);
  const lines = parseLines(input.lines);
  const locationId = String(input.locationId ?? "");
  const obs = input.observations === undefined ? undefined : cleanObs(input.observations);
  const codes = lines.map((l) => l.codigo).filter((c): c is string => Boolean(c));
  return db().transaction(async (tx: AnyTx) => {
    await lockAll(tx, { locations: [locationId], codes });
    const prev = await replayOf(tx, key);
    if (prev) return done(tx, true, prev.id, [locationId]);
    const loc = await getLocation(tx, locationId, { activeOnly: true });
    checkVersion(loc, input.expectedVersion);
    const wasEmpty = (await itemsOf(tx, loc.id)).length === 0;
    await assertStockCap(tx, lines.map((l) => ({ codigo: l.codigo, meMaterialId: l.meMaterialId, quantity: l.quantity, material: l.material })));
    await upsertLines(tx, loc, lines, actor);
    await touch(tx, loc, actor, obs === undefined ? {} : { observations: obs });
    const id = await insertMovement(tx, actor, { kind: wasEmpty ? "ASIGNACION" : "AGREGADO", key, to: loc, lines: linesOfPrepared(lines), detail: obs === undefined ? {} : { observations: obs } });
    return done(tx, false, id, [loc.id]);
  });
}

function cleanObs(raw: unknown): string {
  const t = typeof raw === "string" ? raw.replace(/\r\n/g, "\n").trim() : "";
  if (t.length > MAX_OBSERVATIONS) fail(`Las observaciones no pueden superar ${MAX_OBSERVATIONS} caracteres.`);
  return t;
}

function parseMoveLines(raw: unknown): MoveRequestLine[] {
  if (!Array.isArray(raw)) fail("Elegí qué materiales mover.");
  return (raw as Array<Record<string, unknown>>).map((r) => ({ itemId: String(r?.itemId ?? ""), quantity: r?.quantity === undefined || r?.quantity === null || r?.quantity === "" ? null : (r.quantity as number) }));
}

/** Retira (total o parcialmente) materiales de una posición. Un renglón que llega a cero desaparece; la posición queda libre si no queda nada. */
export async function removeContent(actor: UbActor, input: { key: unknown; locationId: unknown; expectedVersion?: unknown; lines: unknown }): Promise<OpResult> {
  assertWrite(actor);
  const key = checkKey(input.key);
  const req = parseMoveLines(input.lines);
  const locationId = String(input.locationId ?? "");
  return db().transaction(async (tx: AnyTx) => {
    await lockAll(tx, { locations: [locationId] });
    const prev = await replayOf(tx, key);
    if (prev) return done(tx, true, prev.id, [locationId]);
    const loc = await getLocation(tx, locationId);
    checkVersion(loc, input.expectedVersion);
    const items = await itemsOf(tx, loc.id);
    const plan = planMove(items.map((i) => ({ id: i.id, quantity: num(i.quantity), material: i.materialName })), req);
    if (!plan.ok) fail(plan.message);
    const lines: MovementLine[] = [];
    for (const p of plan.value) {
      const it = items.find((i) => i.id === p.itemId)!;
      lines.push(lineOf(it, p.moveMilli == null ? null : fromMilli(p.moveMilli), p.remainMilli == null ? null : fromMilli(p.remainMilli)));
      if (p.whole) await tx.delete(depositoUbicacionItems).where(eq(depositoUbicacionItems.id, it.id));
      else await tx.update(depositoUbicacionItems).set({ quantity: String(fromMilli(p.remainMilli!)), updatedAt: new Date(), updatedBy: actor.email }).where(eq(depositoUbicacionItems.id, it.id));
    }
    await touch(tx, loc, actor);
    const id = await insertMovement(tx, actor, { kind: "RETIRO", key, from: loc, lines });
    return done(tx, false, id, [loc.id]);
  });
}

export async function setObservations(actor: UbActor, input: { key: unknown; locationId: unknown; expectedVersion?: unknown; observations: unknown }): Promise<OpResult> {
  assertWrite(actor);
  const key = checkKey(input.key);
  const obs = cleanObs(input.observations);
  const locationId = String(input.locationId ?? "");
  return db().transaction(async (tx: AnyTx) => {
    await lockAll(tx, { locations: [locationId] });
    const prev = await replayOf(tx, key);
    if (prev) return done(tx, true, prev.id, [locationId]);
    const loc = await getLocation(tx, locationId, { activeOnly: true });
    checkVersion(loc, input.expectedVersion);
    await touch(tx, loc, actor, { observations: obs });
    const id = await insertMovement(tx, actor, { kind: "OBSERVACION", key, to: loc, detail: { before: loc.observations, after: obs } });
    return done(tx, false, id, [loc.id]);
  });
}

/** Traslada TODO el contenido (`all: true`) o renglones elegidos (completos o con cantidad parcial) a otra posición. Conserva el total. */
export async function transferContent(actor: UbActor, input: { key: unknown; fromId: unknown; toId: unknown; expectedVersion?: unknown; expectedToVersion?: unknown; all?: unknown; lines?: unknown }): Promise<OpResult> {
  assertWrite(actor);
  const key = checkKey(input.key);
  const fromId = String(input.fromId ?? "");
  const toId = String(input.toId ?? "");
  if (!fromId || !toId) fail("Elegí la ubicación de origen y la de destino.");
  if (fromId === toId) fail("El origen y el destino tienen que ser distintos.");
  return db().transaction(async (tx: AnyTx) => {
    await lockAll(tx, { locations: [fromId, toId] });
    const prev = await replayOf(tx, key);
    if (prev) return done(tx, true, prev.id, [fromId, toId]);
    const from = await getLocation(tx, fromId);
    const to = await getLocation(tx, toId, { activeOnly: true });
    checkVersion(from, input.expectedVersion);
    checkVersion(to, input.expectedToVersion);
    const srcItems = await itemsOf(tx, from.id);
    if (!srcItems.length) fail(`La ubicación ${from.code} está libre: no hay nada para trasladar.`);
    const req: MoveRequestLine[] = input.all ? srcItems.map((i) => ({ itemId: i.id, quantity: null })) : parseMoveLines(input.lines);
    const plan = planMove(srcItems.map((i) => ({ id: i.id, quantity: num(i.quantity), material: i.materialName })), req);
    if (!plan.ok) fail(plan.message);
    const dst = await itemsOf(tx, to.id);
    const slots = new Map(dst.map((i) => [`${i.clientKey}|${i.materialKey}`, i]));
    const lines: MovementLine[] = [];
    for (const p of plan.value) {
      const src = srcItems.find((i) => i.id === p.itemId)!;
      lines.push(lineOf(src, p.moveMilli == null ? null : fromMilli(p.moveMilli), p.remainMilli == null ? null : fromMilli(p.remainMilli)));
      // Origen: primero se descuenta; después se suma al destino (todo en la misma transacción).
      if (p.whole) await tx.delete(depositoUbicacionItems).where(eq(depositoUbicacionItems.id, src.id));
      else await tx.update(depositoUbicacionItems).set({ quantity: String(fromMilli(p.remainMilli!)), updatedAt: new Date(), updatedBy: actor.email }).where(eq(depositoUbicacionItems.id, src.id));
      const slot = `${src.clientKey}|${src.materialKey}`;
      const ex = slots.get(slot);
      if (ex) {
        const q = mergeQuantity(num(ex.quantity), p.moveMilli);
        await tx.update(depositoUbicacionItems).set({ quantity: q == null ? null : String(q), updatedAt: new Date(), updatedBy: actor.email }).where(eq(depositoUbicacionItems.id, ex.id));
        slots.set(slot, { ...ex, quantity: q == null ? null : String(q) });
      } else {
        const [ins] = await tx
          .insert(depositoUbicacionItems)
          .values({ locationId: to.id, clientKey: src.clientKey, clientName: src.clientName, materialKey: src.materialKey, materialName: src.materialName, codigo: src.codigo, meMaterialId: src.meMaterialId, unit: src.unit, quantity: p.moveMilli == null ? null : String(fromMilli(p.moveMilli)), ingresoId: src.ingresoId, updatedBy: actor.email })
          .returning();
        slots.set(slot, ins);
      }
    }
    await touch(tx, from, actor);
    await touch(tx, to, actor);
    const id = await insertMovement(tx, actor, { kind: "TRASLADO", key, from, to, lines });
    return done(tx, false, id, [from.id, to.id]);
  });
}

/** Libera la posición: quita todo su contenido (queda en el historial) y limpia sus observaciones. */
export async function releaseLocation(actor: UbActor, input: { key: unknown; locationId: unknown; expectedVersion?: unknown }): Promise<OpResult> {
  assertWrite(actor);
  const key = checkKey(input.key);
  const locationId = String(input.locationId ?? "");
  return db().transaction(async (tx: AnyTx) => {
    await lockAll(tx, { locations: [locationId] });
    const prev = await replayOf(tx, key);
    if (prev) return done(tx, true, prev.id, [locationId]);
    const loc = await getLocation(tx, locationId);
    checkVersion(loc, input.expectedVersion);
    const items = await itemsOf(tx, loc.id);
    if (!items.length) fail(`La ubicación ${loc.code} ya está libre.`);
    await tx.delete(depositoUbicacionItems).where(eq(depositoUbicacionItems.locationId, loc.id));
    await touch(tx, loc, actor, { observations: "" });
    const id = await insertMovement(tx, actor, { kind: "LIBERACION", key, from: loc, lines: items.map((i) => lineOf(i, num(i.quantity))), detail: { observations: loc.observations } });
    return done(tx, false, id, [loc.id]);
  });
}

/**
 * Ubicación física de un INGRESO de ME ya creado. Lee el ingreso de Postgres (la verdad), toma de ahí cliente / material / cantidad (el cliente
 * no manda cantidades) y suma a la posición. Idempotente por id de ingreso: repetirlo no suma dos veces. NO es atómico con el ingreso (el
 * inventario ME usa su propio mecanismo): si falla, el ingreso queda registrado igual y se puede ubicar después con «Agregar».
 */
export async function placeIngresoMe(actor: UbActor, input: { ingresoId: unknown; locationId: unknown; clientName?: unknown }): Promise<OpResult> {
  assertWrite(actor);
  const ingresoId = String(input.ingresoId ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(ingresoId)) fail("El ingreso no es válido.");
  const key = `ingreso-me:${ingresoId}`;
  const locationId = String(input.locationId ?? "");
  const res = await db().execute(sql`select payload from inv_me_ingresos where id = ${ingresoId}::uuid`);
  const ing = (res.rows[0] as { payload?: Record<string, unknown> } | undefined)?.payload;
  if (!ing) throw new OrdersNotFoundError("El ingreso todavía no está registrado: guardalo primero.");
  if (ing.anulado) fail("El ingreso está anulado: no se puede ubicar.");
  const total = Number(ing.total ?? 0);
  if (!(total > 0)) fail("El ingreso no tiene cantidad total: cargá BULTOS y CANTIDAD para ubicarlo.");
  const codigo = normalizeMaterialCode(ing.codigo) || null;
  const clientName = cleanLabel(ing.cliente) || cleanLabel(input.clientName);
  const mats = codigo ? ((await db().select({ payload: invMeMaterials.payload }).from(invMeMaterials)) as Array<{ payload: MeMaterial }>).map((r) => r.payload).filter((m) => normalizeMaterialCode(m.codigo) === codigo) : [];
  const mat = mats.find((m) => m.id === ing.materialId) ?? mats.find((m) => !m.archived) ?? mats[0];
  const parsed = parseLineInput({ clientName, material: cleanLabel(ing.descripcionInsumo) || codigo || "Material de envase", quantity: total, unit: mat?.unidad || "u", codigo: mat ? codigo : null, meMaterialId: mat?.id ?? null });
  if (!parsed.ok) fail(parsed.message);
  const line = parsed.value;
  return db().transaction(async (tx: AnyTx) => {
    await lockAll(tx, { locations: [locationId], codes: line.codigo ? [line.codigo] : [] });
    const prev = await replayOf(tx, key);
    if (prev) return done(tx, true, prev.id, [prev.toLocationId ?? locationId]);
    const loc = await getLocation(tx, locationId, { activeOnly: true });
    await assertStockCap(tx, [{ codigo: line.codigo, meMaterialId: line.meMaterialId, quantity: line.quantity, material: line.material }]);
    await upsertLines(tx, loc, [line], actor, ingresoId);
    await touch(tx, loc, actor);
    const id = await insertMovement(tx, actor, { kind: "INGRESO_ME", key, to: loc, lines: linesOfPrepared([line]), detail: { ingresoId, ingresoNro: ing.ingresoNro ?? null } });
    return done(tx, false, id, [loc.id]);
  });
}

// ───────────────────────── Configuración del mapa (Depósito y Dirección) ─────────────────────────

async function configMovement(tx: AnyTx, actor: UbActor, loc: LocRow | null, detail: Record<string, unknown>) {
  await insertMovement(tx, actor, { kind: "CONFIG", key: `cfg:${randomUUID()}`, to: loc, detail });
}

const snap = (l: LocRow) => ({ code: l.code, zone: l.zone, x: l.x, y: l.y, w: l.w, h: l.h, sortOrder: l.sortOrder, active: l.active });

export async function createLocation(actor: UbActor, input: { code: unknown; zone?: unknown; x: unknown; y: unknown; w: unknown; h: unknown; sortOrder?: unknown }): Promise<UbicacionView> {
  assertConfig(actor);
  const code = parseLocationCode(input.code);
  if (!code.ok) fail(code.message);
  return db().transaction(async (tx: AnyTx) => {
    await lockAll(tx, { config: true });
    const canvas = await loadConfig(tx);
    const geo = parseGeometry(input as never, canvas);
    if (!geo.ok) fail(geo.message);
    const dup = await tx.select({ id: depositoUbicaciones.id }).from(depositoUbicaciones).where(sql`upper(${depositoUbicaciones.code}) = ${code.value}`).limit(1);
    if (dup.length) fail(`Ya existe una ubicación con el código ${code.value} (puede estar desactivada).`);
    const others = (await tx.select().from(depositoUbicaciones).where(eq(depositoUbicaciones.active, true))) as LocRow[];
    const hit = findOverlap(geo.value, others);
    if (hit) fail(`La posición se superpone con ${hit.code}. Elegí otras coordenadas.`);
    const [max] = await tx.select({ m: sql<number>`coalesce(max(${depositoUbicaciones.sortOrder}), 0)` }).from(depositoUbicaciones);
    const sortOrder = Number.isInteger(input.sortOrder) ? (input.sortOrder as number) : Number(max?.m ?? 0) + 1;
    const [row] = await tx
      .insert(depositoUbicaciones)
      .values({ id: `ubi-${code.value.toLowerCase()}-${randomUUID().slice(0, 6)}`, code: code.value, zone: cleanLabel(input.zone), ...geo.value, sortOrder, updatedBy: actor.email })
      .returning();
    await configMovement(tx, actor, row, { action: "crear", after: snap(row) });
    return toView(row, []);
  });
}

/**
 * Cambia código, zona, geometría, orden o estado. Renombrar o desactivar solo con la posición VACÍA (la trazabilidad del contenido no se rompe;
 * los movimientos guardan además el snapshot del código). La geometría y el orden se pueden cambiar siempre.
 */
export async function updateLocation(actor: UbActor, input: { id: unknown; expectedVersion?: unknown; code?: unknown; zone?: unknown; x?: unknown; y?: unknown; w?: unknown; h?: unknown; sortOrder?: unknown; active?: unknown }): Promise<UbicacionView> {
  assertConfig(actor);
  const id = String(input.id ?? "");
  return db().transaction(async (tx: AnyTx) => {
    await lockAll(tx, { locations: [id], config: true });
    const loc = await getLocation(tx, id);
    checkVersion(loc, input.expectedVersion);
    const items = await itemsOf(tx, loc.id);
    const patch: Partial<typeof depositoUbicaciones.$inferInsert> = {};
    if (input.code !== undefined) {
      const c = parseLocationCode(input.code);
      if (!c.ok) fail(c.message);
      if (c.value !== loc.code) {
        if (!canRetireOrRename({ items })) fail(`La ubicación ${loc.code} está ocupada: liberala antes de cambiarle el código.`);
        const dup = await tx.select({ id: depositoUbicaciones.id }).from(depositoUbicaciones).where(sql`upper(${depositoUbicaciones.code}) = ${c.value} and ${depositoUbicaciones.id} <> ${loc.id}`).limit(1);
        if (dup.length) fail(`Ya existe una ubicación con el código ${c.value}.`);
        patch.code = c.value;
      }
    }
    if (input.zone !== undefined) patch.zone = cleanLabel(input.zone);
    if (["x", "y", "w", "h"].some((k) => (input as Record<string, unknown>)[k] !== undefined)) {
      const canvas = await loadConfig(tx);
      const geo = parseGeometry({ x: input.x ?? loc.x, y: input.y ?? loc.y, w: input.w ?? loc.w, h: input.h ?? loc.h }, canvas);
      if (!geo.ok) fail(geo.message);
      Object.assign(patch, geo.value);
    }
    if (input.sortOrder !== undefined) {
      if (!Number.isInteger(input.sortOrder)) fail("El orden tiene que ser un número entero.");
      patch.sortOrder = input.sortOrder as number;
    }
    if (input.active !== undefined) {
      if (typeof input.active !== "boolean") fail("Estado inválido.");
      if (!input.active && loc.active && items.length) fail(`La ubicación ${loc.code} está ocupada: liberala antes de desactivarla.`);
      patch.active = input.active;
    }
    if ((patch.active ?? loc.active) && (patch.x !== undefined || patch.active === true)) {
      const rect = { id: loc.id, x: patch.x ?? loc.x, y: patch.y ?? loc.y, w: patch.w ?? loc.w, h: patch.h ?? loc.h };
      const hit = findOverlap(rect, (await tx.select().from(depositoUbicaciones).where(eq(depositoUbicaciones.active, true))) as LocRow[]);
      if (hit) fail(`La posición se superpone con ${hit.code}. Elegí otras coordenadas.`);
    }
    const now = new Date();
    const [row] = await tx.update(depositoUbicaciones).set({ ...patch, version: loc.version + 1, updatedAt: now, updatedBy: actor.email }).where(eq(depositoUbicaciones.id, loc.id)).returning();
    await configMovement(tx, actor, row, { action: "actualizar", before: snap(loc), after: snap(row) });
    return toView(row, items);
  });
}

type ShapeInput = { id?: unknown; kind?: unknown; label?: unknown; sublabel?: unknown; x?: unknown; y?: unknown; w?: unknown; h?: unknown; points?: unknown; rotation?: unknown; sortOrder?: unknown; active?: unknown };

/** Crea o edita una forma del plano (contorno, pasillo, escalera, vacío). Las formas se desactivan, no se borran. */
export async function upsertShape(actor: UbActor, input: ShapeInput): Promise<ShapeView> {
  assertConfig(actor);
  return db().transaction(async (tx: AnyTx) => {
    await lockAll(tx, { config: true });
    const canvas = await loadConfig(tx);
    const id = typeof input.id === "string" && input.id ? input.id : "";
    const [cur] = id ? await tx.select().from(depositoMapaShapes).where(eq(depositoMapaShapes.id, id)).limit(1) : [];
    if (id && !cur) throw new OrdersNotFoundError("La forma no existe.");
    const kind = (input.kind ?? cur?.kind) as ShapeKind;
    if (!SHAPE_KINDS.includes(kind)) fail("Tipo de forma inválido.");
    let points: Array<[number, number]> | null = (cur?.points as Array<[number, number]> | null) ?? null;
    if (input.points !== undefined) {
      if (input.points === null || input.points === "") points = null;
      else {
        const p = parsePolygon(input.points, canvas);
        if (!p.ok) fail(p.message);
        points = p.value;
      }
    }
    if (kind === "CONTORNO" && !points) fail("El contorno necesita sus puntos (polígono).");
    const geoRaw = { x: input.x ?? cur?.x ?? 0, y: input.y ?? cur?.y ?? 0, w: input.w ?? cur?.w ?? 0, h: input.h ?? cur?.h ?? 0 };
    const geo = kind === "CONTORNO" ? { ok: true as const, value: { x: 0, y: 0, w: canvas.width, h: canvas.height } } : parseGeometry(geoRaw, canvas);
    if (!geo.ok) fail(geo.message);
    const values = {
      kind,
      label: input.label === undefined ? (cur?.label ?? "") : cleanLabel(input.label).slice(0, 60),
      sublabel: input.sublabel === undefined ? (cur?.sublabel ?? "") : cleanLabel(input.sublabel).slice(0, 80),
      ...geo.value,
      points: points as never,
      rotation: Number.isInteger(input.rotation) ? (input.rotation as number) : (cur?.rotation ?? 0),
      sortOrder: Number.isInteger(input.sortOrder) ? (input.sortOrder as number) : (cur?.sortOrder ?? 50),
      active: typeof input.active === "boolean" ? input.active : (cur?.active ?? true),
      updatedAt: new Date(),
      updatedBy: actor.email,
    };
    const [row] = cur
      ? await tx.update(depositoMapaShapes).set(values).where(eq(depositoMapaShapes.id, cur.id)).returning()
      : await tx.insert(depositoMapaShapes).values({ id: `forma-${randomUUID().slice(0, 8)}`, ...values }).returning();
    await configMovement(tx, actor, null, { action: cur ? "forma_actualizar" : "forma_crear", shapeId: row.id, before: cur ?? null, after: row });
    return { id: row.id, kind: row.kind as ShapeKind, label: row.label, sublabel: row.sublabel, x: row.x, y: row.y, w: row.w, h: row.h, points: (row.points as Array<[number, number]> | null) ?? null, rotation: row.rotation, sortOrder: row.sortOrder, active: row.active };
  });
}

export async function updateMapConfig(actor: UbActor, input: { title?: unknown; width?: unknown; height?: unknown }): Promise<MapConfigView> {
  assertConfig(actor);
  return db().transaction(async (tx: AnyTx) => {
    await lockAll(tx, { config: true });
    const cur = await loadConfig(tx);
    const w = input.width === undefined ? cur.width : Number(input.width);
    const h = input.height === undefined ? cur.height : Number(input.height);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 100 || h < 100 || w > 5000 || h > 5000) fail("El tamaño del plano tiene que estar entre 100 y 5000.");
    const maxX = await tx.select({ m: sql<number>`coalesce(max(${depositoUbicaciones.x} + ${depositoUbicaciones.w}), 0)`, n: sql<number>`coalesce(max(${depositoUbicaciones.y} + ${depositoUbicaciones.h}), 0)` }).from(depositoUbicaciones);
    if (w < Number(maxX[0]?.m ?? 0) || h < Number(maxX[0]?.n ?? 0)) fail("El plano quedaría más chico que las posiciones ya ubicadas. Muevé primero esas posiciones.");
    const title = input.title === undefined ? cur.title : cleanLabel(input.title).slice(0, 120) || cur.title;
    await tx.update(depositoMapaConfig).set({ viewWidth: w, viewHeight: h, title, updatedAt: new Date(), updatedBy: actor.email }).where(eq(depositoMapaConfig.id, "main"));
    await configMovement(tx, actor, null, { action: "plano", before: cur, after: { width: w, height: h, title } });
    return { width: w, height: h, title };
  });
}
