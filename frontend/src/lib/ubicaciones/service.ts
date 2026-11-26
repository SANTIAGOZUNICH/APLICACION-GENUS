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
import { depositoIngresoUbicacion, depositoMapaConfig, depositoMapaShapes, depositoUbicacionItems, depositoUbicacionMovements, depositoUbicaciones, invMeMaterials } from "@/lib/db/schema";
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
  identityOf,
  ingresoDelta,
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
      .map((i) => ({ id: i.id, clientKey: i.clientKey, clientName: i.clientName, materialKey: i.materialKey, material: i.materialName, codigo: i.codigo, meMaterialId: i.meMaterialId, unit: i.unit, quantity: num(i.quantity), verified: Boolean(i.meMaterialId) })),
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
  const rows = await d.select({ codigo: depositoUbicacionItems.codigo, quantity: depositoUbicacionItems.quantity }).from(depositoUbicacionItems).where(sql`${depositoUbicacionItems.codigo} is not null and ${depositoUbicacionItems.meMaterialId} is not null`);
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
async function lockAll(tx: AnyTx, o: { locations?: string[]; codes?: string[]; ingresos?: string[]; config?: boolean }): Promise<void> {
  await lockKeys(tx, (o.locations ?? []).map((id) => `ubicaciones:loc:${id}`));
  await lockKeys(tx, (o.codes ?? []).map((c) => `ubicaciones:cap:${c}`));
  await lockKeys(tx, (o.ingresos ?? []).map((id) => `ubicaciones:ingreso:${id}`));
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
  verified: Boolean(i.meMaterialId),
  ...(remaining !== undefined ? { remaining } : {}),
});

export type OpResult = { replayed: boolean; movementId: string; locations: UbicacionView[]; /** Posición donde quedó (o ya estaba) el ingreso ubicado. */ placedIn?: string };
const done = async (tx: AnyTx, replayed: boolean, movementId: string, ids: string[]): Promise<OpResult> => ({ replayed, movementId, locations: await viewsOf(tx, ids) });

