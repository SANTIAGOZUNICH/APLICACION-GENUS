/** Pestañas editables de SEMANAS 2026 — módulo client-safe. DB (dashboard con fórmulas) NO es editable. */
export const SEMANAS_TABS = {
  ELABORACION: { tab: "ELABORACION", label: "Elaboración", kind: "CALENDAR" },
  ACONDICIONAMIENTO: { tab: "ACONDICIONAMIENTO", label: "Acondicionamiento", kind: "CALENDAR" },
  CDIA: { tab: "QACONDDIA", label: "C/DIA", kind: "FLAT" },
  ENTREGAS: { tab: "ENTREGAS", label: "Entregas", kind: "FLAT" },
} as const;
export type SemanasTabKey = keyof typeof SEMANAS_TABS;
export function isSemanasTabKey(v: unknown): v is SemanasTabKey {
  return typeof v === "string" && v in SEMANAS_TABS;
}
