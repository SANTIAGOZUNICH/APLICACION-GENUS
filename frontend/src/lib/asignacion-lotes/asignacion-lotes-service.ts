/**
 * Asignación de lotes — Neon (Production) o memoria de proceso (vitest / sin DATABASE_URL).
 */
import "server-only";

import { desc, eq } from "drizzle-orm";
import { parseFlexibleDate } from "@/features/os/operational/lib/delivery-date";
import {
  canAccessAsignacionLotes,
  canMutateAsignacionLotes,
} from "@/features/os/operational/lib/asignacion-lotes-rbac";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { asignacionLotes } from "@/lib/db/schema";
import { normalizeOptionalReason } from "@/lib/lifecycle/reason";
import { OrdersForbiddenError, OrdersNotFoundError, OrdersValidationError } from "@/lib/orders/types";
import type {
  AsignacionLote,
  AsignacionLoteImportResult,
  AsignacionLotesActor,
  AsignacionLoteUpsertInput,
} from "./types";

const g = globalThis as unknown as { __genusAsignacionLotesMem?: AsignacionLote[] };

function mem(): AsignacionLote[] {
  if (!g.__genusAsignacionLotesMem) {
    g.__genusAsignacionLotesMem = [];
  }
  return g.__genusAsignacionLotesMem;
}

export function resetAsignacionLotesMemoryForTests(): void {
  g.__genusAsignacionLotesMem = [];
}

function useNeon(): boolean {
  return isDatabaseConfigured();
}

