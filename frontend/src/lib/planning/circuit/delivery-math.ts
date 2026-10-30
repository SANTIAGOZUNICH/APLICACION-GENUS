/**
 * Aritmética pura de entregas (totales y parciales) del circuito operativo sin Calidad.
 * Sin I/O: la usan el servicio durable (delivery-core.ts) y los tests.
 *
 * Reglas:
 *  - La CANTIDAD OBJETIVO de un trabajo es lo físicamente entregable: lo embalado en cajas (deliverableUnits) si el
 *    cierre de packaging lo fijó; si no, el total declarado (packagingTotalUnits), la cantidad final (finishedQty) o,
 *    en último caso, la planificada. Nunca se infiere ni se inventa.
 *  - Una entrega puede ser menor al objetivo (parcial): queda un SALDO y el trabajo NO se marca entregado.
 *  - Nunca se entrega más que el saldo (no hay «stock negativo» por error de tipeo).
 *  - Tolerancia de 1e-6 para decimales (kg) al comparar contra el objetivo.
 */
import { isIntegerUnit, parseArDecimal, parseArInteger } from "@/lib/utils/ar-number-parsing";

export const DELIVERY_EPSILON = 1e-6;

export function parseQuantity(
  raw: string | number | null | undefined,
  unit: string | null | undefined
): number | null {
  if (raw == null || raw === "") return null;
  const parsed = isIntegerUnit(unit) ? parseArInteger(raw) : parseArDecimal(raw);
  if (!parsed.ok || parsed.value == null || !Number.isFinite(parsed.value)) return null;
  return parsed.value;
}

export interface DeliveryTargetInput {
  unit: string | null | undefined;
  deliverableUnits?: number | null;
  packagingTotalUnits?: number | null;
  finishedQty?: string | null;
  plannedQuantity?: string | null;
}

/** Cantidad total a entregar de un trabajo, o null si no es numérica (entrega sin seguimiento de saldo, comportamiento histórico). */
export function resolveDeliveryTarget(input: DeliveryTargetInput): number | null {
  const candidates: Array<number | null> = [
    input.deliverableUnits != null && Number.isFinite(input.deliverableUnits)
      ? Number(input.deliverableUnits)
      : null,
    input.packagingTotalUnits != null && Number.isFinite(input.packagingTotalUnits)
      ? Number(input.packagingTotalUnits)
      : null,
    parseQuantity(input.finishedQty, input.unit),
    parseQuantity(input.plannedQuantity, input.unit),
  ];
  for (const c of candidates) {
    if (c != null && c > 0) return c;
  }
  return null;
}

export type DeliveryStepResult =
  | {
      ok: true;
      /** Cantidad que se entrega en este paso. */
      quantity: number;
      /** Acumulado entregado incluyendo este paso. */
      cumulative: number;
      /** Saldo pendiente luego de este paso (0 si se completó). */
      pending: number;
      /** true si con este paso se completa la cantidad objetivo. */
      complete: boolean;
    }
  | { ok: false; code: "INVALID_QUANTITY" | "EXCEEDS_BALANCE" | "NOTHING_PENDING"; error: string };

export function formatQty(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1e6) / 1e6).replace(".", ",");
}

/**
 * Planifica un paso de entrega. `requested` null = entregar todo el saldo.
 * `unit` define si la cantidad debe ser entera.
 */
export function planDeliveryStep(input: {
  target: number;
  alreadyDelivered: number;
  requested: number | null | undefined;
  unit: string | null | undefined;
}): DeliveryStepResult {
  const { target, alreadyDelivered, unit } = input;
  const balance = Math.max(0, target - alreadyDelivered);
  if (balance <= DELIVERY_EPSILON) {
    return {
      ok: false,
      code: "NOTHING_PENDING",
      error: "No queda saldo pendiente de entrega en este trabajo.",
    };
  }
  const requested = input.requested == null ? balance : Number(input.requested);
  if (!Number.isFinite(requested) || requested <= 0) {
    return {
      ok: false,
      code: "INVALID_QUANTITY",
      error: "La cantidad a entregar debe ser mayor que 0.",
    };
  }
  if (isIntegerUnit(unit) && !Number.isInteger(requested)) {
    return {
      ok: false,
      code: "INVALID_QUANTITY",
      error: "La cantidad a entregar debe ser un número entero de unidades.",
    };
  }
  if (requested > balance + DELIVERY_EPSILON) {
    return {
      ok: false,
      code: "EXCEEDS_BALANCE",
      error: `La cantidad (${formatQty(requested)}) supera el saldo pendiente de entrega (${formatQty(balance)}).`,
    };
  }
  const quantity = Math.min(requested, balance);
  const cumulative = alreadyDelivered + quantity;
  const pending = Math.max(0, target - cumulative);
  const complete = pending <= DELIVERY_EPSILON;
  return { ok: true, quantity, cumulative, pending: complete ? 0 : pending, complete };
}

