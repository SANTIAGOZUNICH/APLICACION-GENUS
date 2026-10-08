import "server-only";

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { isFeatureMemoryAllowed } from "@/lib/db/feature-schema";
import { isSuperadminEmail } from "@/lib/auth/superadmin";
import { recordLifecycleEvent } from "@/lib/lifecycle/audit";
import { normalizeOptionalReason } from "@/lib/lifecycle/reason";
import {
  OrdersForbiddenError,
  OrdersNotFoundError,
  OrdersValidationError,
} from "@/lib/orders/types";
import type { SectorId } from "@/types/operational/sector";
import { duplicateKeyFromRecord } from "./excel-paste";
import {
  MAX_PEDIDO_CELL_CHANGES,
  isPedidoCellField,
  pedidoCellProtection,
  type PedidoCellChange,
  type PedidoCellFailure,
} from "./cell-edit";
import {
  canAccessProductionPedidos,
  coercePedidoFields,
  toPublicRecord,
  type ProductionPedidoInput,
  type ProductionPedidoListFilters,
  type ProductionPedidoRecord,
  type ProductionPedidoStatus,
  type ProductionPedidosActor,
} from "./types";

type Mem = {
  rows: ProductionPedidoRecord[];
  imports: Map<string, ImportManyResult>;
};
const g = globalThis as unknown as { __genusProductionPedidosMem?: Mem };

function mem(): Mem {
  if (!g.__genusProductionPedidosMem) {
    g.__genusProductionPedidosMem = { rows: [], imports: new Map() };
  }
  if (!g.__genusProductionPedidosMem.imports) {
    g.__genusProductionPedidosMem.imports = new Map();
  }
  return g.__genusProductionPedidosMem;
}

export function resetProductionPedidosMemoryForTests(): void {
  g.__genusProductionPedidosMem = { rows: [], imports: new Map() };
}

/** Rechazo atómico de un PATCH por celdas de Pedidos: NADA se aplicó. */
export class PedidoCellPatchError extends Error {
  readonly status: number;
  constructor(readonly failures: PedidoCellFailure[]) {
    super(failures.length === 1 ? failures[0]!.message : `${failures.length} celdas rechazadas — no se guardó ningún cambio.`);
    this.name = "PedidoCellPatchError";
    this.status = failures.some((f) => f.code === "CONFLICT") ? 409 : failures.some((f) => f.code === "PROTECTED" || f.code === "FORBIDDEN") ? 403 : 400;
  }
}

const sameMs = (a: string, b: string) => {
  const x = new Date(a).getTime();
  return Number.isFinite(x) && x === new Date(b).getTime();
};

export type ImportManyResult = {
  created: ProductionPedidoRecord[];
  inserted: number;
  rejected: number;
  duplicateWarnings: number;
  idempotentReplay: boolean;
};

let schemaCache: boolean | null = null;
let schemaCacheAt = 0;

export function resetProductionPedidosSchemaCache(): void {
  schemaCache = null;
  schemaCacheAt = 0;
}

export async function isProductionPedidosSchemaReady(): Promise<boolean> {
  if (isFeatureMemoryAllowed()) return true;
  if (!isDatabaseConfigured()) return false;
  const now = Date.now();
  if (schemaCache != null && now - schemaCacheAt < 30_000) return schemaCache;
  try {
    const db = getDb();
    await db.execute(sql`select 1 from production_pedidos limit 1`);
    schemaCache = true;
  } catch {
    schemaCache = false;
  }
  schemaCacheAt = now;
  return schemaCache;
}

function enrichActor(actor: ProductionPedidosActor): ProductionPedidosActor {
  return {
    ...actor,
    isSuperadmin: actor.isSuperadmin || isSuperadminEmail(actor.email),
  };
}

function assertAccess(actor: ProductionPedidosActor): ProductionPedidosActor {
  const a = enrichActor(actor);
  if (!canAccessProductionPedidos(a)) {
    throw new OrdersForbiddenError("Solo PRODUCCIÓN puede acceder a Pedidos.");
  }
  return a;
}