function makeId(): string {
  return `al-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function asString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim()) {
    const normalized = value.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
    const parsed = Number.parseFloat(normalized);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function normalizeKeyPart(value: string): string {
  return value.trim().toLowerCase();
}

function duplicateKey(lote: string, codigo: string): string {
  return `${normalizeKeyPart(lote)}::${normalizeKeyPart(codigo)}`;
}

function asOptionalDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return parseFlexibleDate(value) ?? null;
}

function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  return parseFlexibleDate(value) ?? value.slice(0, 10);
}

function migrateRecord(raw: unknown, now = new Date().toISOString()): AsignacionLote {
  const record = (raw ?? {}) as Record<string, unknown>;
  const createdAt = asString(record.createdAt) || asString(record.updatedAt) || now;
  const updatedAt = asString(record.updatedAt) || createdAt;
  return {
    id: asString(record.id) || makeId(),
    lote: asString(record.lote),
    fecha: asOptionalDate(record.fecha) ?? now.slice(0, 10),
    producto: asString(record.producto),
    codigo: asString(record.codigo),
    marca: asString(record.marca),
    cantidades: asNumber(record.cantidades) ?? asNumber(record.cantidad) ?? 0,
    vto: asOptionalDate(record.vto) ?? asOptionalDate(record.vencimiento),
    muestras: asString(record.muestras),
    cjMuestra: asString(record.cjMuestra) || asString(record.cj_muestra),
    fechaAnalisis: asOptionalDate(record.fechaAnalisis) ?? asOptionalDate(record.fecha_analisis),
    observaciones: asString(record.observaciones) || asString(record.notes),
    createdAt,
    createdBy: asString(record.createdBy),
    updatedAt,
    updatedBy: asString(record.updatedBy),
    archived: Boolean(record.archived),
  };
}

function rowToDomain(row: typeof asignacionLotes.$inferSelect): AsignacionLote {
  return {
    id: row.id,
    lote: row.lote,
    fecha: row.fecha,
    producto: row.producto,
    codigo: row.codigo,
    marca: row.marca,
    cantidades: Number(row.cantidades) || 0,
    vto: row.vto,
    muestras: row.muestras,
    cjMuestra: row.cjMuestra,
    fechaAnalisis: row.fechaAnalisis,
    observaciones: row.observaciones,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
    archived: row.archived,
  };
}

function domainToInsert(record: AsignacionLote): typeof asignacionLotes.$inferInsert {
  return {
    id: record.id,
    lote: record.lote,
    fecha: record.fecha,
    producto: record.producto,
    codigo: record.codigo,
    marca: record.marca,
    cantidades: String(record.cantidades),
    vto: dateOnly(record.vto),
    muestras: record.muestras,
    cjMuestra: record.cjMuestra,
    fechaAnalisis: dateOnly(record.fechaAnalisis),
    observaciones: record.observaciones,
    archived: record.archived ?? false,
    createdAt: new Date(record.createdAt),
    createdBy: record.createdBy,
    updatedAt: new Date(record.updatedAt),
    updatedBy: record.updatedBy,
  };
}

function assertAccess(actor: AsignacionLotesActor): void {
  if (!canAccessAsignacionLotes(actor.sector)) {
    throw new OrdersForbiddenError(
      "Este módulo está habilitado solo para Calidad, Producción y Codificado."
    );
  }
}

function assertMutate(actor: AsignacionLotesActor): void {
  if (!canMutateAsignacionLotes(actor.sector)) {
    throw new OrdersForbiddenError("No tenés permiso para modificar asignaciones de lotes.");
  }
}

function findDuplicateMem(
  lote: string,
  codigo: string,
  options: { excludeId?: string; includeArchived?: boolean } = {}
): AsignacionLote | null {
  const key = duplicateKey(lote, codigo);
  return (
    mem().find(
      (item) =>
        duplicateKey(item.lote, item.codigo) === key &&
        item.id !== options.excludeId &&
        (options.includeArchived || !item.archived)
    ) ?? null
  );
}

async function findDuplicateNeon(
  lote: string,
  codigo: string,
  options: { excludeId?: string; includeArchived?: boolean } = {}
): Promise<AsignacionLote | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(asignacionLotes)
    .where(options.includeArchived ? undefined : eq(asignacionLotes.archived, false));
  const key = duplicateKey(lote, codigo);
  const match = rows.find(
    (row) =>
      duplicateKey(row.lote, row.codigo) === key &&
      row.id !== options.excludeId &&
      (options.includeArchived || !row.archived)
  );
  return match ? rowToDomain(match) : null;
}

function sortItems(items: AsignacionLote[]): AsignacionLote[] {
  return [...items].sort(
    (a, b) => b.fecha.localeCompare(a.fecha) || a.lote.localeCompare(b.lote, "es")
  );
}

export class AsignacionLotesService {
  async list(
    actor: AsignacionLotesActor,
    options: { includeArchived?: boolean } = {}
  ): Promise<AsignacionLote[]> {
    assertAccess(actor);
    if (useNeon()) {
      const db = getDb();
      const rows = await db
        .select()
        .from(asignacionLotes)
        .where(options.includeArchived ? undefined : eq(asignacionLotes.archived, false))
        .orderBy(desc(asignacionLotes.fecha));
      return sortItems(rows.map(rowToDomain));
    }
    return sortItems(
      mem().filter((item) => options.includeArchived || !item.archived)
    );
  }

  async get(actor: AsignacionLotesActor, id: string): Promise<AsignacionLote | null> {
    assertAccess(actor);
    if (useNeon()) {
      const db = getDb();
      const [row] = await db.select().from(asignacionLotes).where(eq(asignacionLotes.id, id));
      if (!row || row.archived) return null;
      return rowToDomain(row);
    }
    const item = mem().find((item) => item.id === id);
    if (!item || item.archived) return null;
    return item;
  }

  async upsert(actor: AsignacionLotesActor, input: AsignacionLoteUpsertInput): Promise<AsignacionLote> {
    assertMutate(actor);
    const now = new Date().toISOString();
    const previous = input.id
      ? useNeon()
        ? await this.get(actor, input.id)
        : mem().find((item) => item.id === input.id)
      : undefined;

    if (!input.lote.trim() || !input.fecha.trim() || !input.producto.trim()) {
      throw new OrdersValidationError("Lote, Fecha y Producto son obligatorios.");
    }
    if (!parseFlexibleDate(input.fecha)) {
      throw new OrdersValidationError("Fecha inválida.");
    }
    if (!Number.isFinite(input.cantidades) || input.cantidades < 0) {
      throw new OrdersValidationError("Cantidades debe ser un número mayor o igual a 0.");
    }

    const duplicate = useNeon()
      ? await findDuplicateNeon(input.lote, input.codigo, { excludeId: input.id })
      : findDuplicateMem(input.lote, input.codigo, { excludeId: input.id });
    if (duplicate) {
      throw new OrdersValidationError(
        `Ya existe el lote ${duplicate.lote} para el código ${duplicate.codigo}.`
      );
    }

    const updatedBy = input.updatedBy.trim() || actor.displayName;
    const record: AsignacionLote = {
      id: previous?.id ?? input.id ?? makeId(),
      lote: input.lote.trim(),
      fecha: parseFlexibleDate(input.fecha) ?? input.fecha,
      producto: input.producto.trim(),
      codigo: input.codigo.trim(),
      marca: input.marca?.trim() ?? previous?.marca ?? "",
      cantidades: input.cantidades,
      vto: input.vto ?? previous?.vto ?? null,
      muestras: input.muestras?.trim() ?? previous?.muestras ?? "",
      cjMuestra: input.cjMuestra?.trim() ?? previous?.cjMuestra ?? "",
      fechaAnalisis: input.fechaAnalisis ?? previous?.fechaAnalisis ?? null,
      observaciones: input.observaciones?.trim() ?? previous?.observaciones ?? "",
      createdAt: previous?.createdAt ?? now,
      createdBy: previous?.createdBy ?? input.createdBy ?? updatedBy,
      updatedAt: now,
      updatedBy,
      archived: input.archived ?? previous?.archived ?? false,
    };

    if (useNeon()) {
      const db = getDb();
      const values = domainToInsert(record);
      if (previous) {
        await db
          .update(asignacionLotes)
          .set({
            lote: values.lote,
            fecha: values.fecha,
            producto: values.producto,
            codigo: values.codigo,
            marca: values.marca,
            cantidades: values.cantidades,
            vto: values.vto,
            muestras: values.muestras,
            cjMuestra: values.cjMuestra,
            fechaAnalisis: values.fechaAnalisis,
            observaciones: values.observaciones,
            archived: values.archived,
            updatedAt: values.updatedAt,
            updatedBy: values.updatedBy,
          })
          .where(eq(asignacionLotes.id, record.id));
      } else {
        await db.insert(asignacionLotes).values(values);
      }
      return record;
    }

    const items = mem();
    const idx = items.findIndex((item) => item.id === record.id);
    if (idx >= 0) items[idx] = record;
    else items.push(record);
    return record;
  }

  /** Restaura filas archivadas/eliminadas (incl. bajas con deleted_reason). */
  async restore(actor: AsignacionLotesActor, id: string): Promise<AsignacionLote> {
    assertMutate(actor);
    const now = new Date().toISOString();
    const updatedBy = actor.displayName;

    if (useNeon()) {
      const db = getDb();
      const [existing] = await db.select().from(asignacionLotes).where(eq(asignacionLotes.id, id));
      if (!existing) throw new OrdersNotFoundError("Asignación no encontrada.");
      await db
        .update(asignacionLotes)
        .set({ archived: false, deletedReason: null, updatedAt: new Date(now), updatedBy })
        .where(eq(asignacionLotes.id, id));
      return { ...rowToDomain(existing), archived: false, updatedAt: now, updatedBy };
    }

    const items = mem();
    const idx = items.findIndex((item) => item.id === id);
    if (idx < 0) throw new OrdersNotFoundError("Asignación no encontrada.");
    items[idx] = { ...items[idx], archived: false, updatedAt: now, updatedBy };
    return items[idx];
  }

  async delete(actor: AsignacionLotesActor, id: string, reason?: string): Promise<void> {
    assertMutate(actor);
    const trimmed = normalizeOptionalReason(reason);
    const now = new Date().toISOString();

    if (useNeon()) {
      const db = getDb();
      const [existing] = await db.select().from(asignacionLotes).where(eq(asignacionLotes.id, id));
      if (!existing) throw new OrdersNotFoundError("Asignación no encontrada.");
      if (existing.archived) return;
      await db
        .update(asignacionLotes)
        .set({
          archived: true,
          deletedReason: trimmed,
          updatedAt: new Date(now),
          updatedBy: actor.displayName,
        })
        .where(eq(asignacionLotes.id, id));
      return;
    }

    const items = mem();
    const idx = items.findIndex((item) => item.id === id);
    if (idx < 0) throw new OrdersNotFoundError("Asignación no encontrada.");
    if (items[idx].archived) return;
    items[idx] = {
      ...items[idx],
      archived: true,
      updatedAt: now,
      updatedBy: actor.displayName,
    };
  }

  async import(
    actor: AsignacionLotesActor,
    rows: AsignacionLoteUpsertInput[]
  ): Promise<AsignacionLoteImportResult> {
    assertMutate(actor);
    let imported = 0;
    let skipped = 0;
    let duplicates = 0;
    const errors: AsignacionLoteImportResult["errors"] = [];
    const seen = new Set<string>();

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const rowIndex = index + 1;
      const key = duplicateKey(row.lote, row.codigo);
      if (!row.lote.trim()) errors.push({ rowIndex, field: "lote", message: "Lote obligatorio." });
      if (!row.fecha.trim()) errors.push({ rowIndex, field: "fecha", message: "Fecha obligatoria." });
      if (!parseFlexibleDate(row.fecha)) {
        errors.push({ rowIndex, field: "fecha", message: "Fecha inválida." });
      }
      if (!row.producto.trim()) {
        errors.push({ rowIndex, field: "producto", message: "Producto obligatorio." });
      }
      if (!Number.isFinite(row.cantidades) || row.cantidades < 0) {
        errors.push({
          rowIndex,
          field: "cantidades",
          message: "Cantidades debe ser un número mayor o igual a 0.",
        });
      }
      if (errors.some((error) => error.rowIndex === rowIndex)) {
        skipped += 1;
        continue;
      }

      const dup = useNeon()
        ? await findDuplicateNeon(row.lote, row.codigo)
        : findDuplicateMem(row.lote, row.codigo);
      if (seen.has(key) || dup) {
        duplicates += 1;
        skipped += 1;
        continue;
      }

      await this.upsert(actor, {
        ...row,
        updatedBy: row.updatedBy || actor.displayName,
        createdBy: row.createdBy ?? actor.displayName,
      });
      imported += 1;
      seen.add(key);
    }

    return { imported, skipped, duplicates, errors };
  }

  /** Hidrata memoria desde registros migrados (sync cliente → servidor). Solo path in-memory. */
  async replaceAll(actor: AsignacionLotesActor, records: unknown[]): Promise<number> {
    assertMutate(actor);
    if (useNeon()) {
      const db = getDb();
      const migrated = records.map((record) => migrateRecord(record));
      await db.delete(asignacionLotes);
      for (const record of migrated) {
        await db.insert(asignacionLotes).values(domainToInsert(record));
      }
      return migrated.length;
    }
    g.__genusAsignacionLotesMem = records.map((record) => migrateRecord(record));
    return g.__genusAsignacionLotesMem.length;
  }
}

let singleton: AsignacionLotesService | null = null;

export function getAsignacionLotesService(): AsignacionLotesService {
  if (!singleton) singleton = new AsignacionLotesService();
  return singleton;
}
