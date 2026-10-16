/**
 * Reglas PURAS de «Listo para entregar» (disponibilidad explícita). Sin E/S.
 *
 * Qué es: la confirmación de un usuario autorizado del ÚLTIMO sector del recorrido de que una cantidad de mercadería está
 * terminada y disponible para entregar al cliente. NO es una entrega: la entrega física sigue registrándose con el circuito
 * de entregas existente. Que un sector termine su tarea no alcanza, ni hay plazos automáticos.
 *
 * Último sector (según el circuito real de GENUS OS): el trabajo está HOY en Envasado Masivo, Envasado Premium o Codificado.
 * Elaboración siempre envía a Envasado (nunca es el último); Envasado termina directo o envía a Codificado, y al enviarlo el
 * trabajo pasa a ser de Codificado (mismo trabajo, sector CODIFICADO): desde ese momento Envasado ya no puede marcarlo.
 *
 * Cantidades. Las entregas anteriores a la primera confirmación (B) cubren unidades fuera de este mecanismo (trabajos
 * históricos o entregas directas): no son disponibilidad. Entregado desde entonces D1 = entregado − B. Disponible = marcado −
 * D1. Lo que se puede marcar ahora = unidades terminadas − B − el mayor entre lo marcado y D1. Evidencia de «terminadas»: trabajo terminado (revisión/completo) →
 * cantidad entregable del trabajo (misma regla que la entrega); trabajo en curso → lo informado en «Guardar avance».
 * Sin evidencia verificable no se inventa nada: se exige cargar el avance.
 */
import { isIntegerUnit } from "@/lib/utils/ar-number-parsing";
import { parseQuantity, resolveDeliveryTarget } from "@/lib/planning/circuit/delivery-math";

export const AVAILABILITY_SECTORS = ["ENVASADO_MASIVO", "ENVASADO_PREMIUM", "CODIFICADO"] as const;
/** Cifras de disponibilidad (compartidas con el portal del cliente). `markBase` null = todavía no hubo ninguna confirmación. */
export function availabilityFigures(input: { marked: number; delivered: number; markBase: number | null }) {
  const base = input.markBase == null ? input.delivered : Math.min(input.markBase, input.delivered);
  const deliveredSince = Math.max(0, input.delivered - base);
  return {
    base,
    deliveredSince,
    /** Marcado y aún sin entregar. */
    available: Math.max(0, input.marked - deliveredSince),
    /** Unidades que ya no se pueden volver a marcar (entregadas antes + marcadas o entregadas desde la primera confirmación). */
    covered: base + Math.max(input.marked, deliveredSince),
  };
}

const FINISHED_STATUSES = new Set(["revision", "completo"]);

/** Solo el sector que TIENE el trabajo hoy y que es el último del recorrido puede marcarlo. */
export function canActorMark(actorSector: string | null | undefined, workSector: string | null | undefined): boolean {
  const a = String(actorSector ?? "").toUpperCase();
  const w = String(workSector ?? "").toUpperCase();
  return (AVAILABILITY_SECTORS as readonly string[]).includes(w) && a === w;
}

/** Rectificar: Producción y Dirección (supervisión) o el sector que confirmó la disponibilidad. */
export function canActorRetract(actorSector: string | null | undefined, markSector: string | null | undefined): boolean {
  const a = String(actorSector ?? "").toUpperCase();
  return a === "PRODUCCION" || a === "DIRECCION" || (a !== "" && a === String(markSector ?? "").toUpperCase());
}

export type AvailabilityBlock =
  | "SECTOR_NO_APLICA"
  | "BORRADO"
  | "CANCELADO"
  | "ENTREGADO"
  | "SIN_CANTIDAD_TERMINADA"
  | "NADA_PENDIENTE_DE_MARCAR";

export const BLOCK_MESSAGES: Record<AvailabilityBlock, string> = {
  SECTOR_NO_APLICA: "Este trabajo no está en el último sector del recorrido (Envasado Masivo, Envasado Premium o Codificado): solo ese sector puede marcarlo.",
  BORRADO: "Este trabajo fue borrado por Producción.",
  CANCELADO: "Este trabajo está cancelado.",
  ENTREGADO: "Este trabajo ya fue entregado en su totalidad.",
  SIN_CANTIDAD_TERMINADA: "No hay una cantidad terminada verificable. Cargá lo realizado con «Guardar avance» (o finalizá el trabajo) antes de marcar disponibilidad.",
  NADA_PENDIENTE_DE_MARCAR: "Todas las unidades terminadas ya están marcadas como disponibles o entregadas.",
};