export type PartialDeliveryResult =
  | { ok: true; quantity: number; cumulative: number; pending: number; complete: boolean }
  | { ok: false; code: "INVALID_QUANTITY" | "EXCEEDS_BALANCE" | "EXCEEDS_AVAILABLE" | "NOTHING_PENDING"; error: string };

/**
 * «Entregar parcial» (Envasado → Producción). A diferencia de la entrega final, el SALDO se mide contra la cantidad ASIGNADA al
 * trabajo (no contra lo producido hasta ahora): `pendiente = asignada − entregado`. El trabajo solo se completa al llegar a la
 * asignada. Además no se puede entregar más de lo terminado y todavía no entregado (`produced − entregado`) cuando ese dato existe.
 */
export function planPartialDelivery(input: {
  assigned: number;
  alreadyDelivered: number;
  /** Unidades terminadas según los registros operativos (realizadas). null/0 = sin dato: no limita. */
  produced: number | null | undefined;
  requested: number | null | undefined;
  unit: string | null | undefined;
}): PartialDeliveryResult {
  const { assigned, alreadyDelivered, unit } = input;
  const balance = Math.max(0, assigned - alreadyDelivered);
  if (balance <= DELIVERY_EPSILON) {
    return { ok: false, code: "NOTHING_PENDING", error: "No queda saldo pendiente de entrega en este trabajo." };
  }
  const requested = input.requested == null ? NaN : Number(input.requested);
  if (!Number.isFinite(requested) || requested <= 0) {
    return { ok: false, code: "INVALID_QUANTITY", error: "La cantidad a entregar debe ser mayor que 0." };
  }
  if (isIntegerUnit(unit) && !Number.isInteger(requested)) {
    return { ok: false, code: "INVALID_QUANTITY", error: "La cantidad a entregar debe ser un número entero de unidades." };
  }
  if (requested > balance + DELIVERY_EPSILON) {
    return {
      ok: false,
      code: "EXCEEDS_BALANCE",
      error: `La cantidad (${formatQty(requested)}) supera el saldo pendiente de entrega (${formatQty(balance)}).`,
    };
  }
  const produced = input.produced != null && Number.isFinite(input.produced) && input.produced > 0 ? input.produced : null;
  if (produced != null) {
    const available = Math.max(0, produced - alreadyDelivered);
    if (requested > available + DELIVERY_EPSILON) {
      return {
        ok: false,
        code: "EXCEEDS_AVAILABLE",
        error: `Solo hay ${formatQty(available)} unidades terminadas sin entregar (terminadas ${formatQty(produced)}, ya entregadas ${formatQty(alreadyDelivered)}). Registrá el avance antes de entregar más.`,
      };
    }
  }
  const cumulative = alreadyDelivered + requested;
  const pending = Math.max(0, assigned - cumulative);
  const complete = pending <= DELIVERY_EPSILON;
  return { ok: true, quantity: requested, cumulative, pending: complete ? 0 : pending, complete };
}

/**
 * Clave de idempotencia por defecto para llamadores que no mandan una (la UI legacy de Entregados): determinística
 * por trabajo + acumulado actual + cantidad pedida, así un doble clic o un reintento del MISMO paso comparte clave
 * y no duplica, mientras que el siguiente paso (otro acumulado) sí genera una entrega nueva.
 */
export function defaultDeliveryKey(input: {
  workItemId: string;
  alreadyDelivered: number;
  requested: number | null | undefined;
}): string {
  return `auto:${input.workItemId}:${formatQty(input.alreadyDelivered)}:${
    input.requested == null ? "all" : formatQty(Number(input.requested))
  }`;
}
