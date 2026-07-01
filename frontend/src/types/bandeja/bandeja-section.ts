/**
 * Canonical bandeja sections — /docs/08-workspaces.md §2
 */

export const BandejaSectionId = {
  AHORA: "ahora",
  EN_COLA: "en-cola",
  ESPERANDO_DECISION: "esperando-decision",
  ESPERANDO_OTROS: "esperando-otros",
  PROBLEMAS: "problemas",
  FINALIZADOS: "finalizados",
} as const;

export type BandejaSectionId =
  (typeof BandejaSectionId)[keyof typeof BandejaSectionId];

export interface BandejaSectionConfig {
  id: BandejaSectionId;
  label: string;
  description: string;
  /** Default collapsed state on first render */
  defaultCollapsed: boolean;
  /** Problemas must stay visible per product rules */
  alwaysExpanded?: boolean;
}

export const BANDEJA_SECTIONS: readonly BandejaSectionConfig[] = [
  {
    id: BandejaSectionId.AHORA,
    label: "Ahora",
    description: "Lo que tenés que hacer ya",
    defaultCollapsed: false,
  },
  {
    id: BandejaSectionId.EN_COLA,
    label: "En cola",
    description: "Asignado, todavía no empezado",
    defaultCollapsed: false,
  },
  {
    id: BandejaSectionId.ESPERANDO_DECISION,
    label: "Esperando tu decisión",
    description: "Requiere tu cierre, firma o confirmación",
    defaultCollapsed: false,
  },
  {
    id: BandejaSectionId.ESPERANDO_OTROS,
    label: "Esperando a otros",
    description: "Hiciste tu parte — depende de otro rol",
    defaultCollapsed: true,
  },
  {
    id: BandejaSectionId.PROBLEMAS,
    label: "Problemas",
    description: "Excepciones que requieren atención",
    defaultCollapsed: false,
    alwaysExpanded: true,
  },
  {
    id: BandejaSectionId.FINALIZADOS,
    label: "Finalizados",
    description: "Completado hoy",
    defaultCollapsed: true,
  },
] as const;