function nowIso(): string {
  return new Date().toISOString();
}

function mapRow(row: Record<string, unknown>): ProductionPedidoRecord {
  const fechaVal = row.fecha;
  const fecha =
    fechaVal == null
      ? null
      : typeof fechaVal === "string"
        ? fechaVal.slice(0, 10)
        : new Date(String(fechaVal)).toISOString().slice(0, 10);
  const q = row.q == null ? null : Number(row.q);
  const ml = row.ml == null ? null : Number(row.ml);
  const estado = row.estado == null ? null : (String(row.estado) as ProductionPedidoStatus);
  return toPublicRecord({
    id: String(row.id),
    op: row.op == null ? null : String(row.op),
    fecha,
    nroOc: row.nro_oc == null ? null : String(row.nro_oc),
    cliente: row.cliente == null ? null : String(row.cliente),
    producto: row.producto == null ? null : String(row.producto),
    s: row.s == null ? null : String(row.s),
    q: q != null && Number.isFinite(q) ? q : null,
    ml: ml != null && Number.isFinite(ml) ? ml : null,
    kg: null,
    estado,
    createdBy: row.created_by == null ? null : String(row.created_by),
    createdBySector: row.created_by_sector == null ? null : String(row.created_by_sector),
    updatedBy: row.updated_by == null ? null : String(row.updated_by),
    deletedAt: row.deleted_at ? new Date(String(row.deleted_at)).toISOString() : null,
    deletedBy: row.deleted_by == null ? null : String(row.deleted_by),
    deleteReason: row.delete_reason == null ? null : String(row.delete_reason),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  });
}

function matchesFilters(r: ProductionPedidoRecord, f: ProductionPedidoListFilters): boolean {
  if (!f.includeDeleted && r.deletedAt) return false;
  if (f.op && !(r.op ?? "").toLowerCase().includes(f.op.trim().toLowerCase())) return false;
  if (f.nroOc && !(r.nroOc ?? "").toLowerCase().includes(f.nroOc.trim().toLowerCase())) return false;
  if (f.cliente && !(r.cliente ?? "").toLowerCase().includes(f.cliente.trim().toLowerCase()))
    return false;
  if (f.producto && !(r.producto ?? "").toLowerCase().includes(f.producto.trim().toLowerCase()))
    return false;
  if (f.estado) {
    const st = f.estado.trim().toUpperCase().replace(/\s+/g, "_");
    if ((r.estado ?? "") !== st) return false;
  }
  if (f.fechaFrom && (r.fecha ?? "") < f.fechaFrom) return false;
  if (f.fechaTo && (r.fecha ?? "") > f.fechaTo) return false;
  if (f.search) {
    const needle = f.search.trim().toLowerCase();
    const haystack = [r.op, r.cliente, r.producto].map((v) => (v ?? "").toLowerCase());
    if (!haystack.some((v) => v.includes(needle))) return false;
  }
  return true;
}

async function assertWrites(): Promise<"memory" | "db"> {
  if (isFeatureMemoryAllowed() && !(await isProductionPedidosSchemaReady())) return "memory";
  if (!(await isProductionPedidosSchemaReady())) {
    throw new OrdersValidationError(
      "Base de datos pendiente de actualización. Los cambios están deshabilitados."
    );
  }
  if (isFeatureMemoryAllowed() && !isDatabaseConfigured()) return "memory";
  if (!isDatabaseConfigured()) {
    throw new OrdersValidationError("Base de datos no configurada.");
  }
  return isFeatureMemoryAllowed() && process.env.GENUS_FEATURE_MEMORY === "1"
    ? "memory"
    : "db";
}

function useMemory(): boolean {
  return isFeatureMemoryAllowed() && (!isDatabaseConfigured() || process.env.VITEST === "true");
}