export type AvailabilityInput = {
  sector: string;
  status: string;
  unit: string | null;
  plannedQuantity: string | null;
  finishedQty: string | null;
  deliverableUnits: number | null;
  packagingTotalUnits: number | null;
  deleted: boolean;
  cancelled: boolean;
  /** Unidades ya entregadas físicamente (entregas finales vigentes). */
  delivered: number;
  /** Unidades marcadas como disponibles (marcas vigentes, aunque ya se hayan entregado). */
  marked: number;
  /** Unidades ya entregadas cuando se hizo la PRIMERA confirmación del trabajo (null = nunca hubo). */
  markBase: number | null;
};

export type AvailabilityEvaluation = {
  /** Unidades terminadas verificables (null = sin evidencia). */
  produced: number | null;
  /** Total a entregar del trabajo (null = sin dato). */
  target: number | null;
  marked: number;
  delivered: number;
  /** Marcado y aún sin entregar. */
  available: number;
  /** Cuántas unidades se pueden marcar ahora. */
  maxQuantity: number;
  block: AvailabilityBlock | null;
};

const EPS = 1e-6;

export function evaluateAvailability(i: AvailabilityInput): AvailabilityEvaluation {
  const finished = FINISHED_STATUSES.has(i.status);
  const target = resolveDeliveryTarget({
    unit: i.unit,
    deliverableUnits: i.deliverableUnits,
    packagingTotalUnits: i.packagingTotalUnits,
    finishedQty: i.finishedQty,
    plannedQuantity: i.plannedQuantity,
  });
  const reported = parseQuantity(i.finishedQty, i.unit);
  // Terminado → cantidad entregable (misma regla que la entrega). En curso → solo lo informado en «Guardar avance».
  const produced = finished ? target : reported != null && reported > 0 ? reported : null;
  const { covered, available } = availabilityFigures({ marked: i.marked, delivered: i.delivered, markBase: i.markBase });
  let maxQuantity = produced == null ? 0 : Math.max(0, produced - covered);
  if (target != null) maxQuantity = Math.min(maxQuantity, Math.max(0, target - covered));
  if (isIntegerUnit(i.unit)) maxQuantity = Math.floor(maxQuantity + EPS);

  let block: AvailabilityBlock | null = null;
  if (!(AVAILABILITY_SECTORS as readonly string[]).includes(i.sector)) block = "SECTOR_NO_APLICA";
  else if (i.deleted) block = "BORRADO";
  else if (i.cancelled) block = "CANCELADO";
  else if (i.status === "entregado") block = "ENTREGADO";
  else if (produced == null) block = "SIN_CANTIDAD_TERMINADA";
  else if (maxQuantity <= EPS) block = "NADA_PENDIENTE_DE_MARCAR";
  return { produced, target, marked: i.marked, delivered: i.delivered, available, maxQuantity, block };
}

export type QuantityCheck = { ok: true; quantity: number } | { ok: false; code: "INVALID" | "EXCEEDS"; message: string };

/** Valida la cantidad pedida contra lo marcable. `requested` ausente = todo lo marcable. */
export function checkRequestedQuantity(requested: unknown, ev: AvailabilityEvaluation, unit: string | null): QuantityCheck {
  const q = requested == null || requested === "" ? ev.maxQuantity : Number(requested);
  if (!Number.isFinite(q) || q <= 0) return { ok: false, code: "INVALID", message: "La cantidad debe ser un número mayor que cero." };
  if (isIntegerUnit(unit) && !Number.isInteger(q)) return { ok: false, code: "INVALID", message: "La cantidad debe ser un número entero de unidades." };
  if (q > ev.maxQuantity + EPS) {
    return { ok: false, code: "EXCEEDS", message: `No podés marcar más de ${ev.maxQuantity} (unidades terminadas y todavía no marcadas ni entregadas).` };
  }
  return { ok: true, quantity: q };
}

/**
 * ¿Se puede retirar esta marca sin afectar lo ya entregado? Lo entregado desde la primera confirmación consume primero las
 * marcas MÁS ANTIGUAS: una marca solo se puede retirar si ninguna de sus unidades quedó cubierta por una entrega, es decir,
 * si lo entregado no supera la suma de las marcas anteriores a ella.
 */
export function canRetractMark(marksOldestFirst: ReadonlyArray<{ id: string; quantity: number }>, markId: string, deliveredSince: number): boolean {
  let older = 0;
  for (const m of marksOldestFirst) {
    if (m.id === markId) return deliveredSince <= older + EPS;
    older += m.quantity;
  }
  return false;
}
