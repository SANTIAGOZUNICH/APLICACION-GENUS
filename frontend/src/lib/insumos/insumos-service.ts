/**
 * Módulo INSUMOS — servicio de servidor (Postgres, migración 0088). SOLO CONSUMO: no toca stock general, MP ni ME.
 *
 * - Un retiro y TODOS sus renglones se guardan en UNA transacción, con su evento «CREADO».
 * - Idempotencia: `client_request_id` único; un reintento / doble toque devuelve el mismo retiro (created=false).
 * - El sector del retiro sale SIEMPRE de la sesión del actor (nunca del cuerpo) y el responsable tiene que pertenecer a ese sector.
 * - Corregir / anular: solo Administración y Dirección, con motivo; eventos inmutables con antes/después. Sin borrados definitivos
 *   (un renglón quitado en una corrección queda en cantidad 0).
 */
import "server-only";

import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured, type GenusDb } from "@/lib/db/client";
import { insumoItems, insumoResponsables, insumoRetiroEvents, insumoRetiroItems, insumoRetiros } from "@/lib/db/schema";
import { OrdersForbiddenError, OrdersNotFoundError, OrdersUnavailableError, OrdersValidationError } from "@/lib/orders/types";
import type { SectorId } from "@/types/operational/sector";
import { refreshAlertAfterCatalogChange, syncRetiroStock } from "./stock-service";
import { dayEndInstant, dayStartInstant, isDayKey } from "./insumos-reports";
import {
  INSUMO_RESPONSABLE_SECTORS,
  canAdminInsumos,
  canRegisterInsumos,
  isInsumoSector,
  isValidClientRequestId,
  normalizeLines,
  normalizeName,
  responsableAllowedForSector,
  responsablesForSector,
  slugify,
  validateMotivo,
} from "./insumos-rules";
import type {
  CatalogResponse,
  CreateRetiroInput,
  CreateRetiroResult,
  InsumoActor,
  InsumoFilters,
  InsumoItem,
  InsumoResponsable,
  Retiro,
  RetiroEvent,
  RetiroSnapshot,
} from "./types";

type Tx = Parameters<Parameters<GenusDb["transaction"]>[0]>[0];
type Db = GenusDb | Tx;

export const MAX_LIST_ROWS = 3000;

function db(): GenusDb {
  if (!isDatabaseConfigured()) throw new OrdersUnavailableError("La base de datos no está configurada: el módulo Insumos necesita Postgres.");
  return getDb();
}

function assertRegister(a: InsumoActor) {
  if (!canRegisterInsumos(a.sector)) throw new OrdersForbiddenError("Tu sector no registra retiros de insumos. Administración y Dirección consultan los reportes.");
}
function assertAdmin(a: InsumoActor) {
  if (!canAdminInsumos(a.sector)) throw new OrdersForbiddenError("Solo Administración y Dirección pueden consultar reportes, corregir, anular y administrar el catálogo.");
}

const pgCode = (err: unknown): string | null => {
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur && typeof cur === "object"; i++) {
    const c = (cur as { code?: unknown }).code;
    if (typeof c === "string" && /^[0-9A-Z]{5}$/.test(c)) return c;
    cur = (cur as { cause?: unknown }).cause;
  }
  return null;
};
const isUniqueViolation = (err: unknown) => pgCode(err) === "23505";

const toItem = (r: typeof insumoItems.$inferSelect): InsumoItem => ({ id: r.id, name: r.name, active: r.active, sortOrder: r.sortOrder });
const toResponsable = (r: typeof insumoResponsables.$inferSelect): InsumoResponsable => ({ id: r.id, sector: r.sector as SectorId, name: r.name, active: r.active, sortOrder: r.sortOrder });

// ───────────────────────── Lectura de retiros ─────────────────────────

