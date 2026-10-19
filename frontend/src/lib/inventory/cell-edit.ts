/**
 * Edición por celda de Inventario ME y Stock MP — reglas compartidas cliente/servidor.
 *
 * NO editables por celda (operaciones de negocio con servicio propio y auditoría):
 *  - ME: código (clave de inventario), stock actual (se deriva de ingresos − salidas; se corrige con
 *    «Ajustar stock» + motivo), ingresos/salidas/movimientos (ledger inmutable).
 *  - MP: código (identifica el saldo en el libro mayor), movimientos y ajustes (ledger).
 *  - kg de MP: se corrige con motivo por el servicio canónico `adjustMpStock` (queda en ajustes). En un lote creado
 *    por un ingreso, solo con «Ajustar stock».
 *  Los datos administrativos (producto, proveedor, cliente, descripción, ubicación, lote, vencimiento) se editan en
 *  la celda en TODOS los lotes, también los creados por un ingreso: el lote de Stock se agrupa por código y no se
 *  vuelve a sincronizar con el documento de ingreso, así que bloquearlos dejaba el dato sin forma de corregirse.
 */
import { parseFlexibleDate } from "@/features/os/operational/lib/delivery-date";
import { parseNonNegativeNumber } from "@/features/os/operational/lib/clipboard-import";

export type InventoryCellResource = "me_inventario" | "mp_stock";

export const ME_CELL_FIELDS = ["descripcion", "cliente", "ubicacion", "cantidadPorBulto", "stockMinimo", "puntoReposicion", "responsable", "observacion"] as const;
/**
 * Stock MP: TODAS las columnas se editan en la celda. Las que mueven saldo o dependen de otros datos pasan por una
 * operación segura (ver `patchInventoryCells`):
 *  - cantidadKg       → ajuste del lote + mismo delta en el libro mayor (motivo).
 *  - codigo           → reclasificación: lote + ingresos vinculados + traspaso de saldo en el libro mayor (motivo).
 *  - stockLibroMayor  → ajuste del saldo del código por la diferencia (motivo; conflicto si el saldo cambió).
 *  - diasAlVence      → fija el vencimiento = hoy + días.
 *  - estadoStock / estadoVencimiento → estado fijado a mano (vacío = vuelve al cálculo); no toca kg ni libro mayor.
 */
export const MP_CELL_FIELDS = [
  "codigo",
  "producto",
  "proveedor",
  "cliente",
  "descripcion",
  "ubicacion",
  "lote",
  "vencimiento",
  "cantidadKg",
  "stockLibroMayor",
  "estadoStock",
  "diasAlVence",
  "estadoVencimiento",
  "origen",
] as const;
export type MeCellField = (typeof ME_CELL_FIELDS)[number];
export type MpCellField = (typeof MP_CELL_FIELDS)[number];
export type InventoryCellField = MeCellField | MpCellField;

const NUMERIC = new Set<string>(["cantidadPorBulto", "stockMinimo", "puntoReposicion", "cantidadKg", "stockLibroMayor"]);
const DATES = new Set<string>(["vencimiento"]);
/**
 * Piden confirmación (y motivo): solo lo que mueve stock. Los datos administrativos se guardan con Enter, como en
 * Excel (quedan auditados con valor anterior y nuevo, y se deshacen con Ctrl+Z).
 */
export const INVENTORY_SENSITIVE_FIELDS: ReadonlySet<string> = new Set();
/** Exigen motivo (corrección de stock). */
export const INVENTORY_REASON_FIELDS: ReadonlySet<string> = new Set(["cantidadKg", "codigo", "stockLibroMayor"]);
/**
 * Columnas de Stock MP donde el RELLENO arrastrando no escribe (sí la edición directa de la celda, con su motivo
 * cuando mueve saldo): mueven stock o son calculadas.
 */
