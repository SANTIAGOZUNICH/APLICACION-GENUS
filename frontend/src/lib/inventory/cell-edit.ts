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
export const MP_CELL_FIELDS = ["producto", "proveedor", "cliente", "descripcion", "ubicacion", "lote", "vencimiento", "cantidadKg"] as const;
export type MeCellField = (typeof ME_CELL_FIELDS)[number];
export type MpCellField = (typeof MP_CELL_FIELDS)[number];
export type InventoryCellField = MeCellField | MpCellField;

const NUMERIC = new Set<string>(["cantidadPorBulto", "stockMinimo", "puntoReposicion", "cantidadKg"]);
const DATES = new Set<string>(["vencimiento"]);
/**
 * Piden confirmación (y motivo): solo lo que mueve stock. Los datos administrativos se guardan con Enter, como en
 * Excel (quedan auditados con valor anterior y nuevo, y se deshacen con Ctrl+Z).
 */
export const INVENTORY_SENSITIVE_FIELDS: ReadonlySet<string> = new Set(["cantidadKg"]);
/** Exigen motivo (corrección de stock). */
export const INVENTORY_REASON_FIELDS: ReadonlySet<string> = new Set(["cantidadKg"]);
export const MAX_INVENTORY_CELL_CHANGES = 200;

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
  if (resource === "mp_stock" && row.origen === "ingreso" && field === "cantidadKg") {
    return "Kg de un lote creado por un ingreso: se corrigen con «Ajustar stock» (motivo, queda en el libro mayor) o corrigiendo el ingreso.";
  }
  return null;
}

export type InventoryValidation = { ok: true; value: string | number | null } | { ok: false; message: string };

export function validateInventoryValue(field: string, raw: unknown): InventoryValidation {
  const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
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
}

export type InventoryCellResult =
  | { ok: true }
  | { ok: false; code: "NOT_FOUND" | "PROTECTED" | "INVALID" | "CONFLICT"; message: string };