export class ProductionPedidosService {
  async list(
    actor: ProductionPedidosActor,
    filters: ProductionPedidoListFilters = {}
  ): Promise<{ items: ProductionPedidoRecord[]; schemaPending: boolean }> {
    assertAccess(actor);
    const ready = await isProductionPedidosSchemaReady();
    if (!ready) {
      if (useMemory()) {
        return {
          items: mem().rows.filter((r) => matchesFilters(r, filters)),
          schemaPending: false,
        };
      }
      return { items: [], schemaPending: true };
    }
    if (useMemory()) {
      return {
        items: mem()
          .rows.filter((r) => matchesFilters(r, filters))
          .sort((a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? "") || b.createdAt.localeCompare(a.createdAt)),
        schemaPending: false,
      };
    }

    const db = getDb();
    const op = filters.op?.trim() || null;
    const nroOc = filters.nroOc?.trim() || null;
    const cliente = filters.cliente?.trim() || null;
    const producto = filters.producto?.trim() || null;
    const estado = filters.estado?.trim()
      ? filters.estado.trim().toUpperCase().replace(/\s+/g, "_")
      : null;
    const fechaFrom = filters.fechaFrom || null;
    const fechaTo = filters.fechaTo || null;
    const includeDeleted = Boolean(filters.includeDeleted);
    const search = filters.search?.trim() || null;

    const result = await db.execute(sql`
      select * from production_pedidos
      where (${includeDeleted} or deleted_at is null)
        and (${op}::text is null or op ilike '%' || ${op} || '%')
        and (${nroOc}::text is null or nro_oc ilike '%' || ${nroOc} || '%')
        and (${cliente}::text is null or cliente ilike '%' || ${cliente} || '%')
        and (${producto}::text is null or producto ilike '%' || ${producto} || '%')
        and (${estado}::text is null or estado = ${estado})
        and (${fechaFrom}::text is null or fecha >= ${fechaFrom}::date)
        and (${fechaTo}::text is null or fecha <= ${fechaTo}::date)
        and (
          ${search}::text is null
          or op ilike '%' || ${search} || '%'
          or cliente ilike '%' || ${search} || '%'
          or producto ilike '%' || ${search} || '%'
        )
      order by fecha desc nulls last, created_at desc
      limit 2000
    `);
    const rows = (result.rows as Record<string, unknown>[]).map(mapRow);
    return { items: rows, schemaPending: false };
  }

  async create(
    actor: ProductionPedidosActor,
    input: ProductionPedidoInput
  ): Promise<ProductionPedidoRecord> {
    const a = assertAccess(actor);
    const mode = await assertWrites();
    const fields = coercePedidoFields(input);
    if (fields.errors.length) {
      throw new OrdersValidationError(fields.errors.join("; "));
    }
    const now = nowIso();
    const record = toPublicRecord({
      id: randomUUID(),
      ...fields,
      createdBy: a.email,
      createdBySector: String(a.sector),
      updatedBy: a.email,
      deletedAt: null,
      deletedBy: null,
      deleteReason: null,
      createdAt: now,
      updatedAt: now,
    });

    if (mode === "memory" || useMemory()) {
      mem().rows.unshift(record);
      recordLifecycleEvent({
        entityKind: "pedido",
        entityId: record.id,
        action: "crear",
        actor: { email: a.email, sector: a.sector as SectorId },
      });
      return record;
    }

    const db = getDb();
    await db.execute(sql`
      insert into production_pedidos (
        id, op, fecha, nro_oc, cliente, producto, s, q, ml, kg, estado,
        created_by, created_by_sector, updated_by, created_at, updated_at
      ) values (
        ${record.id}::uuid,
        ${record.op},
        ${record.fecha}::date,
        ${record.nroOc},
        ${record.cliente},
        ${record.producto},
        ${record.s},
        ${record.q},
        ${record.ml},
        ${record.kg},
        ${record.estado},
        ${record.createdBy},
        ${record.createdBySector},
        ${record.updatedBy},
        ${now}::timestamptz,
        ${now}::timestamptz
      )
    `);
    recordLifecycleEvent({
      entityKind: "pedido",
      entityId: record.id,
      action: "crear",
      actor: { email: a.email, sector: a.sector as SectorId },
      impact: { op: record.op, nroOc: record.nroOc },
    });
    return record;
  }