async function hydrate(d: Db, rows: Array<typeof insumoRetiros.$inferSelect>): Promise<Retiro[]> {
  if (rows.length === 0) return [];
  const lines = await d.select().from(insumoRetiroItems).where(inArray(insumoRetiroItems.retiroId, rows.map((r) => r.id)));
  const byRetiro = new Map<string, Retiro["lines"]>();
  for (const l of lines) {
    if (l.cantidad <= 0) continue; // renglón quitado en una corrección: se conserva en la base pero no se muestra
    const arr = byRetiro.get(l.retiroId) ?? [];
    arr.push({ insumoId: l.insumoId, insumoName: l.insumoName, cantidad: l.cantidad });
    byRetiro.set(l.retiroId, arr);
  }
  return rows.map((r) => ({
    id: r.id,
    sector: r.sector as SectorId,
    responsableId: r.responsableId,
    responsableName: r.responsableName,
    registradoPorEmail: r.registradoPorEmail,
    registradoPorName: r.registradoPorName,
    registradoPorSector: r.registradoPorSector,
    status: r.status === "ANULADO" ? "ANULADO" : "ACTIVO",
    anuladoAt: r.anuladoAt?.toISOString() ?? null,
    anuladoBy: r.anuladoBy,
    anuladoMotivo: r.anuladoMotivo,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    lines: (byRetiro.get(r.id) ?? []).sort((a, b) => a.insumoName.localeCompare(b.insumoName, "es")),
  }));
}

async function loadRetiro(d: Db, id: string): Promise<Retiro | null> {
  const [row] = await d.select().from(insumoRetiros).where(eq(insumoRetiros.id, id));
  return row ? (await hydrate(d, [row]))[0]! : null;
}

const snapshot = (r: Retiro): RetiroSnapshot => ({ responsableId: r.responsableId, responsableName: r.responsableName, status: r.status, lines: r.lines });

async function addEvent(d: Db, actor: InsumoActor, e: { retiroId: string; action: "CREADO" | "CORREGIDO" | "ANULADO"; motivo?: string | null; before: RetiroSnapshot | null; after: RetiroSnapshot | null }) {
  await d.insert(insumoRetiroEvents).values({
    retiroId: e.retiroId,
    action: e.action,
    actorEmail: actor.email,
    actorName: actor.displayName,
    actorSector: actor.sector,
    motivo: e.motivo ?? null,
    beforeData: e.before,
    afterData: e.after,
  });
}

// ───────────────────────── Catálogo ─────────────────────────

/** Catálogo para la pantalla. Quien registra ve SOLO insumos activos y los responsables activos de su sector; Admin/Dirección con `all` ven todo. */
export async function getCatalog(actor: InsumoActor, opts: { all?: boolean } = {}): Promise<CatalogResponse> {
  const d = db();
  const canRegister = canRegisterInsumos(actor.sector);
  const canAdmin = canAdminInsumos(actor.sector);
  const items = (await d.select().from(insumoItems).orderBy(asc(insumoItems.sortOrder), asc(insumoItems.name))).map(toItem);
  const responsables = (await d.select().from(insumoResponsables).orderBy(asc(insumoResponsables.sector), asc(insumoResponsables.sortOrder), asc(insumoResponsables.name))).map(toResponsable);
  if (canAdmin && opts.all) return { items, responsables, registrationSector: null, canRegister: false, canAdmin };
  if (canAdmin) return { items: items.filter((i) => i.active), responsables: responsables.filter((r) => r.active), registrationSector: null, canRegister: false, canAdmin };
  if (!canRegister) throw new OrdersForbiddenError("Tu sector no tiene acceso al módulo de insumos.");
  return { items: items.filter((i) => i.active), responsables: responsablesForSector(responsables, actor.sector), registrationSector: actor.sector, canRegister, canAdmin };
}

async function nextSort(d: Db, table: "items" | "responsables", sector?: string): Promise<number> {
  const rows =
    table === "items"
      ? await d.select({ n: sql<number>`coalesce(max(${insumoItems.sortOrder}), 0)` }).from(insumoItems)
      : await d.select({ n: sql<number>`coalesce(max(${insumoResponsables.sortOrder}), 0)` }).from(insumoResponsables).where(eq(insumoResponsables.sector, sector ?? ""));
  return Number(rows[0]?.n ?? 0) + 1;
}

async function uniqueId(d: Db, table: "items" | "responsables", base: string): Promise<string> {
  const col = table === "items" ? insumoItems.id : insumoResponsables.id;
  const tbl = table === "items" ? insumoItems : insumoResponsables;
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const rows = await d.select({ id: col }).from(tbl).where(eq(col, candidate));
    if (rows.length === 0) return candidate;
  }
  throw new OrdersValidationError("No se pudo generar un identificador para el nuevo registro.");
}

