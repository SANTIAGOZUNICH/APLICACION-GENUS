/**
 * Depósito «Entregas Producción» — Neon (producción) o memoria de proceso (vitest / sin DATABASE_URL).
 * Migración 0073: `deposito_despachos` + `deposito_despachos_audit`.
 *
 * Registro OPERATIVO de lo que sale de fábrica: NO descuenta stock, no toca MP ni elaboración y no se genera solo desde
 * «Entrega de Envasado a Producción» (son operaciones distintas). Altas idempotentes por clave del cliente; bajas lógicas;
 * cada alta / cambio de campo / baja deja una fila de auditoría con usuario, fecha, antes y después.
 */
import "server-only";

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { depositoDespachos, depositoDespachosAudit } from "@/lib/db/schema";
import { OrdersForbiddenError, OrdersNotFoundError, OrdersValidationError } from "@/lib/orders/types";
import type { SectorId } from "@/types/operational/sector";
import { canAccessDespachos, canMutateDespachos } from "./despachos-rbac";
import {
  MAX_DESPACHO_BULK_ROWS,
  MAX_DESPACHO_CELL_CHANGES,
  despachoCellProtection,
  isDespachoCellField,
  validateDespachoValue,
  type DespachoCellChange,
  type DespachoCellField,
} from "./cell-edit";
import type {
  CreateDespachoInput,
  CreateDespachoResult,
  DespachoAuditEntry,
  DespachoRecord,
  DespachosActor,
} from "./types";

type Mem = { items: Array<DespachoRecord & { deleted: boolean; idem: string | null }>; audit: DespachoAuditEntry[] };
const g = globalThis as unknown as { __genusDespachosMem?: Mem };

function mem(): Mem {
  if (!g.__genusDespachosMem) g.__genusDespachosMem = { items: [], audit: [] };
  return g.__genusDespachosMem;
}

export function resetDespachosMemoryForTests(): void {
  g.__genusDespachosMem = { items: [], audit: [] };
}