  async update(
    actor: ProductionPedidosActor,
    id: string,
    input: ProductionPedidoInput
  ): Promise<ProductionPedidoRecord> {
    const a = assertAccess(actor);
    const mode = await assertWrites();
    const fields = coercePedidoFields(input);
    if (fields.errors.length) {
      throw new OrdersValidationError(fields.errors.join("; "));
    }
    const now = nowIso();

    if (mode === "memory" || useMemory()) {
      const idx = mem().rows.findIndex((r) => r.id === id && !r.deletedAt);
      if (idx < 0) throw new OrdersNotFoundError("Pedido no encontrado.");
      const prev = mem().rows[idx]!;
      const next = toPublicRecord({
        ...prev,
        ...fields,
        updatedBy: a.email,
        updatedAt: now,
      });
      mem().rows[idx] = next;
      recordLifecycleEvent({
        entityKind: "pedido",
        entityId: id,
        action: "editar",
        actor: { email: a.email, sector: a.sector as SectorId },
      });
      return next;
    }

    const db = getDb();
    const existing = await db.execute(sql`
      select * from production_pedidos where id = ${id}::uuid and deleted_at is null limit 1
    `);
    if (!(existing.rows as unknown[]).length) {
      throw new OrdersNotFoundError("Pedido no encontrado.");
    }
    await db.execute(sql`
      update production_pedidos set
        op = ${fields.op},
        fecha = ${fields.fecha}::date,
        nro_oc = ${fields.nroOc},
        cliente = ${fields.cliente},
        producto = ${fields.producto},
        s = ${fields.s},
        q = ${fields.q},
        ml = ${fields.ml},
        kg = ${fields.kg},
        estado = ${fields.estado},
        updated_by = ${a.email},
        updated_at = ${now}::timestamptz
      where id = ${id}::uuid
    `);
    recordLifecycleEvent({
      entityKind: "pedido",
      entityId: id,
      action: "editar",
      actor: { email: a.email, sector: a.sector as SectorId },
    });
    const refreshed = await db.execute(sql`
      select * from production_pedidos where id = ${id}::uuid limit 1
    `);
    return mapRow((refreshed.rows as Record<string, unknown>[])[0]!);
  }

