/**
 * @mock-temp Repositorio demo de Stock de Materias Primas — localStorage.
 * Capa de adapter aislada de la UI; reemplazable por MATERIAS_PRIMAS/SALDOS reales
 * (docss/03-modelo-de-datos.md) sin tocar los componentes visuales.
 */

import { parseFlexibleDate } from "../lib/delivery-date";

export type MateriaPrimaEstado = "disponible" | "por_vencer" | "vencido" | "agotado";
export type MateriaPrimaEstadoManual = MateriaPrimaEstado;

export interface MateriaPrimaLot {
  id: string;
  codigo: string;
  nombre: string;
  lote: string;
  proveedor: string;
  /** Campo legacy usado por vistas previas; se mantiene sincronizado con cantidad. */
  stock: number;
  /** Alias explícito para el stock/cantidad real del lote. */
  cantidad: number;
  unidad: string;
  /** ISO YYYY-MM-DD — null si no se pudo interpretar la fecha pegada. */
  vencimiento: string | null;
  ubicacion: string;
  observaciones: string;
  fechaIngreso: string | null;
  estadoManual?: MateriaPrimaEstadoManual | null;
  createdAt: string;
  createdBy?: string;
  updatedAt: string;
  updatedBy?: string;
  archived?: boolean;
}

export interface MateriaPrimaImportError {
  rowIndex: number;
  field?: string;
  message: string;
}

export interface MateriaPrimaImportResult {
  imported: number;
  updated: number;
  duplicates: number;
  errors: MateriaPrimaImportError[];
}

export type MateriaPrimaUpsertInput = {
  id?: string;
  codigo: string;
  nombre: string;
  lote: string;
  proveedor?: string;
  stock?: number;
  cantidad?: number;
  unidad: string;
  vencimiento?: string | null;
  ubicacion?: string;
  observaciones?: string;
  fechaIngreso?: string | null;
  estadoManual?: MateriaPrimaEstadoManual | null;
  createdBy?: string;
  updatedBy?: string;
  archived?: boolean;
};

const STORAGE_KEY = "genus_os_mp_stock";
const POR_VENCER_DAYS = 60;

