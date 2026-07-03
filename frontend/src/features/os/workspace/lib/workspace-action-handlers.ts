import type { WorkspaceAction } from "../types";

/** Labels premium por acción — solo capa visual, sin tocar WorkspaceResolver. */
export const PREMIUM_ACTION_LABELS: Partial<Record<string, string>> = {
  "view-analysis": "Registrar análisis",
  dispatch: "Preparar despacho",
  kpis: "Alertas críticas",
  operations: "Centro de Operaciones",
};

export function getPremiumActionLabel(action: WorkspaceAction): string {
  return PREMIUM_ACTION_LABELS[action.id] ?? action.label;
}

export function resolveHeroCtaActionId(sectorId: string): string {
  const map: Record<string, string> = {
    PRODUCCION: "start-elaboracion",
    CALIDAD: "release-lot",
    DEPOSITO: "receive",
    DIRECCION: "operations",
    ELABORACION: "start-batch",
    ENVASADO_MASIVO: "open-oa",
    ENVASADO_PREMIUM: "open-oa",
  };
  return map[sectorId] ?? "start";
}