  /**
   * Edición por celda (grilla Excel): PATCH parcial y atómico. Solo se escriben las columnas editadas
   * (+ KG derivado si cambia Q/ML), con validación server-side, protección de estado/pedidos cerrados,
   * control de concurrencia por `updatedAt` y auditoría por celda. Nunca reemplaza el registro completo.
   */
  async patchCells(
    actor: ProductionPedidosActor,
    changes: PedidoCellChange[]
  ): Promise<{ items: ProductionPedidoRecord[]; changedCells: number }> {
    const a = assertAccess(actor);
    const mode = await assertWrites();
    if (!Array.isArray(changes) || changes.length === 0) throw new OrdersValidationError("No hay cambios para guardar.");
    if (changes.length > MAX_PEDIDO_CELL_CHANGES) throw new OrdersValidationError(`Máximo ${MAX_PEDIDO_CELL_CHANGES} celdas por operación.`);

    const ids = [...new Set(changes.map((c) => String(c?.id ?? "")))];
    const current = new Map<string, ProductionPedidoRecord>();
    const useMem = mode === "memory" || useMemory();
    if (useMem) {
      for (const r of mem().rows) if (ids.includes(r.id) && !r.deletedAt) current.set(r.id, r);
    } else {
      const db = getDb();
      for (const id of ids) {
        const res = await db.execute(sql`select * from production_pedidos where id = ${id}::uuid and deleted_at is null limit 1`);
        const row = (res.rows as Record<string, unknown>[])[0];
        if (row) current.set(id, mapRow(row));
      }
    }

    const failures: PedidoCellFailure[] = [];
    const merged = new Map<string, ProductionPedidoRecord>(current);
    const touched = new Map<string, Array<{ field: string; oldValue: string; newValue: string }>>();
    changes.forEach((c, index) => {
      const fail = (code: PedidoCellFailure["code"], message: string) => failures.push({ index, id: String(c?.id ?? ""), field: String(c?.field ?? ""), code, message });
      const rec = current.get(c?.id);
      if (!rec) return fail("NOT_FOUND", "El pedido ya no existe.");
      if (!isPedidoCellField(c.field)) return fail("PROTECTED", "Columna no editable.");
      const reason = pedidoCellProtection(rec, c.field);
      if (reason) return fail("PROTECTED", reason);
      if (!c.expectedVersion || !sameMs(rec.updatedAt, c.expectedVersion)) return fail("CONFLICT", "Otro usuario modificó este pedido. Recargá antes de editar.");
      const base = merged.get(rec.id)!;
      const input = {
        op: base.op, fecha: base.fecha, nroOc: base.nroOc, cliente: base.cliente, producto: base.producto, s: base.s, q: base.q, ml: base.ml, estado: base.estado,
        [c.field]: String(c.value ?? "").trim() === "" ? null : c.value,
      };
      const fields = coercePedidoFields(input as ProductionPedidoInput);
      if (fields.errors.length) return fail("INVALID", fields.errors.join("; "));
      const next = toPublicRecord({ ...base, ...fields });
      const before = String((base as unknown as Record<string, unknown>)[c.field] ?? "");
      const after = String((next as unknown as Record<string, unknown>)[c.field] ?? "");
      if (before !== after) {
        merged.set(rec.id, next);
        const list = touched.get(rec.id) ?? [];
        list.push({ field: c.field, oldValue: before, newValue: after });
        touched.set(rec.id, list);
      }
    });
    if (failures.length) throw new PedidoCellPatchError(failures);

    // updatedAt es la versión de concurrencia: tiene que cambiar SIEMPRE (aunque caiga en el mismo ms).
    const nowFor = (id: string) => new Date(Math.max(Date.now(), new Date(current.get(id)!.updatedAt).getTime() + 1)).toISOString();
    const stamp = new Map([...touched.keys()].map((id) => [id, nowFor(id)] as const));
    const updated: ProductionPedidoRecord[] = [];
    for (const id of touched.keys()) {
      updated.push(toPublicRecord({ ...merged.get(id)!, updatedBy: a.email, updatedAt: stamp.get(id)! }));
    }
    if (updated.length === 0) return { items: [...current.values()], changedCells: 0 };

    if (useMem) {
      // Re-chequeo síncrono de versión justo antes de escribir (sin await en medio): equivale al CAS de Neon.
      for (const [id] of touched) {
        const cur = mem().rows.find((r) => r.id === id);
        if (!cur || cur.updatedAt !== current.get(id)!.updatedAt) {
          throw new PedidoCellPatchError([{ index: changes.findIndex((c) => c.id === id), id, field: changes.find((c) => c.id === id)?.field ?? "", code: "CONFLICT", message: "Otro usuario modificó este pedido. Recargá antes de editar." }]);
        }
      }
      for (const u of updated) {
        const i = mem().rows.findIndex((r) => r.id === u.id);
        if (i >= 0) mem().rows[i] = u;
      }
    } else {
      const db = getDb();
      await db.transaction(async (tx) => {
        for (const [id, edits] of touched) {
          const m = merged.get(id)!;
          const colOf: Record<string, string> = { op: "op", fecha: "fecha", nroOc: "nro_oc", cliente: "cliente", producto: "producto", s: "s", q: "q", ml: "ml" };
          const sets = edits.map((e) => sql`${sql.raw(`"${colOf[e.field]}"`)} = ${(m as unknown as Record<string, unknown>)[e.field] ?? null}`);
          if (edits.some((e) => e.field === "q" || e.field === "ml")) sets.push(sql`"kg" = ${m.kg}`);
          const res = await tx.execute(sql`
            update production_pedidos set ${sql.join(sets, sql`, `)}, updated_by = ${a.email}, updated_at = ${stamp.get(id)!}::timestamptz
            where id = ${id}::uuid and deleted_at is null
              and date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${current.get(id)!.updatedAt}::timestamptz)
            returning id
          `);
          if (!(res.rows as unknown[]).length) {
            throw new PedidoCellPatchError([{ index: changes.findIndex((c) => c.id === id), id, field: edits[0]!.field, code: "CONFLICT", message: "Otro usuario modificó este pedido. Recargá antes de editar." }]);
          }
        }
      });
    }
    for (const [id, edits] of touched) {
      for (const e of edits) {
        recordLifecycleEvent({
          entityKind: "pedido",
          entityId: id,
          action: "editar_celda",
          actor: { email: a.email, sector: a.sector as SectorId },
          impact: { field: e.field, oldValue: e.oldValue, newValue: e.newValue },
        });
      }
    }
    return { items: updated, changedCells: [...touched.values()].reduce((n, l) => n + l.length, 0) };
  }

