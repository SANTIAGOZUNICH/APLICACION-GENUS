/** Copy y helpers — transferencia Envasado ↔ Codificado ↔ Calidad. */

export const WORK_TRANSFER = {
  /** Acción del operario al cerrar su parte y transferir a Calidad. */
  markFinishedAction: "Entregar a Calidad",
  /** Avance parcial — el operario sigue trabajando. */
  saveProgressAction: "Guardar avance",
  /** Enviar a cola Codificado (sin Calidad todavía). */
  sendToCodificadoAction: "Enviar a Codificado",
  /** Codificado cierra y notifica Calidad + Producción. */
  deliverFromCodificadoAction: "Entregar a Calidad y Producción",
  /** Estado visible en la fila/card del operario tras entregar. */
  deliveredToQuality: "Entregado a Calidad",
  inCodificado: "En Codificado",
  nextResponsibleQuality: "Próximo responsable: Calidad",
  nextResponsibleCodificado: "Próximo responsable: Codificado",
  /** Estado del trabajo en bandeja del sector origen. */
  pendingReview: "Pendiente de revisión",
  /** Estado en bandeja de Calidad. */
  awaitingApproval: "Esperando aprobación",
  /** Banner bandeja Calidad. */
  inboxBannerTitle: "Bandeja de transferencias",
  /** Feed Producción. */
  recentFlowTitle: "Flujo de planta",
  /** KPI Producción. */
  kpiDeliveredToQuality: "Entregados a Calidad",
  alreadyInCodificado: "Este trabajo ya está en Codificado.",
  alreadyDeliveredFromCodificado: "Este trabajo ya fue entregado desde Codificado.",
} as const;

/** Estado persistido al transferir trabajo a Calidad (directo o vía Codificado). */
export const WORK_TRANSFER_STATUS = "revision" as const;
export const WORK_CODIFICADO_STATUS = "en_codificado" as const;
export const WORK_CODIFICADO_DONE_STATUS = "codificado_completo" as const;

/** Bloquea edición en Envasado (enviado a Codificado o a Calidad). */
export function isWorkTransferredStatus(status: string): boolean {
  return (
    status === WORK_TRANSFER_STATUS ||
    status === "completo" ||
    status === WORK_CODIFICADO_STATUS ||
    status === WORK_CODIFICADO_DONE_STATUS
  );
}

/** Pendiente en bandeja de Codificado. */
export function isInCodificadoStatus(status: string): boolean {
  return status === WORK_CODIFICADO_STATUS;
}

/** Ya llegó a Calidad (directo o vía Codificado). */
export function isPendingQualityStatus(status: string): boolean {
  return status === WORK_TRANSFER_STATUS || status === WORK_CODIFICADO_DONE_STATUS;
}