export const INVENTORY_NO_FILL: Readonly<Record<string, string>> = {
  codigo: "Identifica el saldo en el libro mayor: se corrige celda por celda, con motivo.",
  cantidadKg: "Mueve el stock: se corrige celda por celda, con motivo.",
  stockLibroMayor: "Lo lleva el libro mayor: se fija celda por celda, con motivo.",
  diasAlVence: "Columna calculada a partir del vencimiento.",
  estadoStock: "Columna calculada a partir de los kg.",
  estadoVencimiento: "Columna calculada a partir del vencimiento.",
};
/** De las anteriores, las que el relleno arrastrando SÍ escribe, siempre con confirmación y motivo (corrige kg). */
export const INVENTORY_FILL_WITH_REASON: ReadonlySet<string> = new Set(["cantidadKg"]);
/** Hasta 1000 celdas por solicitud: pegar o rellenar rangos grandes en una sola operación atómica. */
export const MAX_INVENTORY_CELL_CHANGES = 1000;

export function inventoryFieldKind(field: string): "text" | "number" | "date" {
  return NUMERIC.has(field) ? "number" : DATES.has(field) ? "date" : "text";
}

export function isInventoryCellField(resource: InventoryCellResource, f: unknown): f is InventoryCellField {
  const list: readonly string[] = resource === "me_inventario" ? ME_CELL_FIELDS : MP_CELL_FIELDS;
  return typeof f === "string" && list.includes(f);
}

/** Motivo por el que la celda NO se edita (null = editable). */
export function inventoryCellProtection(
  resource: InventoryCellResource,
  row: { archived?: boolean; origen?: string },
  field: string,
  canWrite: boolean
): string | null {
  if (!canWrite) return "Tu sector no puede editar este inventario.";
  if (row.archived) return "Registro archivado: no se edita.";
  return null;
}

export type InventoryValidation = { ok: true; value: string | number | null } | { ok: false; message: string };

/** Entero escrito en la planilla («30», «-4»). */
function parseSignedInteger(text: string): number | null {
  if (!/^[-+]?\d+$/.test(text.replace(/\s/g, ""))) return null;
  return Number(text.replace(/\s/g, ""));
}

/** Número tal como lo muestra la planilla en es-AR («1.234,5», «-10», «—»): valor anterior que vio el usuario. */
export function parseDisplayedNumber(text: unknown): number | null {
  const t = String(text ?? "").trim();
  if (!t || t === "—") return null;
  const n = Number(t.replace(/\s/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function validateInventoryValue(field: string, raw: unknown): InventoryValidation {
  const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  if (field === "codigo") {
    if (!/[\p{L}\p{N}]/u.test(text)) return { ok: false, message: "El código necesita letras o números." };
    if (text.length > 60) return { ok: false, message: "Máximo 60 caracteres." };
    return { ok: true, value: text.replace(/\s+/g, " ").toUpperCase() };
  }
  if (field === "diasAlVence") {
    const n = parseSignedInteger(text);
    if (n === null || Math.abs(n) > 36500) return { ok: false, message: "Escribí una cantidad de días (puede ser negativa)." };
    return { ok: true, value: n };
  }
  if (field === "estadoStock" || field === "estadoVencimiento" || field === "origen") {
    if (text.length > 40) return { ok: false, message: "Máximo 40 caracteres." };
    return { ok: true, value: text };
  }
  if (NUMERIC.has(field)) {
    if (!text) return field === "cantidadKg" ? { ok: false, message: "Ingresá una cantidad (≥ 0)." } : { ok: true, value: null };
    const n = parseNonNegativeNumber(text);
    if (n === null || n > 1_000_000_000) return { ok: false, message: "Número inválido (≥ 0)." };
    return { ok: true, value: n };
  }
  if (DATES.has(field)) {
    if (!text) return { ok: true, value: "" };
    const iso = parseFlexibleDate(text);
    if (!iso) return { ok: false, message: "Fecha inválida. Usá dd/mm/aaaa." };
    return { ok: true, value: iso };
  }
  const max = field === "observacion" ? 1000 : 200;
  if (text.length > max) return { ok: false, message: `Máximo ${max} caracteres.` };
  if (field === "descripcion" && !text) return { ok: false, message: "La descripción no puede quedar vacía." };
  return { ok: true, value: text };
}

export interface InventoryCellChange {
  id: string;
  field: string;
  value: string;
  expectedVersion: string;
  reason?: string;
  /** Valor que el usuario veía en la celda (p. ej. «Stock código»): si el dato cambió desde entonces → conflicto. */
  expectedValue?: string;
}

export type InventoryCellResult =
  | { ok: true }
  | { ok: false; code: "NOT_FOUND" | "PROTECTED" | "INVALID" | "CONFLICT"; message: string };