  async remove(
    actor: ProductionPedidosActor,
    id: string,
    reason: string
  ): Promise<ProductionPedidoRecord> {
    const a = assertAccess(actor);
    const mode = await assertWrites();
    const trimmed = normalizeOptionalReason(reason);
    const now = nowIso();

    if (mode === "memory" || useMemory()) {
      const idx = mem().rows.findIndex((r) => r.id === id && !r.deletedAt);
      if (idx < 0) throw new OrdersNotFoundError("Pedido no encontrado.");
      const prev = mem().rows[idx]!;
      const next: ProductionPedidoRecord = {
        ...prev,
        deletedAt: now,
        deletedBy: a.email,
        deleteReason: trimmed,
        updatedBy: a.email,
        updatedAt: now,
      };
      mem().rows[idx] = next;
      recordLifecycleEvent({
        entityKind: "pedido",
        entityId: id,
        action: "eliminar",
        actor: { email: a.email, sector: a.sector as SectorId },
        reason: trimmed,
        impact: { preservesAudit: true, stockReversals: [] },
      });
      return next;
    }

    const db = getDb();
    const existing = await db.execute(sql`
      select * from production_pedidos where id = ${id}::uuid and deleted_at is null limit 1
    `);
    if (!(existing.rows as unknown[]).length) {
      throw new OrdersNotFoundError("Pedido no encontrado.");
    }
    await db.execute(sql`
      update production_pedidos set
        deleted_at = ${now}::timestamptz,
        deleted_by = ${a.email},
        delete_reason = ${trimmed},
        updated_by = ${a.email},
        updated_at = ${now}::timestamptz
      where id = ${id}::uuid
    `);
    recordLifecycleEvent({
      entityKind: "pedido",
      entityId: id,
      action: "eliminar",
      actor: { email: a.email, sector: a.sector as SectorId },
      reason: trimmed,
      impact: { preservesAudit: true, stockReversals: [] },
    });
    const refreshed = await db.execute(sql`
      select * from production_pedidos where id = ${id}::uuid limit 1
    `);
    return mapRow((refreshed.rows as Record<string, unknown>[])[0]!);
  }

