/**
 * Cifras REALES de un trabajo de Elaboración (kg solicitados / elaborados / entregados / pendientes) y su estado, para que Materias
 * Primas consulte la planificación semanal sin duplicar datos. Todo sale de los registros reales (avance, renglones de entrega y
 * envío a Envasado): nunca se asume que se elaboró lo solicitado ni se recorta lo elaborado a lo pedido.
 */
import { DELIVERY_EPSILON, parseQuantity } from "@/lib/planning/circuit/delivery-math";

export type ElaboracionStateKey = "PENDIENTE" | "EN_ELABORACION" | "ELABORADO" | "ENTREGADO_PARCIAL" | "ENTREGADO" | "BLOQUEADO" | "CANCELADO";

export const ELABORACION_STATE_LABEL: Record<ElaboracionStateKey, string> = {
  PENDIENTE: "Pendiente de elaboración",
  EN_ELABORACION: "En elaboración",
  ELABORADO: "Elaborado",
  ENTREGADO_PARCIAL: "Entregado parcialmente",
  ENTREGADO: "Entregado",
  BLOQUEADO: "Bloqueado",
  CANCELADO: "Cancelado",
};

export interface ElaboracionFigures {
  /** Kg solicitados (referencia de planificación; no es un tope). */
  requestedKg: number | null;
  /** Kg realmente elaborados (null = todavía no registrados). */
  elaboratedKg: number | null;
  /** Kg entregados (null = no hay forma de saberlo: p. ej. entregado sin renglones ni envío registrado). */
  deliveredKg: number | null;
  /** Kg elaborados que todavía no se entregaron (null si no hay kg elaborados registrados). */
  pendingKg: number | null;
  state: ElaboracionStateKey;
  stateLabel: string;
  /** Fecha del último envío/entrega registrado (ISO) o null. */
  lastDeliveryAt: string | null;
}

export interface ElaboracionFiguresInput {
  plannedQuantity: string | null | undefined;
  finishedQty: string | null | undefined;
  /** operational_status del trabajo (pendiente | en_curso | bloqueado | completo | revision | entregado | cancelado …). */
  operationalStatus: string | null | undefined;
  /** Estado de planificación (CANCELADO). */
  status?: string | null;
  unit?: string | null;
  /** Suma de los renglones de entrega ACTIVOS (canceladas descontadas). */
  deliveredLinesKg: number;
  /** Kg informados en el envío a Envasado (null = sin envío). */
  sentToEnvasadoKg: number | null;
  sentToEnvasado: boolean;
  lastDeliveryAt?: string | null;
}

const SENT_OK = new Set(["completo", "revision", "entregado", "en_codificado", "codificado_completo"]);

export function computeElaboracionFigures(i: ElaboracionFiguresInput): ElaboracionFigures {
  const unit = i.unit ?? "kg";
  const requestedKg = parseQuantity(i.plannedQuantity, unit);
  const finished = parseQuantity(i.finishedQty, unit);
  const elaboratedKg = finished != null && finished > 0 ? finished : null;
  const op = String(i.operationalStatus ?? "").trim().toLowerCase();
  const cancelled = String(i.status ?? "").toUpperCase() === "CANCELADO" || op === "cancelado";

  // Renglones de entrega (si hay) mandan; si no, lo enviado a Envasado cuenta como entregado (solo si el trabajo sigue enviado).
  const sentCounts = i.sentToEnvasado && SENT_OK.has(op);
  let deliveredKg: number | null = null;
  if (i.deliveredLinesKg > DELIVERY_EPSILON) deliveredKg = i.deliveredLinesKg;
  else if (sentCounts) deliveredKg = i.sentToEnvasadoKg ?? elaboratedKg;
  else if (op === "entregado") deliveredKg = null;
  else deliveredKg = 0;

  const base = elaboratedKg ?? (sentCounts ? i.sentToEnvasadoKg : null);
  const pendingKg = base == null || deliveredKg == null ? null : Math.max(0, base - deliveredKg) <= DELIVERY_EPSILON ? 0 : Math.max(0, base - deliveredKg);

  let state: ElaboracionStateKey;
  if (cancelled) state = "CANCELADO";
  else if (deliveredKg != null && deliveredKg > DELIVERY_EPSILON && base != null && deliveredKg < base - DELIVERY_EPSILON) state = "ENTREGADO_PARCIAL";
  else if ((deliveredKg != null && deliveredKg > DELIVERY_EPSILON) || op === "entregado") state = "ENTREGADO";
  else if (op === "bloqueado") state = "BLOQUEADO";
  else if (op === "completo" || op === "revision") state = "ELABORADO";
  else if (op === "en_curso" || elaboratedKg != null) state = "EN_ELABORACION";
  else state = "PENDIENTE";

  return { requestedKg, elaboratedKg, deliveredKg, pendingKg, state, stateLabel: ELABORACION_STATE_LABEL[state], lastDeliveryAt: i.lastDeliveryAt ?? null };
}
