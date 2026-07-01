/**
 * Canonical status values — single source of truth for the entire UI.
 * Labels, colors, icons and tokens resolve via status-map.ts.
 * /docs/07-design-system.md §7
 */

export const Status = {
  LIBERADO: "LIBERADO",
  COMPLETO: "COMPLETO",
  EN_TOLERANCIA: "EN_TOLERANCIA",
  RESUELTO: "RESUELTO",
  CUARENTENA: "CUARENTENA",
  EN_CURSO: "EN_CURSO",
  PARCIAL: "PARCIAL",
  POR_VENCER: "POR_VENCER",
  DESVIO_LEVE: "DESVIO_LEVE",
  BORRADOR_EN_REVISION: "BORRADOR_EN_REVISION",
  RECHAZADO: "RECHAZADO",
  BLOQUEADO: "BLOQUEADO",
  VENCIDO: "VENCIDO",
  CRITICO: "CRITICO",
  SIN_LOTE: "SIN_LOTE",
  FUERA_DE_TOLERANCIA: "FUERA_DE_TOLERANCIA",
  PENDIENTE: "PENDIENTE",
  PLANIFICADA: "PLANIFICADA",
  CERRADA: "CERRADA",
} as const;

export type Status = (typeof Status)[keyof typeof Status];

export type StatusToken = "ok" | "attention" | "problem" | "neutral";

export interface StatusDefinition {
  /** Human-readable label (i18n-ready key surface). */
  label: string;
  token: StatusToken;
  /** CSS variable prefix for badge tint, e.g. "ok" → --badge-ok-bg */
  badgeToken: StatusToken;
}