function makeId(): string {
  return `mp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeKeyPart(value: string): string {
  return value.trim().toLowerCase();
}

function duplicateKey(codigo: string, lote: string): string {
  return `${normalizeKeyPart(codigo)}::${normalizeKeyPart(lote)}`;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asOptionalDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return parseFlexibleDate(value) ?? null;
}

function asQuantity(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim()) {
    const normalized = value.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
    const parsed = Number.parseFloat(normalized);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function isEstadoManual(value: unknown): value is MateriaPrimaEstadoManual {
  return value === "disponible" || value === "por_vencer" || value === "vencido" || value === "agotado";
}

function migrateLegacyRecord(raw: unknown, now = new Date().toISOString()): MateriaPrimaLot {
  const record = (raw ?? {}) as Record<string, unknown>;
  const stock = asQuantity(record.stock) ?? asQuantity(record.cantidad) ?? 0;
  const createdAt = asString(record.createdAt) || asString(record.updatedAt) || now;
  const updatedAt = asString(record.updatedAt) || createdAt;
  const fechaIngreso =
    asOptionalDate(record.fechaIngreso) ?? asOptionalDate(record.ingreso) ?? createdAt.slice(0, 10);
  const estadoManual = isEstadoManual(record.estadoManual) ? record.estadoManual : null;

  return {
    id: asString(record.id) || makeId(),
    codigo: asString(record.codigo),
    nombre: asString(record.nombre) || asString(record.materiaPrima),
    lote: asString(record.lote),
    proveedor: asString(record.proveedor),
    stock,
    cantidad: stock,
    unidad: asString(record.unidad) || "kg",
    vencimiento: asOptionalDate(record.vencimiento) ?? asOptionalDate(record.fechaVencimiento),
    ubicacion: asString(record.ubicacion),
    observaciones: asString(record.observaciones) || asString(record.notes),
    fechaIngreso,
    estadoManual,
    createdAt,
    createdBy: asString(record.createdBy) || undefined,
    updatedAt,
    updatedBy: asString(record.updatedBy) || undefined,
    archived: Boolean(record.archived),
  };
}

export function migrateLegacyRecords(records: unknown[]): MateriaPrimaLot[] {
  return records.map((record) => migrateLegacyRecord(record));
}

function readAll(): MateriaPrimaLot[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedDemoStock();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const migrated = migrateLegacyRecords(parsed);
    if (JSON.stringify(parsed) !== JSON.stringify(migrated)) {
      writeAll(migrated);
    }
    return migrated;
  } catch {
    return [];
  }
}

function writeAll(items: MateriaPrimaLot[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function seedDemoStock(): MateriaPrimaLot[] {
  const now = new Date().toISOString();
  const seed: MateriaPrimaLot[] = [
    {
      id: "seed-1",
      codigo: "MP-010",
      nombre: "Agua desmineralizada",
      lote: "L-701",
      proveedor: "Planta",
      stock: 850,
      cantidad: 850,
      unidad: "kg",
      vencimiento: null,
      ubicacion: "Depósito MP",
      observaciones: "",
      fechaIngreso: now.slice(0, 10),
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "seed-2",
      codigo: "MP-035",
      nombre: "Glicerina",
      lote: "L-902",
      proveedor: "Proveedor demo",
      stock: 45,
      cantidad: 45,
      unidad: "kg",
      vencimiento: "2028-08-31",
      ubicacion: "Rack A",
      observaciones: "",
      fechaIngreso: now.slice(0, 10),
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "seed-3",
      codigo: "MP-118",
      nombre: "Ácido cítrico",
      lote: "L-450",
      proveedor: "Proveedor demo",
      stock: 12,
      cantidad: 12,
      unidad: "kg",
      vencimiento: "2026-09-30",
      ubicacion: "Rack B",
      observaciones: "",
      fechaIngreso: now.slice(0, 10),
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "seed-4",
      codigo: "MP-204",
      nombre: "Fragancia Vitamin Shock",
      lote: "L-330",
      proveedor: "Proveedor demo",
      stock: 0,
      cantidad: 0,
      unidad: "kg",
      vencimiento: "2027-01-31",
      ubicacion: "Inflamables",
      observaciones: "Sin stock disponible",
      fechaIngreso: now.slice(0, 10),
      createdAt: now,
      updatedAt: now,
    },
  ];
  writeAll(seed);
  return seed;
}

export function getAllMateriasPrimas(options: { includeArchived?: boolean } = {}): MateriaPrimaLot[] {
  return [...readAll()]
    .filter((mp) => options.includeArchived || !mp.archived)
    .sort((a, b) => a.codigo.localeCompare(b.codigo, "es") || a.lote.localeCompare(b.lote, "es"));
}

export function getStockByCodigo(codigo: string): MateriaPrimaLot[] {
  return readAll().filter(
    (mp) => !mp.archived && mp.codigo.trim().toLowerCase() === codigo.trim().toLowerCase()
  );
}

export function getTotalStockByCodigo(codigo: string): number {
  return getStockByCodigo(codigo).reduce((sum, mp) => sum + mp.stock, 0);
}

export function resolveEstado(mp: MateriaPrimaLot): MateriaPrimaEstado {
  if (mp.estadoManual) return mp.estadoManual;
  if (mp.stock <= 0) return "agotado";
  if (mp.vencimiento) {
    const venceEn = new Date(`${mp.vencimiento}T00:00:00`).getTime();
    const now = Date.now();
    if (venceEn < now) return "vencido";
    if (venceEn - now < POR_VENCER_DAYS * 24 * 60 * 60 * 1000) return "por_vencer";
  }
  return "disponible";
}

export function findDuplicate(
  codigo: string,
  lote: string,
  options: { excludeId?: string; includeArchived?: boolean } = {}
): MateriaPrimaLot | null {
  const key = duplicateKey(codigo, lote);
  return (
    readAll().find(
      (item) =>
        duplicateKey(item.codigo, item.lote) === key &&
        item.id !== options.excludeId &&
        (options.includeArchived || !item.archived)
    ) ?? null
  );
}

export function upsertMateriaPrima(input: MateriaPrimaUpsertInput): MateriaPrimaLot {
  const items = readAll();
  const now = new Date().toISOString();
  const quantity = input.cantidad ?? input.stock ?? 0;
  const duplicateIdx = items.findIndex(
    (item) =>
      !item.archived &&
      duplicateKey(item.codigo, item.lote) === duplicateKey(input.codigo, input.lote) &&
      (!input.id || item.id !== input.id)
  );
  const idIdx = input.id ? items.findIndex((i) => i.id === input.id) : -1;
  const idx = idIdx >= 0 ? idIdx : duplicateIdx;
  const previous = idx >= 0 ? items[idx] : undefined;
  const record: MateriaPrimaLot = {
    id: previous?.id ?? input.id ?? makeId(),
    codigo: input.codigo.trim(),
    nombre: input.nombre.trim(),
    lote: input.lote.trim(),
    proveedor: input.proveedor?.trim() ?? previous?.proveedor ?? "",
    stock: quantity,
    cantidad: quantity,
    unidad: input.unidad.trim() || previous?.unidad || "kg",
    vencimiento: input.vencimiento ?? previous?.vencimiento ?? null,
    ubicacion: input.ubicacion?.trim() ?? previous?.ubicacion ?? "",
    observaciones: input.observaciones?.trim() ?? previous?.observaciones ?? "",
    fechaIngreso: input.fechaIngreso ?? previous?.fechaIngreso ?? now.slice(0, 10),
    estadoManual: input.estadoManual ?? previous?.estadoManual ?? null,
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

export function softDeleteMateriaPrima(id: string, updatedBy?: string): void {
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

export function removeMateriaPrima(id: string, updatedBy?: string): void {
  softDeleteMateriaPrima(id, updatedBy);
}

export function importMateriasPrimas(
  rows: MateriaPrimaUpsertInput[],
  updatedBy: string
): MateriaPrimaImportResult {
  let imported = 0;
  let updated = 0;
  let duplicates = 0;
  const errors: MateriaPrimaImportError[] = [];
  const seen = new Set<string>();

  rows.forEach((row, index) => {
    const rowIndex = index + 1;
    const key = duplicateKey(row.codigo, row.lote);
    const quantity = row.cantidad ?? row.stock;

    if (!row.codigo.trim()) errors.push({ rowIndex, field: "codigo", message: "Código obligatorio." });
    if (!row.nombre.trim()) errors.push({ rowIndex, field: "nombre", message: "Nombre obligatorio." });
    if (!row.lote.trim()) errors.push({ rowIndex, field: "lote", message: "Lote obligatorio." });
    if (quantity === undefined || !Number.isFinite(quantity) || quantity < 0) {
      errors.push({ rowIndex, field: "cantidad", message: "Cantidad debe ser un número mayor o igual a 0." });
    }
    if (!row.unidad.trim()) errors.push({ rowIndex, field: "unidad", message: "Unidad obligatoria." });
    if (errors.some((error) => error.rowIndex === rowIndex)) return;

    const duplicate = findDuplicate(row.codigo, row.lote);
    const seenDuplicate = seen.has(key);
    if (duplicate || seenDuplicate) duplicates += 1;

    upsertMateriaPrima({
      ...row,
      id: duplicate?.id ?? row.id,
      cantidad: quantity,
      stock: quantity,
      updatedBy,
      createdBy: row.createdBy ?? updatedBy,
    });
    if (duplicate || seenDuplicate) updated += 1;
    else imported += 1;
    seen.add(key);
  });

  return { imported, updated, duplicates, errors };
}

/** Parsea texto pegado desde Excel: Código \t Materia prima \t Lote \t Stock \t Unidad \t Vencimiento. */
export function parseClipboardRows(text: string): MateriaPrimaUpsertInput[] {
  return text
    .split(/\r\n|\n|\r/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const cols = line.split("\t").map((c) => c.trim());
      const [
        codigo = "",
        nombre = "",
        lote = "",
        stockRaw = "",
        unidad = "kg",
        vencimientoRaw = "",
      ] = cols;
      const stock = parseStockValue(stockRaw);
      return {
        codigo,
        nombre,
        lote,
        stock,
        cantidad: stock,
        unidad: unidad || "kg",
        vencimiento: parseFlexibleDate(vencimientoRaw),
      };
    })
    .filter((row) => row.codigo && row.nombre);
}

function parseStockValue(raw: string): number {
  const normalized = raw.replace(/\./g, "").replace(",", ".");
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}