  async importMany(
    actor: ProductionPedidosActor,
    inputs: ProductionPedidoInput[],
    options?: { idempotencyKey?: string | null }
  ): Promise<ImportManyResult> {
    const a = assertAccess(actor);
    const key = options?.idempotencyKey?.trim() || "";
    if (key) {
      if (key.length < 8 || key.length > 128) {
        throw new OrdersValidationError("Clave de importación inválida.");
      }
      const cached = mem().imports.get(key);
      if (cached) return { ...cached, idempotentReplay: true };
      if (!useMemory() && isDatabaseConfigured()) {
        try {
          const db = getDb();
          const prior = await db.execute(sql`
            select payload from feature_audit_events
            where domain = 'production_pedidos'
              and action = 'import'
              and idempotency_key = ${key}
            order by created_at desc
            limit 1
          `);
          const row = (prior.rows as Record<string, unknown>[])[0];
          if (row?.payload && typeof row.payload === "object") {
            const payload = row.payload as ImportManyResult;
            if (Array.isArray(payload.created)) {
              const replay = { ...payload, idempotentReplay: true };
              mem().imports.set(key, replay);
              return replay;
            }
          }
        } catch {
          /* feature_audit may be absent — continue */
        }
      }
    }

    const mode = await assertWrites();
    const created: ProductionPedidoRecord[] = [];
    let rejected = 0;
    let duplicateWarnings = 0;
    const existingKeys = new Set((await this.duplicateKeys(a)).map((k) => k.toLowerCase()));

    const accepted: ProductionPedidoInput[] = [];
    for (const input of inputs) {
      const fields = coercePedidoFields({ ...input, kg: undefined });
      if (fields.errors.length) {
        rejected += 1;
        continue;
      }
      const dk = duplicateKeyFromRecord(fields);
      if (existingKeys.has(dk) && dk !== "||||") duplicateWarnings += 1;
      accepted.push({
        op: fields.op,
        fecha: fields.fecha,
        nroOc: fields.nroOc,
        cliente: fields.cliente,
        producto: fields.producto,
        s: fields.s,
        q: fields.q,
        ml: fields.ml,
        estado: fields.estado,
      });
    }

    if (mode === "memory" || useMemory()) {
      for (const input of accepted) {
        created.push(await this.create(a, input));
      }
    } else if (accepted.length) {
      const db = getDb();
      const now = nowIso();
      await db.transaction(async (tx) => {
        for (const input of accepted) {
          const fields = coercePedidoFields({ ...input, kg: undefined });
          const id = randomUUID();
          await tx.execute(sql`
            insert into production_pedidos (
              id, op, fecha, nro_oc, cliente, producto, s, q, ml, kg, estado,
              created_by, created_by_sector, updated_by, created_at, updated_at
            ) values (
              ${id}::uuid,
              ${fields.op},
              ${fields.fecha},
              ${fields.nroOc},
              ${fields.cliente},
              ${fields.producto},
              ${fields.s},
              ${fields.q},
              ${fields.ml},
              ${fields.kg},
              ${fields.estado},
              ${a.email},
              ${String(a.sector)},
              ${a.email},
              ${now}::timestamptz,
              ${now}::timestamptz
            )
          `);
          created.push(
            toPublicRecord({
              id,
              ...fields,
              createdBy: a.email,
              createdBySector: String(a.sector),
              updatedBy: a.email,
              deletedAt: null,
              deletedBy: null,
              deleteReason: null,
              createdAt: now,
              updatedAt: now,
            })
          );
          recordLifecycleEvent({
            entityKind: "pedido",
            entityId: id,
            action: "crear",
            actor: { email: a.email, sector: a.sector as SectorId },
            impact: { via: "import" },
          });
        }
        if (key) {
          await tx
            .execute(sql`
            insert into feature_audit_events (
              id, domain, action, actor_email, actor_sector, entity_id, idempotency_key, payload, created_at
            ) values (
              ${randomUUID()}::uuid,
              'production_pedidos',
              'import',
              ${a.email},
              ${String(a.sector)},
              null,
              ${key},
              ${JSON.stringify({
                inserted: created.length,
                rejected,
                duplicateWarnings,
                createdIds: created.map((c) => c.id),
              })}::jsonb,
              ${now}::timestamptz
            )
          `)
            .catch(() => undefined);
        }
      });
    }

    const result: ImportManyResult = {
      created,
      inserted: created.length,
      rejected,
      duplicateWarnings,
      idempotentReplay: false,
    };
    if (key) mem().imports.set(key, result);
    return result;
  }

  async duplicateKeys(actor: ProductionPedidosActor): Promise<string[]> {
    const { items } = await this.list(actor, {});
    return items.map(duplicateKeyFromRecord);
  }
}

let singleton: ProductionPedidosService | null = null;
export function getProductionPedidosService(): ProductionPedidosService {
  if (!singleton) singleton = new ProductionPedidosService();
  return singleton;
}
