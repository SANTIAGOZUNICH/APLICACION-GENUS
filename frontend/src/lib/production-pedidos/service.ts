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