export async function createInsumoItem(actor: InsumoActor, input: { name: unknown }): Promise<InsumoItem> {
  assertAdmin(actor);
  const name = normalizeName(input.name);
  if (!name.ok) throw new OrdersValidationError(name.message);
  const d = db();
  try {
    return await d.transaction(async (tx) => {
      const id = await uniqueId(tx, "items", slugify(name.value) || "insumo");
      const [row] = await tx.insert(insumoItems).values({ id, name: name.value, sortOrder: await nextSort(tx, "items"), createdBy: actor.email, updatedBy: actor.email }).returning();
      return toItem(row!);
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new OrdersValidationError(`Ya existe el insumo «${name.value}».`);
    throw e;
  }
}

export async function updateInsumoItem(actor: InsumoActor, id: string, patch: { name?: unknown; active?: unknown; sortOrder?: unknown }): Promise<InsumoItem> {
  assertAdmin(actor);
  const set: Partial<typeof insumoItems.$inferInsert> = { updatedBy: actor.email, updatedAt: new Date() };
  if (patch.name !== undefined) {
    const n = normalizeName(patch.name);
    if (!n.ok) throw new OrdersValidationError(n.message);
    set.name = n.value;
  }
  if (patch.active !== undefined) set.active = Boolean(patch.active);
  if (patch.sortOrder !== undefined) {
    if (!Number.isInteger(patch.sortOrder)) throw new OrdersValidationError("El orden tiene que ser un número entero.");
    set.sortOrder = patch.sortOrder as number;
  }
  try {
    const [row] = await db().update(insumoItems).set(set).where(eq(insumoItems.id, id)).returning();
    if (!row) throw new OrdersNotFoundError("No existe ese insumo.");
    if (patch.active !== undefined) await refreshAlertAfterCatalogChange(id); // un insumo de baja no alerta; al reactivarlo vuelve a evaluarse
    return toItem(row);
  } catch (e) {
    if (isUniqueViolation(e)) throw new OrdersValidationError("Ya existe un insumo con ese nombre.");
    throw e;
  }
}

export async function reorderInsumoItems(actor: InsumoActor, orderedIds: string[]): Promise<InsumoItem[]> {
  assertAdmin(actor);
  const d = db();
  await d.transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) await tx.update(insumoItems).set({ sortOrder: i + 1, updatedBy: actor.email, updatedAt: new Date() }).where(eq(insumoItems.id, orderedIds[i]!));
  });
  return (await d.select().from(insumoItems).orderBy(asc(insumoItems.sortOrder), asc(insumoItems.name))).map(toItem);
}

export async function createResponsable(actor: InsumoActor, input: { sector: unknown; name: unknown }): Promise<InsumoResponsable> {
  assertAdmin(actor);
  const sector = typeof input.sector === "string" ? input.sector : "";
  if (!isInsumoSector(sector) || !(INSUMO_RESPONSABLE_SECTORS as readonly string[]).includes(sector)) throw new OrdersValidationError("Elegí un sector operativo válido para el responsable.");
  const name = normalizeName(input.name);
  if (!name.ok) throw new OrdersValidationError(name.message);
  const d = db();
  try {
    return await d.transaction(async (tx) => {
      const id = await uniqueId(tx, "responsables", `${slugify(sector)}-${slugify(name.value) || "responsable"}`);
      const [row] = await tx.insert(insumoResponsables).values({ id, sector, name: name.value, sortOrder: await nextSort(tx, "responsables", sector), createdBy: actor.email, updatedBy: actor.email }).returning();
      return toResponsable(row!);
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new OrdersValidationError(`Ya existe «${name.value}» en ese sector.`);
    throw e;
  }
}

/** El sector de un responsable NO se cambia (los retiros históricos quedan atados a su sector): para mover a alguien se da de baja y se crea en el otro sector. */
export async function updateResponsable(actor: InsumoActor, id: string, patch: { name?: unknown; active?: unknown; sortOrder?: unknown }): Promise<InsumoResponsable> {
  assertAdmin(actor);
  const set: Partial<typeof insumoResponsables.$inferInsert> = { updatedBy: actor.email, updatedAt: new Date() };
  if (patch.name !== undefined) {
    const n = normalizeName(patch.name);
    if (!n.ok) throw new OrdersValidationError(n.message);
    set.name = n.value;
  }
  if (patch.active !== undefined) set.active = Boolean(patch.active);
  if (patch.sortOrder !== undefined) {
    if (!Number.isInteger(patch.sortOrder)) throw new OrdersValidationError("El orden tiene que ser un número entero.");
    set.sortOrder = patch.sortOrder as number;
  }
  try {
    const [row] = await db().update(insumoResponsables).set(set).where(eq(insumoResponsables.id, id)).returning();
    if (!row) throw new OrdersNotFoundError("No existe ese responsable.");
    return toResponsable(row);
  } catch (e) {
    if (isUniqueViolation(e)) throw new OrdersValidationError("Ya existe un responsable con ese nombre en el sector.");
    throw e;
  }
}

export async function reorderResponsables(actor: InsumoActor, sector: string, orderedIds: string[]): Promise<InsumoResponsable[]> {
  assertAdmin(actor);
  const d = db();
  await d.transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.update(insumoResponsables).set({ sortOrder: i + 1, updatedBy: actor.email, updatedAt: new Date() }).where(and(eq(insumoResponsables.id, orderedIds[i]!), eq(insumoResponsables.sector, sector)));
    }
  });
  return (await d.select().from(insumoResponsables).orderBy(asc(insumoResponsables.sector), asc(insumoResponsables.sortOrder))).map(toResponsable);
}