/** Tope por stock: cada material vinculado a ME no puede tener más cantidad distribuida que su stock disponible. Requiere el candado del código. */
async function assertStockCap(tx: AnyTx, adds: Array<{ codigo: string | null; meMaterialId: string | null; quantity: number | null; material: string }>): Promise<void> {
  // El tope solo cuenta cantidades VERIFICADAS (vinculadas a un material ME por id): el texto libre no respalda ni consume stock.
  const linked = adds.filter((a) => a.codigo && a.meMaterialId && a.quantity != null);
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
    const rows = (await tx.select({ quantity: depositoUbicacionItems.quantity }).from(depositoUbicacionItems).where(sql`${depositoUbicacionItems.codigo} = ${codigo} and ${depositoUbicacionItems.meMaterialId} is not null`)) as Array<{ quantity: string | null }>;
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

/**
 * Suma las líneas a la posición. IDENTIDAD, no texto: un material ME (id) se suma a SU renglón (mismo id + mismo cliente); un material libre crea SU
 * renglón con lote propio y solo se incrementa eligiendo explícitamente ese renglón (`mergeIntoItemId`). Devuelve el renglón resultante de cada línea.
 */
async function upsertLines(tx: AnyTx, loc: LocRow, lines: PreparedLine[], actor: UbActor, ingresoId?: string): Promise<ItemRow[]> {
  const current = await itemsOf(tx, loc.id);
  const out: ItemRow[] = [];
  for (const ln of lines) {
    let ex: ItemRow | undefined;
    if (ln.meMaterialId) ex = current.find((i) => i.meMaterialId === ln.meMaterialId && i.clientKey === ln.clientKey);
    else if (ln.mergeIntoItemId) {
      ex = current.find((i) => i.id === ln.mergeIntoItemId);
      if (!ex || ex.meMaterialId) fail("El renglón al que querés sumar ya no está en la ubicación. Actualizá la pantalla.");
      if (ex.clientKey !== ln.clientKey) fail("El renglón elegido es de otro cliente.");
    }
    if (ex) {
      const q = mergeQuantity(num(ex.quantity), ln.quantity == null ? null : toMilli(ln.quantity));
      const [upd] = await tx
        .update(depositoUbicacionItems)
        .set({ quantity: q == null ? null : String(q), updatedAt: new Date(), updatedBy: actor.email })
        .where(eq(depositoUbicacionItems.id, ex.id))
        .returning();
      current.splice(current.indexOf(ex), 1, upd);
      out.push(upd);
    } else {
      const lotKey = ln.meMaterialId ? null : randomUUID();
      const [ins] = await tx
        .insert(depositoUbicacionItems)
        .values({ locationId: loc.id, clientKey: ln.clientKey, clientName: ln.clientName, materialKey: ln.meMaterialId ? `me:${ln.meMaterialId}` : `t:${lotKey}`, materialName: ln.material, codigo: ln.codigo, meMaterialId: ln.meMaterialId, lotKey, unit: ln.unit, quantity: ln.quantity == null ? null : String(ln.quantity), ingresoId: ingresoId ?? null, updatedBy: actor.email })
        .returning();
      current.push(ins);
      out.push(ins);
    }
  }
  return out;
}

const linesOfPrepared = (lines: PreparedLine[]): MovementLine[] =>
  lines.map((l) => ({ clientName: l.clientName, clientKey: l.clientKey, material: l.material, codigo: l.codigo, meMaterialId: l.meMaterialId, unit: l.unit, quantity: l.quantity, verified: Boolean(l.meMaterialId) }));

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
    const slots = new Map(dst.map((i) => [identityOf(i), i]));
    const lines: MovementLine[] = [];
    for (const p of plan.value) {
      const src = srcItems.find((i) => i.id === p.itemId)!;
      lines.push(lineOf(src, p.moveMilli == null ? null : fromMilli(p.moveMilli), p.remainMilli == null ? null : fromMilli(p.remainMilli)));
      // Origen: primero se descuenta; después se suma al destino (todo en la misma transacción).
      if (p.whole) await tx.delete(depositoUbicacionItems).where(eq(depositoUbicacionItems.id, src.id));
      else await tx.update(depositoUbicacionItems).set({ quantity: String(fromMilli(p.remainMilli!)), updatedAt: new Date(), updatedBy: actor.email }).where(eq(depositoUbicacionItems.id, src.id));
      // El destino fusiona SOLO por identidad (mismo material ME + cliente, o el mismo lote libre): nunca por texto. La condición (verificado / sin verificar) viaja con el renglón.
      const slot = identityOf(src);
      const ex = slots.get(slot);
      if (ex) {
        const q = mergeQuantity(num(ex.quantity), p.moveMilli);
        await tx.update(depositoUbicacionItems).set({ quantity: q == null ? null : String(q), updatedAt: new Date(), updatedBy: actor.email }).where(eq(depositoUbicacionItems.id, ex.id));
        slots.set(slot, { ...ex, quantity: q == null ? null : String(q) });
      } else {
        const lotKey = src.meMaterialId ? null : (src.lotKey ?? src.id);
        const [ins] = await tx
          .insert(depositoUbicacionItems)
          .values({ locationId: to.id, clientKey: src.clientKey, clientName: src.clientName, materialKey: src.meMaterialId ? `me:${src.meMaterialId}` : `t:${lotKey}`, materialName: src.materialName, codigo: src.codigo, meMaterialId: src.meMaterialId, lotKey, unit: src.unit, quantity: p.moveMilli == null ? null : String(fromMilli(p.moveMilli)), ingresoId: src.ingresoId, updatedBy: actor.email })
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

// ───────────────────────── Vincular un renglón a un material ME ─────────────────────────

/**
 * Convierte un renglón SIN VERIFICAR (texto libre) en VERIFICADO vinculándolo a un material del inventario ME. Valida en backend el tope por stock
 * (lo ya verificado + este renglón ≤ stock disponible), es transaccional e idempotente por clave, y queda en el historial.
 */
export async function linkContent(actor: UbActor, input: { key: unknown; locationId: unknown; itemId: unknown; meMaterialId: unknown; expectedVersion?: unknown }): Promise<OpResult> {
  assertWrite(actor);
  const key = checkKey(input.key);
  const locationId = String(input.locationId ?? "");
  const itemId = String(input.itemId ?? "");
  const meMaterialId = typeof input.meMaterialId === "string" ? input.meMaterialId.trim() : "";
  if (!meMaterialId) fail("Elegí el material del inventario ME.");
  const mats = (await db().select({ payload: invMeMaterials.payload }).from(invMeMaterials)) as Array<{ payload: MeMaterial }>;
  const mat = mats.map((r) => r.payload).find((m) => m.id === meMaterialId && !m.archived);
  if (!mat) throw new OrdersNotFoundError("El material del inventario ME no existe o está archivado.");
  const codigo = normalizeMaterialCode(mat.codigo);
  if (!codigo) fail("El material ME no tiene código.");
  return db().transaction(async (tx: AnyTx) => {
    await lockAll(tx, { locations: [locationId], codes: [codigo] });
    const prev = await replayOf(tx, key);
    if (prev) return done(tx, true, prev.id, [locationId]);
    const loc = await getLocation(tx, locationId);
    checkVersion(loc, input.expectedVersion);
    const items = await itemsOf(tx, loc.id);
    const row = items.find((i) => i.id === itemId);
    if (!row) fail("El renglón ya no está en la ubicación. Actualizá la pantalla.");
    if (row.meMaterialId) fail("Este renglón ya está vinculado al inventario ME.");
    const qty = num(row.quantity);
    if (qty == null) fail("Para vincular a un material ME el renglón necesita cantidad.");
    await assertStockCap(tx, [{ codigo, meMaterialId, quantity: qty, material: row.materialName }]);
    const twin = items.find((i) => i.meMaterialId === meMaterialId && i.clientKey === row.clientKey);
    if (twin) {
      await tx.update(depositoUbicacionItems).set({ quantity: String(mergeQuantity(num(twin.quantity), toMilli(qty))), updatedAt: new Date(), updatedBy: actor.email }).where(eq(depositoUbicacionItems.id, twin.id));
      await tx.delete(depositoUbicacionItems).where(eq(depositoUbicacionItems.id, row.id));
    } else {
      await tx.update(depositoUbicacionItems).set({ meMaterialId, codigo, materialKey: `me:${meMaterialId}`, lotKey: null, updatedAt: new Date(), updatedBy: actor.email }).where(eq(depositoUbicacionItems.id, row.id));
    }
    await touch(tx, loc, actor);
    const id = await insertMovement(tx, actor, {
      kind: "AGREGADO",
      key,
      to: loc,
      lines: [{ ...lineOf({ ...row, meMaterialId, codigo }, qty), verifiedBefore: false }],
      detail: { action: "vincular", itemId, meMaterialId, codigo, merged: Boolean(twin) },
    });
    return done(tx, false, id, [loc.id]);
  });
}

// ───────────────────────── Ingresos de ME: ubicar después, anulados y modificados ─────────────────────────

type RegRow = typeof depositoIngresoUbicacion.$inferSelect;
export type IngresoPendiente = { ingresoId: string; fecha: string; ingresoNro: string; codigo: string; material: string; cliente: string; total: number; unit: string };
export type IngresoReview = { ingresoId: string; locationId: string; locationCode: string; reason: "ANULADO" | "MODIFICADO"; applied: number; current: number; diff: number; ingresoNro: string; material: string; cliente: string; unit: string };

async function readIngreso(tx: AnyTx, id: string): Promise<Record<string, unknown> | null> {
  const r = await tx.execute(sql`select payload from inv_me_ingresos where id = ${id}::uuid`);
  return ((r.rows[0] as { payload?: Record<string, unknown> } | undefined)?.payload as Record<string, unknown> | undefined) ?? null;
}
const checkIngresoId = (raw: unknown): string => {
  const id = String(raw ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) fail("El ingreso no es válido.");
  return id.toLowerCase();
};

/** Registro por ingreso (fuente de verdad). Una ubicación hecha antes de 0093 (solo movimiento INGRESO_ME) se registra acá, con la misma cantidad y lugar. */
async function loadPlacement(tx: AnyTx, ingresoId: string): Promise<RegRow | null> {
  const [reg] = await tx.select().from(depositoIngresoUbicacion).where(eq(depositoIngresoUbicacion.ingresoId, ingresoId)).limit(1);
  if (reg) return reg as RegRow;
  const [mv] = await tx.select().from(depositoUbicacionMovements).where(eq(depositoUbicacionMovements.idempotencyKey, `ingreso-me:${ingresoId}`)).limit(1);
  const line = ((mv?.lines as MovementLine[] | undefined) ?? [])[0];
  if (!mv || !mv.toLocationId || !line) return null;
  const items = await itemsOf(tx, mv.toLocationId);
  const item = items.find((i) => i.ingresoId === ingresoId) ?? items.find((i) => (line.meMaterialId ? i.meMaterialId === line.meMaterialId && i.clientKey === line.clientKey : i.clientKey === line.clientKey && i.materialName === line.material));
  const [row] = await tx
    .insert(depositoIngresoUbicacion)
    .values({ ingresoId, locationId: mv.toLocationId, locationCode: mv.toCode ?? "", status: "UBICADO", appliedQuantity: String(line.quantity ?? 0), clientKey: line.clientKey, clientName: line.clientName, materialName: line.material, codigo: line.codigo, meMaterialId: line.meMaterialId, lotKey: line.meMaterialId ? null : (item ? (item.lotKey ?? item.id) : null), unit: line.unit, movementId: mv.id, createdBy: mv.actorEmail })
    .onConflictDoNothing()
    .returning();
  if (row) return row as RegRow;
  const [again] = await tx.select().from(depositoIngresoUbicacion).where(eq(depositoIngresoUbicacion.ingresoId, ingresoId)).limit(1);
  return (again as RegRow | undefined) ?? null;
}

/** Dónde está hoy el renglón de este ingreso en su ubicación de registro (por identidad, nunca por texto; los registros anteriores caen al texto). */
function rowOfRegistry(items: ItemRow[], reg: RegRow): ItemRow | undefined {
  if (reg.meMaterialId) return items.find((i) => i.meMaterialId === reg.meMaterialId && i.clientKey === reg.clientKey);
  if (reg.lotKey) return items.find((i) => !i.meMaterialId && (i.lotKey ?? i.id) === reg.lotKey);
  return items.find((i) => !i.meMaterialId && i.clientKey === reg.clientKey && i.materialName === reg.materialName);
}

async function peekPlacement(ingresoId: string): Promise<{ locationId: string; codigo: string | null } | null> {
  const d = db();
  const [reg] = await d.select().from(depositoIngresoUbicacion).where(eq(depositoIngresoUbicacion.ingresoId, ingresoId)).limit(1);
  let locationId: string | null = reg?.locationId ?? null;
  let codigo: string | null = reg?.codigo ?? null;
  if (!locationId) {
    const [mv] = await d.select().from(depositoUbicacionMovements).where(eq(depositoUbicacionMovements.idempotencyKey, `ingreso-me:${ingresoId}`)).limit(1);
    locationId = mv?.toLocationId ?? null;
    codigo = ((mv?.lines as MovementLine[] | undefined) ?? [])[0]?.codigo ?? null;
  }
  return locationId ? { locationId, codigo } : null;
}

const withPlaced = (r: OpResult, code: string): OpResult => ({ ...r, placedIn: code });

/**
 * Ubica un INGRESO de ME ya creado. Lee el ingreso de Postgres (cliente / material / cantidad: el cliente no manda cantidades) y suma el total a la
 * posición UNA sola vez: el registro `deposito_ingreso_ubicacion` por ingresoId es la fuente de verdad. Reintentos, doble clic y pedidos concurrentes
 * devuelven lo ya registrado (`replayed`) aunque se pida otra posición: mover después es un traslado normal, nunca una re-suma.
 * NO es atómico con el ingreso (el inventario ME persiste por su propio mecanismo): si falla, el ingreso queda y se ubica después desde la lista
 * «Ingresos ME sin ubicar» (o de nuevo desde el formulario).
 */
export async function placeIngresoMe(actor: UbActor, input: { ingresoId: unknown; locationId: unknown; clientName?: unknown }): Promise<OpResult> {
  assertWrite(actor);
  const ingresoId = checkIngresoId(input.ingresoId);
  const locationId = String(input.locationId ?? "");
  const pre = await readIngreso(db(), ingresoId);
  if (!pre) throw new OrdersNotFoundError("El ingreso todavía no está registrado: guardalo primero.");
  const codigo0 = normalizeMaterialCode(pre.codigo) || null;
  const mats = codigo0 ? ((await db().select({ payload: invMeMaterials.payload }).from(invMeMaterials)) as Array<{ payload: MeMaterial }>).map((r) => r.payload).filter((m) => normalizeMaterialCode(m.codigo) === codigo0) : [];
  return db().transaction(async (tx: AnyTx) => {
    await lockAll(tx, { locations: [locationId], codes: codigo0 ? [codigo0] : [], ingresos: [ingresoId] });
    const reg = await loadPlacement(tx, ingresoId);
    if (reg) return withPlaced(await done(tx, true, reg.movementId ?? "", [reg.locationId]), reg.locationCode);
    const ing = await readIngreso(tx, ingresoId);
    if (!ing) throw new OrdersNotFoundError("El ingreso todavía no está registrado: guardalo primero.");
    if (ing.anulado) fail("El ingreso está anulado: no se puede ubicar.");
    const total = Number(ing.total ?? 0);
    if (!(total > 0)) fail("El ingreso no tiene cantidad total: cargá BULTOS y CANTIDAD para ubicarlo.");
    const clientName = cleanLabel(ing.cliente) || cleanLabel(input.clientName);
    const mat = mats.find((m) => m.id === ing.materialId) ?? mats.find((m) => !m.archived) ?? mats[0];
    const parsed = parseLineInput({ clientName, material: cleanLabel(ing.descripcionInsumo) || codigo0 || "Material de envase", quantity: total, unit: mat?.unidad || "u", codigo: mat ? codigo0 : null, meMaterialId: mat?.id ?? null });
    if (!parsed.ok) fail(parsed.message);
    const line = parsed.value;
    const loc = await getLocation(tx, locationId, { activeOnly: true });
    await assertStockCap(tx, [{ codigo: line.codigo, meMaterialId: line.meMaterialId, quantity: line.quantity, material: line.material }]);
    const [row] = await upsertLines(tx, loc, [line], actor, ingresoId);
    await touch(tx, loc, actor);
    const id = await insertMovement(tx, actor, { kind: "INGRESO_ME", key: `ingreso-me:${ingresoId}`, to: loc, lines: linesOfPrepared([line]), detail: { ingresoId, ingresoNro: ing.ingresoNro ?? null, action: "ubicar" } });
    await tx.insert(depositoIngresoUbicacion).values({ ingresoId, locationId: loc.id, locationCode: loc.code, status: "UBICADO", appliedQuantity: String(total), clientKey: line.clientKey, clientName: line.clientName, materialName: line.material, codigo: line.codigo, meMaterialId: line.meMaterialId, lotKey: line.meMaterialId ? null : (row!.lotKey ?? row!.id), unit: line.unit, movementId: id, createdBy: actor.email });
    return withPlaced(await done(tx, false, id, [loc.id]), loc.code);
  });
}

/** Ingreso modificado después de ubicarlo: ajusta SOLO la diferencia contra lo aplicado (idempotente: sin diferencia no hace nada; nunca re-suma el total). */
export async function adjustIngresoMe(actor: UbActor, input: { ingresoId: unknown }): Promise<OpResult> {
  assertWrite(actor);
  const ingresoId = checkIngresoId(input.ingresoId);
  const peek = await peekPlacement(ingresoId);
  if (!peek) throw new OrdersNotFoundError("Este ingreso todavía no fue ubicado: usá «Ubicar».");
  const pre = await readIngreso(db(), ingresoId);
  const codigo = normalizeMaterialCode(pre?.codigo) || peek.codigo;
  return db().transaction(async (tx: AnyTx) => {
    await lockAll(tx, { locations: [peek.locationId], codes: codigo ? [codigo] : [], ingresos: [ingresoId] });
    const reg = await loadPlacement(tx, ingresoId);
    if (!reg) throw new OrdersNotFoundError("Este ingreso todavía no fue ubicado: usá «Ubicar».");
    if (reg.status === "RETIRADO") fail("La cantidad de este ingreso ya fue retirada del mapa.");
    const ing = await readIngreso(tx, ingresoId);
    if (!ing) throw new OrdersNotFoundError("El ingreso no existe.");
    if (ing.anulado) fail("El ingreso está anulado: usá «Retirar cantidad» para sacarlo del mapa.");
    const applied = Number(reg.appliedQuantity);
    const total = Number(ing.total ?? 0);
    const d = ingresoDelta(total, applied);
    if (d.kind === "IGUAL") return withPlaced(await done(tx, true, reg.movementId ?? "", [reg.locationId]), reg.locationCode);
    const loc = await getLocation(tx, reg.locationId, { activeOnly: d.kind === "AUMENTO" });
    const items = await itemsOf(tx, loc.id);
    const row = rowOfRegistry(items, reg);
    const absMilli = Math.abs(d.diffMilli);
    if (d.kind === "AUMENTO") {
      await assertStockCap(tx, [{ codigo: reg.codigo, meMaterialId: reg.meMaterialId, quantity: fromMilli(absMilli), material: reg.materialName }]);
      if (row) await tx.update(depositoUbicacionItems).set({ quantity: String(mergeQuantity(num(row.quantity), absMilli)), updatedAt: new Date(), updatedBy: actor.email }).where(eq(depositoUbicacionItems.id, row.id));
      else {
        const lotKey = reg.meMaterialId ? null : (reg.lotKey ?? randomUUID());
        await tx.insert(depositoUbicacionItems).values({ locationId: loc.id, clientKey: reg.clientKey, clientName: reg.clientName, materialKey: reg.meMaterialId ? `me:${reg.meMaterialId}` : `t:${lotKey}`, materialName: reg.materialName, codigo: reg.codigo, meMaterialId: reg.meMaterialId, lotKey, unit: reg.unit, quantity: String(fromMilli(absMilli)), ingresoId, updatedBy: actor.email });
      }
    } else {
      const have = row?.quantity == null ? 0 : toMilli(Number(row.quantity));
      if (!row || have < absMilli) fail(`El ingreso bajó ${fmtQtyServer(fromMilli(absMilli))} pero en ${loc.code} no queda tanto de este material (hay ${fmtQtyServer(fromMilli(have))}). Traelo de vuelta o retiralo a mano y volvé a ajustar.`);
      if (have === absMilli) await tx.delete(depositoUbicacionItems).where(eq(depositoUbicacionItems.id, row.id));
      else await tx.update(depositoUbicacionItems).set({ quantity: String(fromMilli(have - absMilli)), updatedAt: new Date(), updatedBy: actor.email }).where(eq(depositoUbicacionItems.id, row.id));
    }
    await touch(tx, loc, actor);
    const line: MovementLine = { clientName: reg.clientName, clientKey: reg.clientKey, material: reg.materialName, codigo: reg.codigo, meMaterialId: reg.meMaterialId, unit: reg.unit, quantity: fromMilli(absMilli), verified: Boolean(reg.meMaterialId) };
    const id = await insertMovement(tx, actor, { kind: "INGRESO_ME", key: `ingreso-ajuste:${ingresoId}:${reg.rev}`, to: loc, lines: [line], detail: { action: "ajuste_ingreso", ingresoId, before: applied, after: total, direction: d.kind } });
    await tx.update(depositoIngresoUbicacion).set({ appliedQuantity: String(total), rev: reg.rev + 1, updatedAt: new Date() }).where(eq(depositoIngresoUbicacion.ingresoId, ingresoId));
    return withPlaced(await done(tx, false, id, [loc.id]), loc.code);
  });
}

const fmtQtyServer = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 3 });

/** Ingreso anulado después de ubicarlo: retira del mapa la cantidad registrada (queda en el historial; no se borra ningún registro). Idempotente. */
export async function retireAnuladoIngreso(actor: UbActor, input: { ingresoId: unknown }): Promise<OpResult> {
  assertWrite(actor);
  const ingresoId = checkIngresoId(input.ingresoId);
  const peek = await peekPlacement(ingresoId);
  if (!peek) throw new OrdersNotFoundError("Este ingreso no fue ubicado en el mapa.");
  return db().transaction(async (tx: AnyTx) => {
    await lockAll(tx, { locations: [peek.locationId], ingresos: [ingresoId] });
    const reg = await loadPlacement(tx, ingresoId);
    if (!reg) throw new OrdersNotFoundError("Este ingreso no fue ubicado en el mapa.");
    if (reg.status === "RETIRADO") return withPlaced(await done(tx, true, reg.movementId ?? "", [reg.locationId]), reg.locationCode);
    const ing = await readIngreso(tx, ingresoId);
    if (!ing?.anulado) fail("El ingreso no está anulado: no hay nada que retirar por esta vía.");
    const loc = await getLocation(tx, reg.locationId);
    const items = await itemsOf(tx, loc.id);
    const row = rowOfRegistry(items, reg);
    const applied = toMilli(Number(reg.appliedQuantity));
    const have = row?.quantity == null ? 0 : toMilli(Number(row.quantity));
    if (applied > 0 && (!row || have < applied)) fail(`En ${loc.code} no queda toda la cantidad de este ingreso (hay ${fmtQtyServer(fromMilli(have))} y hay que retirar ${fmtQtyServer(fromMilli(applied))}). Traela de vuelta o retirala a mano.`);
    if (row && applied > 0) {
      if (have === applied) await tx.delete(depositoUbicacionItems).where(eq(depositoUbicacionItems.id, row.id));
      else await tx.update(depositoUbicacionItems).set({ quantity: String(fromMilli(have - applied)), updatedAt: new Date(), updatedBy: actor.email }).where(eq(depositoUbicacionItems.id, row.id));
    }
    await touch(tx, loc, actor);
    const line: MovementLine = { clientName: reg.clientName, clientKey: reg.clientKey, material: reg.materialName, codigo: reg.codigo, meMaterialId: reg.meMaterialId, unit: reg.unit, quantity: fromMilli(applied), verified: Boolean(reg.meMaterialId) };
    const id = await insertMovement(tx, actor, { kind: "RETIRO", key: `ingreso-retiro:${ingresoId}`, from: loc, lines: [line], detail: { action: "ingreso_anulado", ingresoId } });
    await tx.update(depositoIngresoUbicacion).set({ status: "RETIRADO", appliedQuantity: "0", rev: reg.rev + 1, updatedAt: new Date() }).where(eq(depositoIngresoUbicacion.ingresoId, ingresoId));
    return withPlaced(await done(tx, false, id, [loc.id]), loc.code);
  });
}

/** Ingresos ME sin ubicar (no anulados, sin registro) y ubicados que hay que revisar (anulados o con cantidad modificada). */
export async function listIngresos(actor: UbActor, q?: string): Promise<{ unplaced: IngresoPendiente[]; review: IngresoReview[] }> {
  assertRead(actor);
  const d = db();
  const needle = (q ?? "").trim();
  const un = await d.execute(sql`
    select i.id::text as id, i.payload from inv_me_ingresos i
    where coalesce(i.payload->>'anulado', 'false') <> 'true'
      and jsonb_typeof(i.payload->'total') = 'number' and (i.payload->>'total')::numeric > 0
      and not exists (select 1 from deposito_ingreso_ubicacion r where r.ingreso_id = i.id::text)
      and not exists (select 1 from deposito_ubicacion_movements m where m.idempotency_key = 'ingreso-me:' || i.id::text)
      and (${needle} = '' or i.payload::text ilike '%' || ${needle} || '%')
    order by i.payload->>'fecha' desc nulls last, i.updated_at desc limit 100`);
  const unplaced = (un.rows as Array<{ id: string; payload: Record<string, unknown> }>).map((r) => ({
    ingresoId: r.id,
    fecha: String(r.payload.fecha ?? ""),
    ingresoNro: String(r.payload.ingresoNro ?? ""),
    codigo: String(r.payload.codigo ?? ""),
    material: String(r.payload.descripcionInsumo ?? r.payload.codigo ?? ""),
    cliente: String(r.payload.cliente ?? ""),
    total: Number(r.payload.total ?? 0),
    unit: String(r.payload.unidad ?? "u"),
  }));
  const rv = await d.execute(sql`
    select r.ingreso_id, r.location_id, r.location_code, r.applied_quantity, r.unit, r.material_name, r.client_name, i.payload
    from deposito_ingreso_ubicacion r join inv_me_ingresos i on i.id::text = r.ingreso_id where r.status = 'UBICADO'`);
  const review: IngresoReview[] = [];
  for (const r of rv.rows as Array<{ ingreso_id: string; location_id: string; location_code: string; applied_quantity: string; unit: string; material_name: string; client_name: string; payload: Record<string, unknown> }>) {
    const applied = Number(r.applied_quantity);
    const current = Number(r.payload.total ?? 0);
    const reason = r.payload.anulado ? "ANULADO" : toMilli(current) !== toMilli(applied) ? "MODIFICADO" : null;
    if (reason) review.push({ ingresoId: r.ingreso_id, locationId: r.location_id, locationCode: r.location_code, reason, applied, current, diff: fromMilli(toMilli(current) - toMilli(applied)), ingresoNro: String(r.payload.ingresoNro ?? ""), material: r.material_name, cliente: r.client_name, unit: r.unit });
  }
  return { unplaced, review };
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
