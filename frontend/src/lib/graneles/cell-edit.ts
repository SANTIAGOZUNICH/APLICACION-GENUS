/**
 * Edición por celda de Depósito Graneles — reglas compartidas cliente/servidor.
 * El stock (kg) NO se edita libremente: se corrige con motivo obligatorio y pasa por el servicio
 * canónico `update()` (audita before/after como "delta"). Estado y anulación van por sus acciones.
 */
import { parseFlexibleDate } from "@/features/os/operational/lib/delivery-date";
import { parseNonNegativeNumber } from "@/features/os/operational/lib/clipboard-import";
import type { GranelRemainderRecord } from "./types";

export const GRANEL_CELL_FIELDS = ["product", "client", "bulkLot", "kgAvailable", "intakeDate", "location", "observation"] as const;
export type GranelCellField = (typeof GRANEL_CELL_FIELDS)[number];
export const GRANEL_CELL_KIND: Record<GranelCellField, "text" | "number" | "date"> = {
  product: "text",
  client: "text",
  bulkLot: "text",
  kgAvailable: "number",
  intakeDate: "date",
  location: "text",
  observation: "text",
};
/** Identidad/stock: confirmación siempre; kg además exige motivo. */
export const GRANEL_SENSITIVE_FIELDS: ReadonlySet<GranelCellField> = new Set(["product", "client", "bulkLot", "kgAvailable"]);
export const GRANEL_REASON_FIELDS: ReadonlySet<GranelCellField> = new Set(["kgAvailable"]);
/** Registros originados en Envasado: identidad y kg vienen del trabajo de origen (se corrige allí). */
const ORIGIN_LOCKED: ReadonlySet<GranelCellField> = new Set(["product", "client", "bulkLot", "kgAvailable"]);
export const MAX_GRANEL_CELL_CHANGES = 200;

export function isGranelCellField(v: unknown): v is GranelCellField {
  return typeof v === "string" && (GRANEL_CELL_FIELDS as readonly string[]).includes(v);
}

export function granelCellProtection(
  rec: Pick<GranelRemainderRecord, "status" | "workItemId">,
  field: GranelCellField,
  canMutate: boolean
): string | null {
  if (!canMutate) return "Solo Depósito puede editar los sobrantes de granel.";
  if (rec.status === "ANULADO" || rec.status === "ARCHIVADO") return "Registro anulado/archivado: no se edita.";
  if (rec.workItemId && ORIGIN_LOCKED.has(field)) return "Originado en Envasado: se corrige en el trabajo de origen.";
  return null;
}

export type GranelValidation = { ok: true; value: string | number } | { ok: false; message: string };

export function validateGranelValue(field: GranelCellField, raw: unknown): GranelValidation {
  const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  const kind = GRANEL_CELL_KIND[field];
  if (kind === "number") {
    const n = parseNonNegativeNumber(text);
    if (!text || n === null || n > 1_000_000_000) return { ok: false, message: "Kg inválidos: número ≥ 0." };
    return { ok: true, value: n };
  }
  if (kind === "date") {
    const iso = text ? parseFlexibleDate(text) : null;
    if (!iso) return { ok: false, message: "Fecha inválida. Usá dd/mm/aaaa." };
    return { ok: true, value: iso };
  }
  const max = field === "observation" ? 1000 : 200;
  if (text.length > max) return { ok: false, message: `Máximo ${max} caracteres.` };
  return { ok: true, value: text };
}

export interface GranelCellChange {
  id: string;
  field: GranelCellField;
  value: string;
  expectedVersion: string;
  reason?: string;
}
