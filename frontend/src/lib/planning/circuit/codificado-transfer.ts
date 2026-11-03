/**
 * Entregas parciales de Envasado a CODIFICADO — reglas PURAS (sin I/O). Las usan el servicio durable, la UI y los tests.
 *
 * Una entrega a Codificado es un MOVIMIENTO INTERNO: no es una entrega al cliente ni mueve stock de Depósito.
 *
 *  - Saldo = asignada − (entregado a Producción + entregado a Codificado), nunca negativo. El trabajo de Envasado sigue abierto mientras haya saldo.
 *  - Tope = terminadas − (lo ya entregado por cualquier vía). La cantidad asignada NO limita la entrega (se pueden entregar más unidades que las pedidas si se realizaron). Las MUESTRAS son metadata y no se descuentan de lo terminado
 *    (regla vigente del packaging): no se contabilizan dos veces.
 *  - Codificado ve: recibidas (suma de entregas), codificadas (su avance, ≤ recibidas), pendientes de codificar y aún no recibidas.
 */
import { DELIVERY_EPSILON, formatQty, planPartialDelivery, type PartialDeliveryResult } from "./delivery-math";

export type CodificadoTransferPlan = PartialDeliveryResult;

export function planCodificadoTransfer(input: {
  assigned: number;
  /** Lo que ya salió del trabajo: entregas a Producción + entregas anteriores a Codificado. */
  alreadyOut: number;
  /** Unidades terminadas registradas; null/0 = sin dato (no limita, pero la UI ofrece registrarlas). */
  produced: number | null | undefined;
  requested: number | null | undefined;
  unit: string | null | undefined;
}): CodificadoTransferPlan {
  const r = planPartialDelivery({ assigned: input.assigned, alreadyDelivered: input.alreadyOut, produced: input.produced, requested: input.requested, unit: input.unit });
  if (r.ok) return r;
  if (r.code === "EXCEEDS_BALANCE") {
    return { ...r, error: `La cantidad supera lo disponible para entregar a Codificado (${formatQty(Math.max(0, input.assigned - input.alreadyOut))}). Si se realizaron más unidades, registralas primero como terminadas.` };
  }
  if (r.code === "NOTHING_PENDING" && !(input.produced != null && input.produced > 0)) {
    return { ...r, error: "Ya se entregó a Codificado (o a Producción) toda la cantidad de este trabajo." };
  }
  return r;
}

export interface CodificadoSummaryInput {
  assigned: number;
  /** Terminadas registradas en Envasado (null = sin dato). */
  produced: number | null;
  deliveredToProduccion: number;
  transferred: number;
  /** Avance de Codificado (unidades codificadas). */
  coded: number;
  /** Lo que Codificado ya entregó hacia afuera. */
  deliveredByCodificado: number;
}

export interface CodificadoSummary {
  assigned: number;
  produced: number | null;
  transferred: number;
  /** Pendiente de entregar a Codificado (de lo asignado, nunca negativo). */
  pendingToTransfer: number;
  /** Lo que ya salió del trabajo por cualquier vía (a Producción + a Codificado); puede superar lo asignado si se realizaron más unidades. */
  alreadyOut: number;
  /** Terminadas y todavía no entregadas a ningún lado (null si no hay dato de terminadas). */
  availableToTransfer: number | null;
  received: number;
  coded: number;
  pendingToCode: number;
  notYetReceived: number;
}

const nz = (n: number) => (Math.abs(n) <= DELIVERY_EPSILON ? 0 : Math.max(0, n));

export function summarizeCodificado(i: CodificadoSummaryInput): CodificadoSummary {
  const out = i.deliveredToProduccion + i.transferred;
  return {
    assigned: i.assigned,
    produced: i.produced,
    transferred: i.transferred,
    pendingToTransfer: nz(i.assigned - out),
    alreadyOut: out,
    availableToTransfer: i.produced != null && i.produced > 0 ? nz(i.produced - out) : null,
    received: i.transferred,
    coded: Math.min(i.coded, i.transferred),
    pendingToCode: nz(i.transferred - i.coded),
    notYetReceived: nz(i.assigned - i.deliveredToProduccion - i.transferred),
  };
}

/** Quién puede entregar a Codificado: el Envasado dueño del trabajo, Producción y Dirección. */
export function canTransferToCodificado(actorSector: string | null | undefined, originSector: string | null | undefined): boolean {
  const a = String(actorSector ?? "").toUpperCase();
  if (a === "PRODUCCION" || a === "DIRECCION") return true;
  return (a === "ENVASADO_MASIVO" || a === "ENVASADO_PREMIUM") && a === String(originSector ?? "").toUpperCase();
}

/** Quién puede consultar las entregas y registrar el avance de lo recibido. */
export function canWorkReceivedCodificado(actorSector: string | null | undefined): boolean {
  const a = String(actorSector ?? "").toUpperCase();
  return a === "CODIFICADO" || a === "PRODUCCION" || a === "DIRECCION";
}

/** Clave de idempotencia por defecto: mismo trabajo + mismo acumulado + misma cantidad = mismo paso (doble clic / reintento). */
export function defaultTransferKey(input: { workItemId: string; alreadyOut: number; requested: number }): string {
  return `cod-transfer:${input.workItemId}:${formatQty(input.alreadyOut)}:${formatQty(input.requested)}`;
}
