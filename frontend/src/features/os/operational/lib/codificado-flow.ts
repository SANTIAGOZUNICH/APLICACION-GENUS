import type { SectorId } from "@/types/operational/sector";
import type { WorkItemStatus } from "@/types/operational/work-item";
import {
  WORK_CODIFICADO_DONE_STATUS,
  WORK_CODIFICADO_STATUS,
  WORK_TRANSFER,
  WORK_TRANSFER_STATUS,
} from "./work-transfer-labels";

const ENVASADO_ORIGINS = new Set<SectorId>(["ENVASADO_MASIVO", "ENVASADO_PREMIUM"]);

export type CodificadoTransitionResult =
  | { ok: true }
  | { ok: false; code: string; error: string };

/** ¿Puede Envasado enviar a Codificado? */
export function canSendToCodificado(status: WorkItemStatus): CodificadoTransitionResult {
  if (status === WORK_CODIFICADO_STATUS) {
    return { ok: false, code: "ALREADY_IN_CODIFICADO", error: WORK_TRANSFER.alreadyInCodificado };
  }
  if (status === WORK_TRANSFER_STATUS || status === WORK_CODIFICADO_DONE_STATUS || status === "completo") {
    return {
      ok: false,
      code: "ALREADY_DELIVERED",
      error: "Este trabajo ya fue entregado a Calidad.",
    };
  }
  if (status === "cancelado" || status === "entregado" || status === "bloqueado") {
    return {
      ok: false,
      code: "INVALID_STATUS",
      error: "No se puede enviar a Codificado en el estado actual.",
    };
  }
  return { ok: true };
}

export function canDeliverFromCodificado(status: WorkItemStatus): CodificadoTransitionResult {
  if (status === WORK_TRANSFER_STATUS || status === WORK_CODIFICADO_DONE_STATUS) {
    return {
      ok: false,
      code: "ALREADY_DELIVERED",
      error: WORK_TRANSFER.alreadyDeliveredFromCodificado,
    };
  }
  if (status !== WORK_CODIFICADO_STATUS) {
    return {
      ok: false,
      code: "NOT_IN_CODIFICADO",
      error: "Solo se pueden entregar trabajos que estén en Codificado.",
    };
  }
  return { ok: true };
}

export function isEnvasadoOriginSector(sector: SectorId | null | undefined): boolean {
  return Boolean(sector && ENVASADO_ORIGINS.has(sector));
}

/** Cantidad total requerida para Codificado (cajas opcionales). */
export function resolveTotalUnitsForCodificado(input: {
  packagingTotalUnits?: number | null;
  finishedQty?: string | null;
  quantity?: string | null;
}): { ok: true; total: number } | { ok: false; error: string } {
  if (input.packagingTotalUnits != null && Number.isFinite(input.packagingTotalUnits)) {
    if (input.packagingTotalUnits <= 0) {
      return { ok: false, error: "La cantidad total debe ser mayor que 0." };
    }
    return { ok: true, total: input.packagingTotalUnits };
  }
  const fromFinished = Number.parseFloat(String(input.finishedQty ?? "").replace(",", "."));
  if (Number.isFinite(fromFinished) && fromFinished > 0) {
    return { ok: true, total: fromFinished };
  }
  const fromQty = Number.parseFloat(String(input.quantity ?? "").replace(",", "."));
  if (Number.isFinite(fromQty) && fromQty > 0) {
    return { ok: true, total: fromQty };
  }
  return { ok: false, error: "Indicá la cantidad total de unidades para enviar a Codificado." };
}

export function nextStatusAfterSendToCodificado(): WorkItemStatus {
  return WORK_CODIFICADO_STATUS;
}

export function nextStatusAfterDeliverFromCodificado(): WorkItemStatus {
  // PENDIENTE_CALIDAD = revision (bandeja Calidad existente)
  return WORK_TRANSFER_STATUS;
}

export function markCodificadoCompleteAlias(): WorkItemStatus {
  return WORK_CODIFICADO_DONE_STATUS;
}