// ───────────────────────── Alta de retiros ─────────────────────────

export async function createRetiro(actor: InsumoActor, input: CreateRetiroInput): Promise<CreateRetiroResult> {
  assertRegister(actor);
  if (!isValidClientRequestId(input.clientRequestId)) throw new OrdersValidationError("Falta la clave del intento de retiro (clientRequestId).");
  const lines = normalizeLines(input.lines);
  if (!lines.ok) throw new OrdersValidationError(lines.message);
  if (typeof input.responsableId !== "string" || !input.responsableId) throw new OrdersValidationError("Elegí el responsable del retiro.");
  const d = db();

  const existingFor = async (): Promise<CreateRetiroResult | null> => {
    const [row] = await d.select().from(insumoRetiros).where(eq(insumoRetiros.clientRequestId, input.clientRequestId));
    if (!row) return null;
    if (row.registradoPorEmail !== actor.email || row.sector !== actor.sector) throw new OrdersValidationError("Esa clave de intento ya fue usada por otro registro.", "INSUMOS_IDEMPOTENCY_CONFLICT");
    return { retiro: (await hydrate(d, [row]))[0]!, created: false };
  };

  // Reintento / doble toque: devuelve el retiro ya guardado sin volver a validar contra el catálogo.
  const already = await existingFor();
  if (already) return already;

  const created = await d.transaction(async (tx): Promise<string | null> => {
    const [resp] = await tx.select().from(insumoResponsables).where(eq(insumoResponsables.id, input.responsableId));
    if (!resp) throw new OrdersValidationError("El responsable elegido no existe.");
    if (!responsableAllowedForSector({ sector: resp.sector as SectorId, active: resp.active }, actor.sector)) {
      throw new OrdersForbiddenError(resp.sector !== actor.sector ? "Ese responsable no pertenece a tu sector." : "Ese responsable está dado de baja.");
    }
    const items = await tx.select().from(insumoItems).where(inArray(insumoItems.id, lines.value.map((l) => l.insumoId)));
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const l of lines.value) {
      const it = byId.get(l.insumoId);
      if (!it) throw new OrdersValidationError("Uno de los insumos no existe en el catálogo.");
      if (!it.active) throw new OrdersValidationError(`El insumo «${it.name}» está dado de baja.`);
    }
    const inserted = await tx
      .insert(insumoRetiros)
      .values({
        clientRequestId: input.clientRequestId,
        sector: actor.sector,
        responsableId: resp.id,
        responsableName: resp.name,
        registradoPorEmail: actor.email,
        registradoPorName: actor.displayName,
        registradoPorSector: actor.sector,
      })
      .onConflictDoNothing({ target: insumoRetiros.clientRequestId })
      .returning({ id: insumoRetiros.id });
    if (inserted.length === 0) return null; // carrera: otro intento con la MISMA clave ganó; se devuelve ese
    const retiroId = inserted[0]!.id;
    await tx.insert(insumoRetiroItems).values(lines.value.map((l) => ({ retiroId, insumoId: l.insumoId, insumoName: byId.get(l.insumoId)!.name, cantidad: l.cantidad })));
    const full = await loadRetiro(tx, retiroId);
    await addEvent(tx, actor, { retiroId, action: "CREADO", before: null, after: snapshot(full!) });
    // Descuento de stock en la MISMA transacción (varios insumos = una sola transacción). Nunca bloquea el retiro por falta de stock.
    await syncRetiroStock(tx, retiroId, actor);
    return retiroId;
  });

  if (created) return { retiro: (await loadRetiro(d, created))!, created: true };
  const winner = await existingFor();
  if (!winner) throw new OrdersValidationError("No se pudo registrar el retiro. Probá de nuevo.");
  return winner;
}

