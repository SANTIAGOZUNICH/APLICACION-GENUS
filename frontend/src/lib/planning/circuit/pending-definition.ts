/**
 * «Pendientes de definir» — trabajos terminados que quedaron sin destino (estado `revision`). Incluye los que
 * estaban pendientes en la ex-bandeja de Calidad. PARTE PURA: clasificación y acciones sugeridas (sin I/O).
 *
 * Reglas de reubicación (nunca se marcan entregados ni finalizados automáticamente):
 *  - Elaboración            → enviar a Envasado (Masivo/Premium).
 *  - Envasado Masivo/Premium → registrar la entrega final, o enviar a Codificado.
 *  - Codificado              → registrar la entrega final.
 *  - cualquier otro caso     → «pendiente de asignación» para Producción.
 *  - «Rehacer» está siempre disponible para Producción (devuelve el trabajo al sector).
 */
export type PendingDefinitionAction =
  | "REGISTRAR_ENTREGA"
  | "ENVIAR_A_CODIFICADO"
  | "ENVIAR_A_ENVASADO"
  | "REHACER"
  | "ASIGNAR";

export interface PendingDefinitionInput {
  sector: string;
  operationalStatus: string;
  completedAt?: string | null;
  qualityStatus?: string | null;
  deletedAt?: string | null;
  viaCodificado?: boolean;
  codificadoCancelledAt?: string | null;
  hasActiveDelivery?: boolean;
}

export interface PendingDefinitionInfo {
  pending: boolean;
  /** Estaba pendiente en la bandeja de Calidad (revision + quality pendiente + completed_at + sin entrega). */
  legacyQualityPending: boolean;
  /** Tuvo una decisión histórica de Calidad (se conserva como historial). */
  hadQualityDecision: boolean;
  destinationKnown: boolean;
  actions: PendingDefinitionAction[];
  label: string;
}

export function classifyPendingDefinition(item: PendingDefinitionInput): PendingDefinitionInfo {
  const pending = item.operationalStatus === "revision" && !item.deletedAt;
  const hadQualityDecision = item.qualityStatus === "aprobado" || item.qualityStatus === "rechazado";
  const legacyQualityPending =
    pending &&
    (item.qualityStatus ?? "pendiente") === "pendiente" &&
    Boolean(item.completedAt) &&
    !item.hasActiveDelivery;
  if (!pending) {
    return { pending: false, legacyQualityPending: false, hadQualityDecision, destinationKnown: true, actions: [], label: "" };
  }
  let actions: PendingDefinitionAction[];
  let destinationKnown = true;
  let label: string;
  switch (item.sector) {
    case "ELABORACION":
      actions = ["ENVIAR_A_ENVASADO", "REHACER"];
      label = "Elaboración terminada — falta enviarla a Envasado";
      break;
    case "ENVASADO_MASIVO":
    case "ENVASADO_PREMIUM":
      actions = ["REGISTRAR_ENTREGA", "ENVIAR_A_CODIFICADO", "REHACER"];
      label = "Envasado terminado — registrar entrega o enviar a Codificado";
      break;
    case "CODIFICADO":
      actions = ["REGISTRAR_ENTREGA", "REHACER"];
      label = "Codificado terminado — falta registrar la entrega";
      break;
    default:
      actions = ["ASIGNAR", "REHACER"];
      destinationKnown = false;
      label = "Pendiente de asignación";
  }
  return { pending: true, legacyQualityPending, hadQualityDecision, destinationKnown, actions, label };
}

export const PENDING_ACTION_LABEL: Record<PendingDefinitionAction, string> = {
  REGISTRAR_ENTREGA: "Registrar entrega",
  ENVIAR_A_CODIFICADO: "Enviar a Codificado",
  ENVIAR_A_ENVASADO: "Enviar a Envasado",
  REHACER: "Rehacer",
  ASIGNAR: "Asignar",
};
