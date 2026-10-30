/** Edición por celda de «Entregas Producción» — reglas compartidas cliente/servidor. */
import { parseFlexibleDate } from "@/features/os/operational/lib/delivery-date";
import { parseNonNegativeNumber } from "@/features/os/operational/lib/clipboard-import";
import type { DespachoRecord } from "./types";

export const DESPACHO_CELL_FIELDS = ["fecha", "remito", "cliente", "producto", "bultos", "cantidadTotal", "pedidoOp"] as const;
export type DespachoCellField = (typeof DESPACHO_CELL_FIELDS)[number];
export const DESPACHO_CELL_KIND: Record<DespachoCellField, "text" | "number" | "date"> = {
  fecha: "date",
  remito: "text",
  cliente: "text",
  producto: "text",
  bultos: "number",
  cantidadTotal: "number",
  pedidoOp: "text",
};
export const MAX_DESPACHO_CELL_CHANGES = 200;
export const MAX_DESPACHO_BULK_ROWS = 500;

export function isDespachoCellField(v: unknown): v is DespachoCellField {
  return typeof v === "string" && (DESPACHO_CELL_FIELDS as readonly string[]).includes(v);
}

export function despachoCellProtection(_rec: Pick<DespachoRecord, "id">, _field: DespachoCellField, canMutate: boolean): string | null {
  return canMutate ? null : "Solo Depósito puede editar las entregas a Producción.";
}

export type DespachoValidation = { ok: true; value: string | number } | { ok: false; message: string };

export function validateDespachoValue(field: DespachoCellField, raw: unknown): DespachoValidation {
  const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  const kind = DESPACHO_CELL_KIND[field];
  if (kind === "number") {
    if (!text) return { ok: true, value: 0 };
    const n = parseNonNegativeNumber(text);
    if (n === null || n > 1_000_000_000) return { ok: false, message: "Número inválido: debe ser ≥ 0." };
    return { ok: true, value: n };
  }
  if (kind === "date") {
    if (!text) return { ok: false, message: "La fecha es obligatoria." };
    const iso = parseFlexibleDate(text);
    if (!iso) return { ok: false, message: "Fecha inválida. Usá dd/mm/aaaa." };
    return { ok: true, value: iso };
  }
  const max = field === "remito" ? 60 : 200;
  if (text.length > max) return { ok: false, message: `Máximo ${max} caracteres.` };
  return { ok: true, value: text }; // remito: SIEMPRE texto tal cual (ceros a la izquierda incluidos)
}

export interface DespachoCellChange {
  id: string;
  field: DespachoCellField;
  value: string;
  expectedVersion: string;
}

/** yyyy-mm-dd → dd/mm/aaaa (sin pasar por Date: no hay corrimiento de zona horaria). */
export function formatDespachoFecha(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso ?? "";
}