// ───────────────────────── Reportes / historial ─────────────────────────

export function sanitizeFilters(raw: InsumoFilters): InsumoFilters {
  const f: InsumoFilters = {};
  if (raw.from) {
    if (!isDayKey(raw.from)) throw new OrdersValidationError("La fecha «desde» no es válida.");
    f.from = raw.from;
  }
  if (raw.to) {
    if (!isDayKey(raw.to)) throw new OrdersValidationError("La fecha «hasta» no es válida.");
    f.to = raw.to;
  }
  if (f.from && f.to && f.from > f.to) throw new OrdersValidationError("«Desde» no puede ser posterior a «hasta».");
  if (raw.sector) f.sector = String(raw.sector);
  if (raw.responsableId) f.responsableId = String(raw.responsableId);
  if (raw.insumoId) f.insumoId = String(raw.insumoId);
  return f;
}

/** Historial completo (incluye ANULADOS, marcados) con los filtros pedidos. Solo Administración y Dirección. */
export async function listRetiros(actor: InsumoActor, rawFilters: InsumoFilters = {}, limit = MAX_LIST_ROWS): Promise<{ retiros: Retiro[]; truncated: boolean }> {
  assertAdmin(actor);
  const f = sanitizeFilters(rawFilters);
  const cap = Math.min(Math.max(1, limit), MAX_LIST_ROWS);
  const conds = [];
  if (f.from) conds.push(gte(insumoRetiros.createdAt, dayStartInstant(f.from)));
  if (f.to) conds.push(lte(insumoRetiros.createdAt, dayEndInstant(f.to)));
  if (f.sector) conds.push(eq(insumoRetiros.sector, f.sector));
  if (f.responsableId) conds.push(eq(insumoRetiros.responsableId, f.responsableId));
  if (f.insumoId) conds.push(sql`exists (select 1 from ${insumoRetiroItems} ri where ri.retiro_id = ${insumoRetiros.id} and ri.insumo_id = ${f.insumoId} and ri.cantidad > 0)`);
  const d = db();
  const rows = await d.select().from(insumoRetiros).where(conds.length ? and(...conds) : undefined).orderBy(desc(insumoRetiros.createdAt)).limit(cap + 1);
  const truncated = rows.length > cap;
  return { retiros: await hydrate(d, rows.slice(0, cap)), truncated };
}

export async function listRetiroEvents(actor: InsumoActor, retiroId: string): Promise<RetiroEvent[]> {
  assertAdmin(actor);
  const rows = await db().select().from(insumoRetiroEvents).where(eq(insumoRetiroEvents.retiroId, retiroId)).orderBy(asc(insumoRetiroEvents.createdAt), asc(insumoRetiroEvents.id));
  return rows.map((e) => ({
    id: e.id,
    retiroId: e.retiroId,
    action: e.action as RetiroEvent["action"],
    actorEmail: e.actorEmail,
    actorName: e.actorName,
    actorSector: e.actorSector,
    motivo: e.motivo,
    before: (e.beforeData as RetiroSnapshot | null) ?? null,
    after: (e.afterData as RetiroSnapshot | null) ?? null,
    createdAt: e.createdAt.toISOString(),
  }));
}

// ───────────────────────── Corregir / anular ─────────────────────────

export type CorrectRetiroInput = { motivo: unknown; responsableId?: string; lines?: unknown };