const neon = () => isDatabaseConfigured();
const memId = () => `dp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number.parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
};

function rowToDomain(r: typeof depositoDespachos.$inferSelect): DespachoRecord {
  return {
    id: r.id,
    fecha: r.fecha,
    remito: r.remito,
    cliente: r.cliente,
    producto: r.producto,
    bultos: num(r.bultos),
    cantidadTotal: num(r.cantidadTotal),
    pedidoOp: r.pedidoOp,
    createdBy: r.createdBy,
    createdBySector: r.createdBySector,
    createdAt: r.createdAt.toISOString(),
    updatedBy: r.updatedBy,
    updatedAt: r.updatedAt.toISOString(),
  };
}

function stripMem(m: Mem["items"][number]): DespachoRecord {
  const { deleted: _d, idem: _i, ...rec } = m;
  void _d;
  void _i;
  return rec;
}

function assertAccess(a: DespachosActor) {
  if (!canAccessDespachos(a.sector)) throw new OrdersForbiddenError("Este módulo está habilitado solo para Depósito, Producción y Dirección.");
}
function assertMutate(a: DespachosActor) {
  if (!canMutateDespachos(a.sector)) throw new OrdersForbiddenError("Solo Depósito puede cargar o modificar entregas a Producción.");
}

const sortRecords = (items: DespachoRecord[]) =>
  [...items].sort((a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? "") || b.createdAt.localeCompare(a.createdAt));

async function audit(
  actor: DespachosActor,
  e: { despachoId: string; action: DespachoAuditEntry["action"]; field?: string | null; before?: string | null; after?: string | null }
): Promise<void> {
  const now = new Date();
  if (neon()) {
    await getDb().insert(depositoDespachosAudit).values({
      despachoId: e.despachoId,
      action: e.action,
      field: e.field ?? null,
      beforeValue: e.before ?? null,
      afterValue: e.after ?? null,
      actorEmail: actor.email,
      actorSector: actor.sector,
      actorName: actor.displayName,
      createdAt: now,
    });
    return;
  }
  mem().audit.unshift({
    id: memId(),
    despachoId: e.despachoId,
    action: e.action,
    field: e.field ?? null,
    beforeValue: e.before ?? null,
    afterValue: e.after ?? null,
    actorEmail: actor.email,
    actorSector: actor.sector,
    actorName: actor.displayName,
    createdAt: now.toISOString(),
  });
}

/** Normaliza y valida un alta (el remito se conserva como texto). */
function normalizeInput(input: CreateDespachoInput) {
  const fecha = validateDespachoValue("fecha", input.fecha ?? "");
  if (!fecha.ok) throw new OrdersValidationError(fecha.message);
  const text = (f: DespachoCellField, v: unknown) => {
    const r = validateDespachoValue(f, v ?? "");
    if (!r.ok) throw new OrdersValidationError(r.message);
    return String(r.value);
  };
  const numeric = (f: DespachoCellField, v: unknown) => {
    const r = validateDespachoValue(f, v == null ? "" : v);
    if (!r.ok) throw new OrdersValidationError(r.message);
    return Number(r.value);
  };
  return {
    fecha: fecha.value === "" ? null : String(fecha.value),
    remito: text("remito", input.remito),
    cliente: text("cliente", input.cliente),
    producto: text("producto", input.producto),
    bultos: numeric("bultos", input.bultos),
    cantidadTotal: numeric("cantidadTotal", input.cantidadTotal),
    pedidoOp: text("pedidoOp", input.pedidoOp),
  };
}

export type DespachoCellResult =
  | { ok: true; record: DespachoRecord }
  | { ok: false; code: "NOT_FOUND" | "PROTECTED" | "INVALID" | "CONFLICT"; message: string };

export class DespachosService {
  async list(actor: DespachosActor): Promise<DespachoRecord[]> {
    assertAccess(actor);
    if (neon()) {
      const rows = await getDb()
        .select()
        .from(depositoDespachos)
        .where(isNull(depositoDespachos.deletedAt))
        .orderBy(sql`${depositoDespachos.fecha} desc nulls last`, desc(depositoDespachos.createdAt));
      return rows.map(rowToDomain);
    }
    return sortRecords(mem().items.filter((i) => !i.deleted).map(stripMem));
  }

  async get(actor: DespachosActor, id: string): Promise<DespachoRecord | null> {
    assertAccess(actor);
    if (neon()) {
      const [row] = await getDb()
        .select()
        .from(depositoDespachos)
        .where(and(eq(depositoDespachos.id, id), isNull(depositoDespachos.deletedAt)));
      return row ? rowToDomain(row) : null;
    }
    const m = mem().items.find((i) => i.id === id && !i.deleted);
    return m ? stripMem(m) : null;
  }

  async listAudit(actor: DespachosActor, despachoId: string): Promise<DespachoAuditEntry[]> {
    assertAccess(actor);
    if (neon()) {
      const rows = await getDb()
        .select()
        .from(depositoDespachosAudit)
        .where(eq(depositoDespachosAudit.despachoId, despachoId))
        .orderBy(asc(depositoDespachosAudit.createdAt));
      return rows.map((r) => ({
        id: r.id,
        despachoId: r.despachoId,
        action: r.action as DespachoAuditEntry["action"],
        field: r.field,
        beforeValue: r.beforeValue,
        afterValue: r.afterValue,
        actorEmail: r.actorEmail,
        actorSector: r.actorSector as SectorId,
        actorName: r.actorName,
        createdAt: r.createdAt.toISOString(),
      }));
    }
    return mem().audit.filter((e) => e.despachoId === despachoId).reverse();
  }

  private async findByKey(key: string): Promise<DespachoRecord | null> {
    if (neon()) {
      const [row] = await getDb().select().from(depositoDespachos).where(eq(depositoDespachos.idempotencyKey, key));
      return row ? rowToDomain(row) : null;
    }
    const m = mem().items.find((i) => i.idem === key);
    return m ? stripMem(m) : null;
  }

  /** Alta de UN despacho (una fila = un producto de una entrega). Idempotente por `idempotencyKey`. */
  async create(actor: DespachosActor, input: CreateDespachoInput): Promise<CreateDespachoResult> {
    assertMutate(actor);
    const key = input.idempotencyKey?.trim() || null;
    if (key) {
      const prev = await this.findByKey(key);
      if (prev) return { record: prev, created: false };
    }
    const v = normalizeInput(input);
    const now = new Date();
    const record: DespachoRecord = {
      id: neon() ? crypto.randomUUID() : memId(),
      ...v,
      createdBy: actor.displayName,
      createdBySector: actor.sector,
      createdAt: now.toISOString(),
      updatedBy: null,
      updatedAt: now.toISOString(),
    };
    if (neon()) {
      try {
        await getDb().insert(depositoDespachos).values({
          id: record.id,
          fecha: record.fecha,
          remito: record.remito,
          cliente: record.cliente,
          producto: record.producto,
          bultos: String(record.bultos),
          cantidadTotal: String(record.cantidadTotal),
          pedidoOp: record.pedidoOp,
          idempotencyKey: key,
          createdBy: record.createdBy,
          createdBySector: record.createdBySector,
          createdAt: now,
          updatedAt: now,
        });
      } catch (err) {
        // Carrera entre dos reintentos con la misma clave: el índice único dejó pasar uno solo.
        const prev = key ? await this.findByKey(key) : null;
        if (prev) return { record: prev, created: false };
        throw err;
      }
    } else {
      mem().items.unshift({ ...record, deleted: false, idem: key });
    }
    await audit(actor, { despachoId: record.id, action: "create", after: JSON.stringify(v) });
    return { record, created: true };
  }

  /**
   * Alta múltiple (pegado desde Excel / filas nuevas de la planilla). Cada fila es independiente (las inválidas se informan, el resto se
   * guarda). Idempotente por `idempotencyKey` de cada fila (o `batchKey:i`): reintentar el mismo lote NO duplica. En Neon es UNA lectura de
   * claves, UN insert por bloque y UN insert de auditoría (cientos de filas en una sola operación).
   */
  async createMany(
    actor: DespachosActor,
    rows: CreateDespachoInput[],
    batchKey?: string
  ): Promise<Array<{ ok: true; record: DespachoRecord; created: boolean } | { ok: false; message: string }>> {
    assertMutate(actor);
    if (rows.length === 0 || rows.length > MAX_DESPACHO_BULK_ROWS) {
      throw new OrdersValidationError(`Entre 1 y ${MAX_DESPACHO_BULK_ROWS} filas por operación.`);
    }
    type Out = { ok: true; record: DespachoRecord; created: boolean } | { ok: false; message: string };
    const out: Out[] = new Array(rows.length);
    if (!neon()) {
      for (let i = 0; i < rows.length; i += 1) {
        try {
          const r = await this.create(actor, { ...rows[i], idempotencyKey: rows[i].idempotencyKey ?? (batchKey ? `${batchKey}:${i}` : undefined) });
          out[i] = { ok: true, ...r };
        } catch (e) {
          out[i] = { ok: false, message: e instanceof Error ? e.message : "Error" };
        }
      }
      return out;
    }
    const db = getDb();
    const keys = rows.map((r, i) => r.idempotencyKey?.trim() || (batchKey ? `${batchKey}:${i}` : null));
    const known = new Map<string, DespachoRecord>();
    const wanted = [...new Set(keys.filter((k): k is string => Boolean(k)))];
    for (let i = 0; i < wanted.length; i += 200) {
      const found = await db.select().from(depositoDespachos).where(inArray(depositoDespachos.idempotencyKey, wanted.slice(i, i + 200)));
      for (const f of found) if (f.idempotencyKey) known.set(f.idempotencyKey, rowToDomain(f));
    }
    const now = new Date();
    const fresh: Array<{ index: number; record: DespachoRecord; key: string | null }> = [];
    const seen = new Set<string>();
    rows.forEach((input, i) => {
      const key = keys[i];
      const prev = key ? known.get(key) : undefined;
      if (prev) { out[i] = { ok: true, record: prev, created: false }; return; }
      if (key && seen.has(key)) { out[i] = { ok: false, message: "Fila repetida en el mismo envío." }; return; }
      try {
        const v = normalizeInput(input);
        const record: DespachoRecord = {
          id: crypto.randomUUID(), ...v, createdBy: actor.displayName, createdBySector: actor.sector,
          createdAt: now.toISOString(), updatedBy: null, updatedAt: now.toISOString(),
        };
        if (key) seen.add(key);
        fresh.push({ index: i, record, key });
      } catch (e) {
        out[i] = { ok: false, message: e instanceof Error ? e.message : "Error" };
      }
    });
    for (let i = 0; i < fresh.length; i += 200) {
      const chunk = fresh.slice(i, i + 200);
      const inserted = await db
        .insert(depositoDespachos)
        .values(chunk.map(({ record: r, key }) => ({
          id: r.id, fecha: r.fecha, remito: r.remito, cliente: r.cliente, producto: r.producto, bultos: String(r.bultos),
          cantidadTotal: String(r.cantidadTotal), pedidoOp: r.pedidoOp, idempotencyKey: key, createdBy: r.createdBy,
          createdBySector: r.createdBySector, createdAt: now, updatedAt: now,
        })))
        .onConflictDoNothing()
        .returning({ id: depositoDespachos.id });
      const ok = new Set(inserted.map((x) => x.id));
      const created = chunk.filter((c) => ok.has(c.record.id));
      if (created.length > 0) {
        await db.insert(depositoDespachosAudit).values(created.map(({ record: r }) => ({
          despachoId: r.id, action: "create", afterValue: JSON.stringify({ fecha: r.fecha, remito: r.remito, cliente: r.cliente, producto: r.producto, bultos: r.bultos, cantidadTotal: r.cantidadTotal }),
          actorEmail: actor.email, actorSector: actor.sector, actorName: actor.displayName, createdAt: now,
        })));
      }
      for (const c of chunk) {
        if (ok.has(c.record.id)) { out[c.index] = { ok: true, record: c.record, created: true }; continue; }
        // Perdió la carrera contra un reintento simultáneo con la misma clave: devuelve el registro ganador.
        const prev = c.key ? await this.findByKey(c.key) : null;
        out[c.index] = prev ? { ok: true, record: prev, created: false } : { ok: false, message: "No se pudo guardar la fila." };
      }
    }
    return out;
  }

  async patchCells(actor: DespachosActor, changes: DespachoCellChange[]): Promise<DespachoCellResult[]> {
    assertMutate(actor);
    if (changes.length === 0 || changes.length > MAX_DESPACHO_CELL_CHANGES) {
      throw new OrdersValidationError(`Entre 1 y ${MAX_DESPACHO_CELL_CHANGES} celdas por operación.`);
    }
    const results: DespachoCellResult[] = [];
    const parsed: Array<{ change: DespachoCellChange; value: string | number }> = [];
    for (const c of changes) {
      const cur = await this.get(actor, c.id);
      if (!cur) { results.push({ ok: false, code: "NOT_FOUND", message: "Registro no encontrado (puede haber sido eliminado)." }); continue; }
      if (!isDespachoCellField(c.field)) { results.push({ ok: false, code: "INVALID", message: `Campo no editable: ${String(c.field)}.` }); continue; }
      const prot = despachoCellProtection(cur, c.field, true);
      if (prot) { results.push({ ok: false, code: "PROTECTED", message: prot }); continue; }
      const v = validateDespachoValue(c.field, c.value);
      if (!v.ok) { results.push({ ok: false, code: "INVALID", message: v.message }); continue; }
      results.push({ ok: true, record: cur });
      parsed.push({ change: c, value: v.value });
    }
    if (results.some((r) => !r.ok)) return results;

    const out: DespachoCellResult[] = [];
    const versions = new Map<string, string>();
    for (const { change, value } of parsed) {
      const cur = await this.get(actor, change.id);
      if (!cur) { out.push({ ok: false, code: "NOT_FOUND", message: "Registro no encontrado." }); continue; }
      const expected = versions.get(change.id) ?? change.expectedVersion;
      if (cur.updatedAt !== expected) {
        out.push({ ok: false, code: "CONFLICT", message: "Otro usuario modificó este registro. Recargá y reintentá." });
        continue;
      }
      const rec = await this.applyField(actor, cur, change.field, value);
      versions.set(change.id, rec.updatedAt);
      out.push({ ok: true, record: rec });
    }
    return out;
  }

  private async applyField(actor: DespachosActor, cur: DespachoRecord, field: DespachoCellField, value: string | number): Promise<DespachoRecord> {
    const before = String(cur[field] ?? "");
    if (before === String(value)) return cur; // sin cambio: no toca la versión ni deja auditoría
    // La versión (updatedAt) debe crecer SIEMPRE: dos cambios en el mismo milisegundo no pueden dejar la misma versión.
    const now = new Date(Math.max(Date.now(), new Date(cur.updatedAt).getTime() + 1));
    const stored = field === "fecha" && value === "" ? null : value;
    const next: DespachoRecord = { ...cur, [field]: stored, updatedBy: actor.displayName, updatedAt: now.toISOString() };
    if (neon()) {
      const set: Partial<typeof depositoDespachos.$inferInsert> = { updatedAt: now, updatedBy: actor.displayName };
      if (field === "bultos" || field === "cantidadTotal") set[field] = String(value);
      else (set as Record<string, unknown>)[field] = stored;
      await getDb().update(depositoDespachos).set(set).where(eq(depositoDespachos.id, cur.id));
    } else {
      const idx = mem().items.findIndex((i) => i.id === cur.id);
      if (idx < 0) throw new OrdersNotFoundError("Registro no encontrado.");
      mem().items[idx] = { ...mem().items[idx], ...next };
    }
    await audit(actor, { despachoId: cur.id, action: "update", field, before, after: String(value) });
    return next;
  }

  /** Baja lógica (se conserva el registro completo y su historial). Idempotente. */
  async delete(actor: DespachosActor, id: string): Promise<boolean> {
    assertMutate(actor);
    const cur = await this.get(actor, id);
    if (!cur) return false;
    const now = new Date();
    if (neon()) {
      await getDb()
        .update(depositoDespachos)
        .set({ deletedAt: now, deletedBy: actor.displayName, updatedAt: now })
        .where(and(eq(depositoDespachos.id, id), isNull(depositoDespachos.deletedAt)));
    } else {
      const m = mem().items.find((i) => i.id === id);
      if (m) m.deleted = true;
    }
    await audit(actor, { despachoId: id, action: "delete", before: JSON.stringify({ fecha: cur.fecha, remito: cur.remito, cliente: cur.cliente, producto: cur.producto, bultos: cur.bultos, cantidadTotal: cur.cantidadTotal }) });
    return true;
  }

  async bulkDelete(
    actor: DespachosActor,
    target: { ids?: string[]; all?: boolean }
  ): Promise<{ requested: number; deleted: string[]; skipped: string[]; failed: Array<{ id: string; message: string }> }> {
    assertMutate(actor);
    const active = new Set((await this.list(actor)).map((r) => r.id));
    const ids = target.all ? [...active] : [...new Set(target.ids ?? [])];
    const deleted: string[] = [];
    const skipped: string[] = [];
    const failed: Array<{ id: string; message: string }> = [];
    for (const id of ids) {
      if (!active.has(id)) { skipped.push(id); continue; }
      try {
        if (await this.delete(actor, id)) deleted.push(id);
        else skipped.push(id);
      } catch (e) {
        failed.push({ id, message: e instanceof Error ? e.message : "Error" });
      }
    }
    return { requested: ids.length, deleted, skipped, failed };
  }
}

let singleton: DespachosService | null = null;
export function getDespachosService(): DespachosService {
  if (!singleton) singleton = new DespachosService();
  return singleton;
}
