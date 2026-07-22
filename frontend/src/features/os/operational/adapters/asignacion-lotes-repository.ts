/**
 * @mock-temp Repositorio local de Asignación de lotes — localStorage.
 * Sustituible por tablas reales cuando exista backend operativo para Codificado/Calidad.
 */

import { parseFlexibleDate } from "../lib/delivery-date";

export interface AsignacionLote {
  id: string;
  lote: string;
  fecha: string;
  producto: string;
  codigo: string;
  marca: string;
  cantidades: number;
  vto: string | null;
  muestras: string;
  cjMuestra: string;
  fechaAnalisis: string | null;
  observaciones: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  archived?: boolean;
}

export type AsignacionLoteUpsertInput = {
  id?: string;
  lote: string;
  fecha: string;
  producto: string;
  codigo: string;
  marca?: string;
  cantidades: number;
  vto?: string | null;
  muestras?: string;
  cjMuestra?: string;
  fechaAnalisis?: string | null;
  observaciones?: string;
  createdBy?: string;
  updatedBy: string;
  archived?: boolean;
};

export interface AsignacionLoteImportError {
  rowIndex: number;
  field?: string;
  message: string;
}

export interface AsignacionLoteImportResult {
  imported: number;
  skipped: number;
  duplicates: number;
  errors: AsignacionLoteImportError[];
}

const STORAGE_KEY = "genus_os_asignacion_lotes";

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

export function getAllAsignacionLotes(options: { includeArchived?: boolean } = {}): AsignacionLote[] {
  return [...readAll()]
    .filter((item) => options.includeArchived || !item.archived)
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || a.lote.localeCompare(b.lote, "es"));
}

export function findDuplicateAsignacionLote(
  lote: string,
  codigo: string,
  options: { excludeId?: string; includeArchived?: boolean } = {}
): AsignacionLote | null {
  const key = duplicateKey(lote, codigo);
  return (
    readAll().find(
      (item) =>
        duplicateKey(item.lote, item.codigo) === key &&
        item.id !== options.excludeId &&
        (options.includeArchived || !item.archived)
    ) ?? null
  );
}

export function upsertAsignacionLote(input: AsignacionLoteUpsertInput): AsignacionLote {
  const items = readAll();
  const now = new Date().toISOString();
  const idx = input.id ? items.findIndex((item) => item.id === input.id) : -1;
  const previous = idx >= 0 ? items[idx] : undefined;
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
    const key = duplicateKey(row.lote, row.codigo);
    if (!row.lote.trim()) errors.push({ rowIndex, field: "lote", message: "Lote obligatorio." });
    if (!row.fecha.trim()) errors.push({ rowIndex, field: "fecha", message: "Fecha obligatoria." });
    if (!parseFlexibleDate(row.fecha)) errors.push({ rowIndex, field: "fecha", message: "Fecha inválida." });
    if (!row.producto.trim()) errors.push({ rowIndex, field: "producto", message: "Producto obligatorio." });
    if (!row.codigo.trim()) errors.push({ rowIndex, field: "codigo", message: "Código obligatorio." });
    if (!Number.isFinite(row.cantidades) || row.cantidades < 0) {
      errors.push({ rowIndex, field: "cantidades", message: "Cantidades debe ser un número mayor o igual a 0." });
    }
    if (errors.some((error) => error.rowIndex === rowIndex)) {
      skipped += 1;
      return;
    }

    if (seen.has(key) || findDuplicateAsignacionLote(row.lote, row.codigo)) {
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