export async function correctRetiro(actor: InsumoActor, retiroId: string, input: CorrectRetiroInput): Promise<Retiro> {
  assertAdmin(actor);
  const motivo = validateMotivo(input.motivo);
  if (!motivo.ok) throw new OrdersValidationError(motivo.message);
  const newLines = input.lines === undefined ? null : normalizeLines(input.lines);
  if (newLines && !newLines.ok) throw new OrdersValidationError(newLines.message);
  return db().transaction(async (tx) => {
    const [row] = await tx.select().from(insumoRetiros).where(eq(insumoRetiros.id, retiroId)).for("update");
    if (!row) throw new OrdersNotFoundError("No existe ese retiro.");
    if (row.status === "ANULADO") throw new OrdersValidationError("Un retiro anulado no se puede corregir.");
    const before = (await loadRetiro(tx, retiroId))!;
    let respId = row.responsableId;
    let respName = row.responsableName;
    if (input.responsableId && input.responsableId !== row.responsableId) {
      const [resp] = await tx.select().from(insumoResponsables).where(eq(insumoResponsables.id, input.responsableId));
      if (!resp) throw new OrdersValidationError("El responsable elegido no existe.");
      if (!responsableAllowedForSector({ sector: resp.sector as SectorId, active: resp.active }, row.sector as SectorId)) throw new OrdersValidationError("El responsable tiene que pertenecer al sector del retiro y estar activo.");
      respId = resp.id;
      respName = resp.name;
    }
    if (newLines && newLines.ok) {
      const current = await tx.select().from(insumoRetiroItems).where(eq(insumoRetiroItems.retiroId, retiroId));
      const curById = new Map(current.map((c) => [c.insumoId, c]));
      const cat = await tx.select().from(insumoItems).where(inArray(insumoItems.id, newLines.value.map((l) => l.insumoId)));
      const catById = new Map(cat.map((c) => [c.id, c]));
      for (const l of newLines.value) {
        const it = catById.get(l.insumoId);
        if (!it) throw new OrdersValidationError("Uno de los insumos no existe en el catálogo.");
        if (!it.active && !curById.has(l.insumoId)) throw new OrdersValidationError(`El insumo «${it.name}» está dado de baja.`);
      }
      const keep = new Set(newLines.value.map((l) => l.insumoId));
      for (const l of newLines.value) {
        const cur = curById.get(l.insumoId);
        if (cur) await tx.update(insumoRetiroItems).set({ cantidad: l.cantidad }).where(eq(insumoRetiroItems.id, cur.id));
        else await tx.insert(insumoRetiroItems).values({ retiroId, insumoId: l.insumoId, insumoName: catById.get(l.insumoId)!.name, cantidad: l.cantidad });
      }
      for (const c of current) if (!keep.has(c.insumoId) && c.cantidad > 0) await tx.update(insumoRetiroItems).set({ cantidad: 0 }).where(eq(insumoRetiroItems.id, c.id));
    }
    if (respId !== row.responsableId) await tx.update(insumoRetiros).set({ responsableId: respId, responsableName: respName }).where(eq(insumoRetiros.id, retiroId));
    const after = (await loadRetiro(tx, retiroId))!;
    const changed = JSON.stringify(snapshot(before)) !== JSON.stringify(snapshot(after));
    if (!changed) throw new OrdersValidationError("No hay cambios para guardar.");
    await tx.update(insumoRetiros).set({ updatedAt: new Date() }).where(eq(insumoRetiros.id, retiroId));
    await addEvent(tx, actor, { retiroId, action: "CORREGIDO", motivo: motivo.value, before: snapshot(before), after: snapshot(after) });
    await syncRetiroStock(tx, retiroId, actor); // ajusta solo la diferencia
    return (await loadRetiro(tx, retiroId))!;
  });
}

export async function anularRetiro(actor: InsumoActor, retiroId: string, rawMotivo: unknown): Promise<Retiro> {
  assertAdmin(actor);
  const motivo = validateMotivo(rawMotivo);
  if (!motivo.ok) throw new OrdersValidationError(motivo.message);
  return db().transaction(async (tx) => {
    const [row] = await tx.select().from(insumoRetiros).where(eq(insumoRetiros.id, retiroId)).for("update");
    if (!row) throw new OrdersNotFoundError("No existe ese retiro.");
    const before = (await loadRetiro(tx, retiroId))!;
    if (row.status === "ANULADO") return before; // idempotente: no se duplica el evento
    const now = new Date();
    await tx.update(insumoRetiros).set({ status: "ANULADO", anuladoAt: now, anuladoBy: actor.email, anuladoMotivo: motivo.value, updatedAt: now }).where(eq(insumoRetiros.id, retiroId));
    const after = (await loadRetiro(tx, retiroId))!;
    await addEvent(tx, actor, { retiroId, action: "ANULADO", motivo: motivo.value, before: snapshot(before), after: snapshot(after) });
    await syncRetiroStock(tx, retiroId, actor); // revierte lo descontado
    return after;
  });
}
