/**
 * Cache local de Asignación de lotes — localStorage como fallback offline.
 * Las mutaciones deben pasar por `/api/v1/asignacion-lotes` (autorizado en servidor).
 */

import { parseFlexibleDate } from "../lib/delivery-date";
import type {
  AsignacionLote,
  AsignacionLoteImportError,
  AsignacionLoteImportResult,
  AsignacionLoteUpsertInput,
} from "@/lib/asignacion-lotes/types";

export type {
  AsignacionLote,
  AsignacionLoteImportError,
  AsignacionLoteImportResult,
  AsignacionLoteUpsertInput,
};

const STORAGE_KEY = "genus_os_asignacion_lotes";

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

/** Identidad (lote,código,producto) — ampliada 0038, igual criterio que el servidor (ver asignacion-lotes-service.ts#duplicateKey). */
function duplicateKey(lote: string, codigo: string, producto: string): string {
  return `${normalizeKeyPart(lote)}::${normalizeKeyPart(codigo)}::${normalizeKeyPart(producto)}`;
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
    // null = no informada (carga flexible / fila de Google sin fecha): NUNCA se
    // inventa "hoy" — mostraría y copiaría a la grilla un dato falso.
    fecha: asOptionalDate(record.fecha),
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
    // Metadatos de origen: la grilla necesita saber qué registros vienen de
    // Google Sheets (fuente de verdad → solo lectura). Antes se descartaban.
    sourceId: typeof record.sourceId === "string" && record.sourceId ? record.sourceId : null,
    sourceSheetTab: typeof record.sourceSheetTab === "string" && record.sourceSheetTab ? record.sourceSheetTab : null,
    datosIncompletos: Boolean(record.datosIncompletos),
    camposIncompletos: Array.isArray(record.camposIncompletos) ? (record.camposIncompletos as string[]) : null,
  };
}

export function migrateAsignacionLotesRecords(records: unknown[]): AsignacionLote[] {
  return records.map((record) => migrateRecord(record));
}

function writeAll(items: AsignacionLote[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function seedDemo(): AsignacionLote[] {
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const seed: AsignacionLote[] = [
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
      observaciones: "Demo local",
      createdAt: now,
      createdBy: "Sistema",
      updatedAt: now,
      updatedBy: "Sistema",
    },
  ];
  writeAll(seed);
  return seed;
}

function readAll(): AsignacionLote[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedDemo();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const migrated = migrateAsignacionLotesRecords(parsed);
    if (JSON.stringify(parsed) !== JSON.stringify(migrated)) writeAll(migrated);
    return migrated;
  } catch {
    return [];
  }
}

/** Reemplaza la caché local con datos del servidor. */
export function replaceAsignacionLotesCache(items: AsignacionLote[]): void {
  writeAll(items);
}

export function getAllAsignacionLotes(options: { includeArchived?: boolean } = {}): AsignacionLote[] {
  return [...readAll()]
    .filter((item) => options.includeArchived || !item.archived)
    .sort((a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? "") || a.lote.localeCompare(b.lote, "es"));
}

export function findDuplicateAsignacionLote(
  lote: string,
  codigo: string,
  producto: string,
  options: { excludeId?: string; includeArchived?: boolean } = {}
): AsignacionLote | null {
  const key = duplicateKey(lote, codigo, producto);
  return (
    readAll().find(
      (item) =>
        duplicateKey(item.lote, item.codigo, item.producto) === key &&
        item.id !== options.excludeId &&
        (options.includeArchived || !item.archived)
    ) ?? null
  );
}

/** @deprecated Usar upsertAsignacionLoteApi — solo caché offline legacy. */
export function upsertAsignacionLote(input: AsignacionLoteUpsertInput): AsignacionLote {
  const items = readAll();
  const now = new Date().toISOString();
  const idx = input.id ? items.findIndex((item) => item.id === input.id) : -1;
  const previous = idx >= 0 ? items[idx] : undefined;
  const record: AsignacionLote = {
    id: previous?.id ?? input.id ?? makeId(),
    lote: input.lote.trim(),
    fecha: input.fecha?.trim() ? (parseFlexibleDate(input.fecha) ?? input.fecha.trim()) : null,
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
    createdBy: previous?.createdBy ?? input.createdBy ?? input.updatedBy,
    updatedAt: now,
    updatedBy: input.updatedBy,
    archived: input.archived ?? previous?.archived ?? false,
  };
  if (idx >= 0) items[idx] = record;
  else items.push(record);
  writeAll(items);
  return record;
}

/** @deprecated Usar patchAsignacionLoteApi — solo caché offline legacy. */
export function softDeleteAsignacionLote(id: string, updatedBy: string): void {
  const now = new Date().toISOString();
  writeAll(
    readAll().map((item) =>
      item.id === id
        ? {
            ...item,
            archived: true,
            updatedAt: now,
            updatedBy,
          }
        : item
    )
  );
}

/** @deprecated Usar patchAsignacionLoteApi — solo caché offline legacy. */
export function restoreAsignacionLote(id: string, updatedBy: string): void {
  const now = new Date().toISOString();
  writeAll(
    readAll().map((item) =>
      item.id === id
        ? {
            ...item,
            archived: false,
            updatedAt: now,
            updatedBy,
          }
        : item
    )
  );
}

/** @deprecated Usar importAsignacionLotesApi — solo caché offline legacy. */
export function importAsignacionLotes(
  rows: AsignacionLoteUpsertInput[],
  updatedBy: string
): AsignacionLoteImportResult {
  let imported = 0;
  let skipped = 0;
  let duplicates = 0;
  const errors: AsignacionLoteImportError[] = [];
  const seen = new Set<string>();

  rows.forEach((row, index) => {
    const rowIndex = index + 1;
    const key = duplicateKey(row.lote, row.codigo, row.producto);
    // Carga flexible — igual criterio que asignacion-lotes-service.ts#import.
    if (row.fecha?.trim() && !parseFlexibleDate(row.fecha)) {
      errors.push({ rowIndex, field: "fecha", message: "Fecha inválida." });
    }
    if (errors.some((error) => error.rowIndex === rowIndex)) {
      skipped += 1;
      return;
    }

    if (seen.has(key) || findDuplicateAsignacionLote(row.lote, row.codigo, row.producto)) {
      duplicates += 1;
      skipped += 1;
      return;
    }

    upsertAsignacionLote({ ...row, updatedBy, createdBy: row.createdBy ?? updatedBy });
    imported += 1;
    seen.add(key);
  });

  return { imported, skipped, duplicates, errors };
}
