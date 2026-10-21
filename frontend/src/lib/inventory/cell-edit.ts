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
 * De las anteriores, las que la planilla NO le pide al usuario: se guardan directo con un motivo automático que queda
 * en el libro mayor y en la auditoría (usuario, fecha, valor anterior y nuevo) y se pueden deshacer. El código
 * (identificador) sigue pidiendo motivo.
 */
export const INVENTORY_AUTO_REASON_FIELDS: ReadonlySet<string> = new Set(["cantidadKg", "stockLibroMayor", "codigo"]);
export const INVENTORY_AUTO_REASON = "Edición directa en la planilla de Stock";
/**
 * Columnas de Stock MP donde el RELLENO arrastrando no escribe (sí la edición directa de la celda, con su motivo
 * cuando mueve saldo): mueven stock o son calculadas.
 */
export const INVENTORY_NO_FILL: Readonly<Record<string, string>> = {
  diasAlVence: "Columna calculada a partir del vencimiento.",
  estadoStock: "Columna calculada a partir de los kg.",
  estadoVencimiento: "Columna calculada a partir del vencimiento.",
};
/** Ya no hay columnas de relleno «con confirmación»: todo lo editable se rellena y se borra directo (Deshacer disponible). */
export const INVENTORY_FILL_WITH_REASON: ReadonlySet<string> = new Set();
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
  row: { archived?: boolean; origen?: string; codigo?: string },
  field: string,
  canWrite: boolean
): string | null {
  if (!canWrite) return "Tu sector no puede editar este inventario.";
  if (row.archived) return "Registro archivado: no se edita.";
  // «Stock código» es el saldo del libro mayor de ESE código: una fila sin código no tiene saldo que fijar (antes el
  // guardado fallaba con «Error al guardar»). Se asigna primero el código de la fila.
  if (resource === "mp_stock" && field === "stockLibroMayor" && !String(row.codigo ?? "").trim()) {
    return "Esta fila no tiene código: asignale un código (columna Código) para llevar su saldo.";
  }
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
    if (!text) return { ok: true, value: "" }; // borrar el código es válido: la fila queda sin código (pendiente)
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
    if (!text) return field === "cantidadKg" ? { ok: true, value: 0 } : { ok: true, value: null }; // kg vacíos = 0 (el stock de la fila queda en cero)
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
