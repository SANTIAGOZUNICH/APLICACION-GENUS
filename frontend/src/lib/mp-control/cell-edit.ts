/**
 * Edición por celda de las líneas del Control semanal de MP — reglas compartidas cliente/servidor.
 * Solo campos de captura del operador (kg editados, lote, preparado, observación).
 * Código, materia prima, % de fórmula, kg necesarios, stock y estado derivan del snapshot de fórmula
 * inmutable / del cálculo: NO se editan por celda.
 */
import { parseNonNegativeNumber } from "@/features/os/operational/lib/clipboard-import";
import type { MpWeeklyControlStatus } from "./types";

export const MP_LINE_CELL_FIELDS = ["kgEditados", "lote", "preparado", "observacion"] as const;
export type MpLineCellField = (typeof MP_LINE_CELL_FIELDS)[number];
export const MP_LINE_CELL_KIND: Record<MpLineCellField, "text" | "number"> = {
  kgEditados: "number",
  lote: "text",
  preparado: "text",
  observacion: "text",
};
export const MAX_MP_LINE_CELL_CHANGES = 400;

export function isMpLineCellField(v: unknown): v is MpLineCellField {
  return typeof v === "string" && (MP_LINE_CELL_FIELDS as readonly string[]).includes(v);
}

/** Motivo por el que NO se puede editar (null = editable). */
export function mpLineProtection(status: MpWeeklyControlStatus): string | null {
  if (status === "BORRADOR") return null;
  if (status === "COMPLETADO") return "Control completado: es un registro cerrado.";
  return "Control inactivo (anulado/archivado): restauralo para editarlo.";
}

export type MpLineValidation = { ok: true; value: string | number | boolean | null } | { ok: false; message: string };

const TRUE = new Set(["si", "sí", "true", "1", "x", "yes", "✓"]);
const FALSE = new Set(["no", "false", "0", ""]);

export function validateMpLineValue(field: MpLineCellField, raw: unknown): MpLineValidation {
  const text = typeof raw === "string" ? raw.trim() : typeof raw === "number" || typeof raw === "boolean" ? String(raw) : "";
  if (field === "kgEditados") {
    if (!text) return { ok: true, value: null };
    const n = parseNonNegativeNumber(text);
    if (n === null || n > 1_000_000_000) return { ok: false, message: "Kg inválidos: número ≥ 0." };
    return { ok: true, value: n };
  }
  if (field === "preparado") {
    const t = text.toLowerCase();
    if (TRUE.has(t)) return { ok: true, value: true };
    if (FALSE.has(t)) return { ok: true, value: false };
    return { ok: false, message: "Preparado: usá Sí o No." };
  }
  const max = field === "observacion" ? 500 : 100;
  if (text.length > max) return { ok: false, message: `Máximo ${max} caracteres.` };
  return { ok: true, value: text };
}

export interface MpLineCellChange {
  lineId: string;
  field: MpLineCellField;
  value: string;
}
