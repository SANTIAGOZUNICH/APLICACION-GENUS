/** Copy y helpers — circuito operativo SIN Calidad: Elaboración → Envasado → (Codificado) → Entrega final. */

export const WORK_TRANSFER = {
  /** Acción del operario de Envasado al cerrar su parte: registra la entrega final. */
  markFinishedAction: "Entregar",
  /** Avance parcial — el operario sigue trabajando. */
  saveProgressAction: "Guardar avance",
  /** Elaboración termina y envía DIRECTO al Envasado Masivo/Premium. */
  sendToEnvasadoAction: "Enviar a Envasado",
  /** Enviar a cola Codificado (solo cantidad total; sin aprobación). */
  sendToCodificadoAction: "Enviar a Codificado",
  /** Codificado cierra: registra la entrega final. */
  deliverFromCodificadoAction: "Entregar",
  /** Estado visible en la fila/card del operario tras entregar. */
  deliveredToQuality: "Entregado",
  /** Elaboración tras enviar a Envasado. */
  sentToEnvasado: "Enviado a Envasado",
  inCodificado: "En Codificado",
  nextResponsibleCodificado: "Próximo responsable: Codificado",
  nextResponsibleProduccion: "Pendiente de definir por Producción",
  /** Terminado sin destino (incluye los que estaban pendientes en la ex-bandeja de Calidad). */
  pendingReview: "Pendiente de definir",
  /** Banner de la bandeja de Producción. */
  inboxBannerTitle: "Pendientes de definir",
  /** Feed Producción. */
  recentFlowTitle: "Flujo de planta",
  /** KPI Producción. */
  kpiDeliveredToQuality: "Entregados",
  alreadyInCodificado: "Este trabajo ya está en Codificado.",
  alreadyDeliveredFromCodificado: "Este trabajo ya fue entregado desde Codificado.",
} as const;

/**
 * Estado persistido de «terminado y sin destino» (operational_status = revision). Históricamente era «en revisión de
 * Calidad»; el nombre del valor se conserva (migración solo aditiva), el significado ahora es «pendiente de definir».
 */
export const WORK_TRANSFER_STATUS = "revision" as const;
export const WORK_CODIFICADO_STATUS = "en_codificado" as const;
export const WORK_CODIFICADO_DONE_STATUS = "codificado_completo" as const;

/** Bloquea edición en Envasado (enviado a Codificado, entregado o pendiente de definir). */
export function isWorkTransferredStatus(status: string): boolean {
  return (
    status === WORK_TRANSFER_STATUS ||
    status === "completo" ||
    status === WORK_CODIFICADO_STATUS ||
    status === WORK_CODIFICADO_DONE_STATUS
  );
}

/** Leyenda corta del destino de un trabajo ya transferido/entregado (circuito sin Calidad). */
export function transferStatusNote(status: string): string {
  switch (status) {
    case "entregado":
      return WORK_TRANSFER.deliveredToQuality;
    case WORK_CODIFICADO_STATUS:
      return WORK_TRANSFER.inCodificado;
    case "completo":
      return WORK_TRANSFER.sentToEnvasado;
    default:
      return WORK_TRANSFER.pendingReview;
  }
}

/** Pendiente en bandeja de Codificado — solo cubre el flujo vía handoff desde Envasado. */
export function isInCodificadoStatus(status: string): boolean {
  return status === WORK_CODIFICADO_STATUS;
}

/** Terminado sin destino definido (incluye Codificado terminado sin entrega registrada): lo resuelve Producción. */
export function isPendingDefinitionStatus(status: string): boolean {
  return status === WORK_TRANSFER_STATUS || status === WORK_CODIFICADO_DONE_STATUS;
}

/**
 * Editable en Codificado — cubre las DOS formas en que un trabajo llega ahí
 * (Producción → Codificado directo, y Producción → Envasado → Codificado).
 * `isInCodificadoStatus` sola solo reconoce el segundo caso (status
 * "en_codificado", que solo existe tras un handoff); un trabajo asignado
 * directo nunca pasa por ese status — se queda en "pendiente"/"en_curso" con
 * `sector: "CODIFICADO"` — así que gatear la edición únicamente con
 * `isInCodificadoStatus` bloqueaba guardar/completar en ese caso (bug: la
 * lista de "Pendientes" ya usaba este mismo criterio ampliado, pero el
 * diálogo de detalle no). Debe reflejar exactamente los mismos criterios que
 * `canDeliverFromCodificado` (codificado-flow.ts) usa para permitir entregar.
 */
/**
 * Etiqueta de procedencia legible para un trabajo en Codificado — cubre las
 * dos formas en que llega (asignación directa de Producción, o handoff
 * desde Envasado Masivo/Premium). Mismo criterio para la lista y el
 * detalle en codificado-operational-view.tsx.
 */
export function codificadoOriginLabel(item: {
  codificadoOriginLabel?: string | null;
  codificadoOriginSector?: string | null;
  viaCodificado?: boolean;
}): string {
  if (item.codificadoOriginLabel) return item.codificadoOriginLabel;
  if (item.codificadoOriginSector === "ENVASADO_PREMIUM") return "Envasado Premium";
  if (item.codificadoOriginSector === "ENVASADO_MASIVO") return "Envasado Masivo";
  if (item.viaCodificado) return "Envasado";
  return "Asignación directa de Producción";
}

/**
 * Movible por drag & drop de planificación (Producción) — un trabajo ya
 * transferido (isWorkTransferredStatus), entregado, cancelado o borrado ya
 * representa un hecho operativo terminado y no puede replanificarse.
 */
export function isWorkItemReschedulable(status: string, deletedAt?: string | null): boolean {
  if (deletedAt) return false;
  if (status === "entregado" || status === "cancelado") return false;
  return !isWorkTransferredStatus(status);
}

export function canEditInCodificado(item: {
  status: string;
  sector: string;
  viaCodificado?: boolean;
  deliveredFromCodificadoAt?: string | null;
}): boolean {
  if (item.deliveredFromCodificadoAt) return false;
  if (isInCodificadoStatus(item.status)) return true;
  return (
    item.sector === "CODIFICADO" &&
    !item.viaCodificado &&
    item.status !== "cancelado" &&
    item.status !== "completo" &&
    item.status !== WORK_CODIFICADO_DONE_STATUS &&
    item.status !== WORK_TRANSFER_STATUS &&
    item.status !== "entregado"
  );
}
