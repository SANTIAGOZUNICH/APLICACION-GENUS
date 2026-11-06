/** Edición por celda de «Entregas Producción» (planilla «SALIDAS PROD.») — reglas compartidas cliente/servidor. */
import { parseFlexibleDate } from "@/features/os/operational/lib/delivery-date";
import { parseNonNegativeNumber } from "@/features/os/operational/lib/clipboard-import";
import type { DespachoRecord } from "./types";

/** Las 11 columnas de la hoja, en su orden: FECHA, EGRESO N°, CLIENTE, REMITO N°, DESCRIPCIÓN, BULTOS, CANTIDAD, TOTAL (calculada), CONTROL, ENTREGADO, COMENTARIOS. */
export const DESPACHO_CELL_FIELDS = ["fecha", "egreso", "cliente", "remito", "producto", "bultos", "cantidad", "control", "entregado", "comentarios", "pedidoOp"] as const;
export type DespachoCellField = (typeof DESPACHO_CELL_FIELDS)[number];
export type DespachoValueKind = "text" | "int" | "intOpt" | "date" | "bool";
export const DESPACHO_CELL_KIND: Record<DespachoCellField, DespachoValueKind> = {
  fecha: "date",
  egreso: "text",
  cliente: "text",
  remito: "text",
  producto: "text",
  bultos: "int",
  cantidad: "intOpt",
  control: "bool",
  entregado: "bool",
  comentarios: "text",
  pedidoOp: "text",
};
/** Tipo de columna de la grilla (los enteros se alinean a la derecha como números). */
export const DESPACHO_GRID_KIND: Record<DespachoCellField, "text" | "number" | "date" | "bool"> = {
  fecha: "date", egreso: "text", cliente: "text", remito: "text", producto: "text", bultos: "number", cantidad: "number", control: "bool", entregado: "bool", comentarios: "text", pedidoOp: "text",
};
export const MAX_DESPACHO_CELL_CHANGES = 200;
export const MAX_DESPACHO_BULK_ROWS = 500;
export const MAX_UNITS = 10_000_000;

export function isDespachoCellField(v: unknown): v is DespachoCellField {
  return typeof v === "string" && (DESPACHO_CELL_FIELDS as readonly string[]).includes(v);
}

export function despachoCellProtection(_rec: Pick<DespachoRecord, "id">, _field: DespachoCellField, canMutate: boolean): string | null {
  return canMutate ? null : "Solo Depósito puede editar las entregas a Producción.";
}

export type DespachoValidation = { ok: true; value: string | number | boolean } | { ok: false; message: string };

/** TRUE / VERDADERO / SI / 1 → marcado; FALSE / FALSO / NO / 0 / vacío → desmarcado (así exporta las casillas Google Sheets). */
export function parseBoolCell(raw: unknown): boolean | null {
  if (typeof raw === "boolean") return raw;
  const t = (typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw : "").trim().toLowerCase();
  if (/^(true|verdadero|si|sí|1|x|✓|✔)$/.test(t)) return true;
  if (/^(false|falso|no|0)?$/.test(t)) return false;
  return null;
}

/** TOTAL = BULTOS × CANTIDAD. Con CANTIDAD pendiente NO se inventa un total: se conserva el que ya estaba registrado. */
export function despachoTotal(bultos: number, cantidad: number | null | undefined, legacyTotal = 0): number {
  return cantidad == null ? legacyTotal : bultos * cantidad;
}

export function validateDespachoValue(field: DespachoCellField, raw: unknown): DespachoValidation {
  const kind = DESPACHO_CELL_KIND[field];
  if (kind === "bool") {
    const b = parseBoolCell(raw);
    return b === null ? { ok: false, message: "Valor inválido: usá TRUE/FALSE (tildado / sin tildar)." } : { ok: true, value: b };
  }
  const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  if (kind === "int" || kind === "intOpt") {
    if (!text) return { ok: true, value: kind === "int" ? 0 : "" }; // CANTIDAD vacía = pendiente (no se inventa)
    const n = parseNonNegativeNumber(text);
    if (n === null) return { ok: false, message: "Número inválido: debe ser ≥ 0 (sin negativos)." };
    if (!Number.isInteger(n)) return { ok: false, message: "Debe ser un número entero: no hay unidades decimales." };
    if (n > MAX_UNITS) return { ok: false, message: `Máximo ${MAX_UNITS.toLocaleString("es-AR")}.` };
    return { ok: true, value: n };
  }
  if (kind === "date") {
    if (!text) return { ok: true, value: "" }; // sin fecha: se guarda vacío y se completa después
    const iso = parseFlexibleDate(text);
    if (!iso) return { ok: false, message: "Fecha inválida. Usá dd/mm/aaaa." };
    return { ok: true, value: iso };
  }
  const max = field === "comentarios" ? 1000 : field === "remito" || field === "egreso" ? 60 : 200;
  if (text.length > max) return { ok: false, message: `Máximo ${max} caracteres.` };
  if (field === "egreso") return { ok: true, value: text.toUpperCase() }; // B001, B002… siempre en mayúsculas
  return { ok: true, value: text }; // remito: SIEMPRE texto tal cual (ceros a la izquierda incluidos)
}

export interface DespachoCellChange {
  id: string;
  field: DespachoCellField;
  value: string;
  expectedVersion: string;
}

/** yyyy-mm-dd → dd/mm/aaaa (sin pasar por Date: no hay corrimiento de zona horaria). */
export function formatDespachoFecha(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso ?? "");
}

/** Siguiente número de egreso (B001 → B002…): mayor sufijo numérico con el mismo prefijo, +1. Sin egresos → B001. */
export function nextEgreso(existing: readonly string[]): string {
  let prefix = "B";
  let max = 0;
  let width = 3;
  for (const e of existing) {
    const m = /^([A-Za-z]*?)(\d+)$/.exec(e.trim());
    if (!m) continue;
    const n = Number(m[2]);
    if (n >= max) {
      max = n;
      prefix = m[1]!.toUpperCase() || "B";
      width = Math.max(3, m[2]!.length);
    }
  }
  return `${prefix}${String(max + 1).padStart(width, "0")}`;
}
