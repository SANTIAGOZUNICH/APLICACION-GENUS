/**
 * Asignación de lotes — persistencia en memoria de proceso (Preview).
 * Durable Neon requiere migración additive en 0012 (comentada, no aplicada).
 */
import { parseFlexibleDate } from "@/features/os/operational/lib/delivery-date";
import {
  canAccessAsignacionLotes,
  canMutateAsignacionLotes,
} from "@/features/os/operational/lib/asignacion-lotes-rbac";
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
    g.__genusAsignacionLotesMem = seedDemo();
  }
  return g.__genusAsignacionLotesMem;
}

export function resetAsignacionLotesMemoryForTests(): void {
  g.__genusAsignacionLotesMem = [];
}

function makeId(): string {
  return `al-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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

function seedDemo(): AsignacionLote[] {
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  return [
    {
      id: "seed-al-1",
      lote: "L-CR-001",
      fecha: today,
      producto: "Creamy Facial Hidratante",
      codigo: "PR-120",
      marca: "Genus",
      cantidades: 1200,
      vto: "2028-07-31",
      muestras: "Sí",
      cjMuestra: "1",
      fechaAnalisis: today,
      observaciones: "Demo servidor",
      createdAt: now,
      createdBy: "Sistema",
      updatedAt: now,
      updatedBy: "Sistema",
    },
  ];
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

function findDuplicate(
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

export class AsignacionLotesService {
  list(
    actor: AsignacionLotesActor,
    options: { includeArchived?: boolean } = {}
  ): AsignacionLote[] {
    assertAccess(actor);
    return [...mem()]
      .filter((item) => options.includeArchived || !item.archived)
      .sort((a, b) => b.fecha.localeCompare(a.fecha) || a.lote.localeCompare(b.lote, "es"));
  }

  get(actor: AsignacionLotesActor, id: string): AsignacionLote | null {
    assertAccess(actor);
    return mem().find((item) => item.id === id) ?? null;
  }

  upsert(actor: AsignacionLotesActor, input: AsignacionLoteUpsertInput): AsignacionLote {
    assertMutate(actor);
    const items = mem();
    const now = new Date().toISOString();
    const idx = input.id ? items.findIndex((item) => item.id === input.id) : -1;
    const previous = idx >= 0 ? items[idx] : undefined;

    if (!input.lote.trim() || !input.fecha.trim() || !input.producto.trim() || !input.codigo.trim()) {
      throw new OrdersValidationError("Lote, Fecha, Producto y Código son obligatorios.");
    }
    if (!parseFlexibleDate(input.fecha)) {
      throw new OrdersValidationError("Fecha inválida.");
    }
    if (!Number.isFinite(input.cantidades) || input.cantidades < 0) {
      throw new OrdersValidationError("Cantidades debe ser un número mayor o igual a 0.");
    }

    const duplicate = findDuplicate(input.lote, input.codigo, { excludeId: input.id });
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

    if (idx >= 0) items[idx] = record;
    else items.push(record);
    return record;
  }

  archive(actor: AsignacionLotesActor, id: string): AsignacionLote {
    assertMutate(actor);
    const items = mem();
    const idx = items.findIndex((item) => item.id === id);
    if (idx < 0) throw new OrdersNotFoundError("Asignación no encontrada.");
    const now = new Date().toISOString();
    const updatedBy = actor.displayName;
    items[idx] = {
      ...items[idx],
      archived: true,
      updatedAt: now,
      updatedBy,
    };
    return items[idx];
  }

  restore(actor: AsignacionLotesActor, id: string): AsignacionLote {
    assertMutate(actor);
    const items = mem();
    const idx = items.findIndex((item) => item.id === id);
    if (idx < 0) throw new OrdersNotFoundError("Asignación no encontrada.");
    const now = new Date().toISOString();
    const updatedBy = actor.displayName;
    items[idx] = {
      ...items[idx],
      archived: false,
      updatedAt: now,
      updatedBy,
    };
    return items[idx];
  }

  delete(actor: AsignacionLotesActor, id: string): void {
    assertMutate(actor);
    const items = mem();
    const idx = items.findIndex((item) => item.id === id);
    if (idx < 0) throw new OrdersNotFoundError("Asignación no encontrada.");
    items.splice(idx, 1);
  }

  import(
    actor: AsignacionLotesActor,
    rows: AsignacionLoteUpsertInput[]
  ): AsignacionLoteImportResult {
    assertMutate(actor);
    let imported = 0;
    let skipped = 0;
    let duplicates = 0;
    const errors: AsignacionLoteImportResult["errors"] = [];
    const seen = new Set<string>();

    rows.forEach((row, index) => {
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
      if (!row.codigo.trim()) errors.push({ rowIndex, field: "codigo", message: "Código obligatorio." });
      if (!Number.isFinite(row.cantidades) || row.cantidades < 0) {
        errors.push({
          rowIndex,
          field: "cantidades",
          message: "Cantidades debe ser un número mayor o igual a 0.",
        });
      }
      if (errors.some((error) => error.rowIndex === rowIndex)) {
        skipped += 1;
        return;
      }

      if (seen.has(key) || findDuplicate(row.lote, row.codigo)) {
        duplicates += 1;
        skipped += 1;
        return;
      }

      this.upsert(actor, {
        ...row,
        updatedBy: row.updatedBy || actor.displayName,
        createdBy: row.createdBy ?? actor.displayName,
      });
      imported += 1;
      seen.add(key);
    });

    return { imported, skipped, duplicates, errors };
  }

  /** Hidrata memoria desde registros migrados (sync cliente → servidor). */
  replaceAll(actor: AsignacionLotesActor, records: unknown[]): number {
    assertMutate(actor);
    g.__genusAsignacionLotesMem = records.map((record) => migrateRecord(record));
    return g.__genusAsignacionLotesMem.length;
  }
}

let singleton: AsignacionLotesService | null = null;

export function getAsignacionLotesService(): AsignacionLotesService {
  if (!singleton) singleton = new AsignacionLotesService();
  return singleton;
}
