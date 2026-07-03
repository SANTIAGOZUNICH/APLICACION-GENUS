/** Copy operativo — transferencia de trabajo entre sectores (no mensajería). */

export const WORK_TRANSFER = {
  /** Acción del operario al cerrar su parte y transferir a Calidad. */
  markFinishedAction: "Entregar a Calidad",
  /** Avance parcial — el operario sigue trabajando. */
  saveProgressAction: "Guardar avance",
  /** Estado visible en la fila/card del operario tras entregar. */
  deliveredToQuality: "Entregado a Calidad",
  nextResponsibleQuality: "Próximo responsable: Calidad",
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
} as const;

/** Estado persistido al transferir trabajo a Calidad. */
export const WORK_TRANSFER_STATUS = "revision" as const;

export function isWorkTransferredStatus(status: string): boolean {
  return status === WORK_TRANSFER_STATUS || status === "completo";
}
