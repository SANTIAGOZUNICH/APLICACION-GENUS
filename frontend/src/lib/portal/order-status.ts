/**
 * Estado COMERCIAL simplificado de un pedido (lo que ve el cliente). Funciones PURAS, sin E/S.
 *
 *   1 Pedido recibido      el pedido existe pero todavía no tiene ningún trabajo operativo
 *   2 Pedido programado    tiene trabajo asignado/programado, la elaboración todavía no empezó
 *   3 En elaboración       la elaboración está en curso (o terminada y a la espera de pasar a envasado)
 *   4 En envasado          pasó a Envasado/Codificado (incluye «finalización»)
 *   5 Listo para entregar  un usuario autorizado del último sector CONFIRMÓ la disponibilidad (marca explícita de
 *                          «Listo para entregar») de TODO lo que falta entregar; es la única señal que usa el sistema
 *   6 Entregado            todas las entregas finales registradas cubren lo pedido
 *
 * Reglas del pedido (varios productos):
 *  - El estado del pedido es el del producto MENOS avanzado entre los vigentes. Nunca «Listo para entregar» si queda un
 *    producto pendiente: se informa el progreso por producto (listos / entregados / en proceso).
 *  - Los productos cancelados no cuentan para el estado ni lo bloquean; si TODOS están cancelados el pedido figura cancelado.
 *  - Reproceso (trabajo con rechazo de Calidad todavía abierto): el producto no puede figurar «Listo» ni «Entregado»; vuelve
 *    a «En envasado» (o a «En elaboración» si aún no pasó a envasado). El cliente NUNCA ve el motivo interno.
 *  - Entregas parciales: un producto con entregas pero con unidades pendientes NO es «Entregado»; conserva su etapa y muestra
 *    las cantidades. Solo cuenta como «Listo» cuando lo que falta entregar ya fue confirmado como disponible.
 */
import type { PortalStageId, PortalSubstage } from "./stage-rules";

export const COMMERCIAL_STATUSES = [
  { id: 1, key: "RECIBIDO", label: "Pedido recibido", message: "Recibimos tu pedido. Pronto lo vamos a programar." },
  { id: 2, key: "PROGRAMADO", label: "Pedido programado", message: "Tu pedido está programado en nuestro laboratorio." },
  { id: 3, key: "ELABORACION", label: "En elaboración", message: "Estamos elaborando tu producto en nuestro laboratorio." },
  { id: 4, key: "ENVASADO", label: "En envasado", message: "Tu producto finalizó la elaboración y se encuentra en proceso de envasado." },
  { id: 5, key: "LISTO", label: "Listo para entregar", message: "¡Tu producto está listo! Podés coordinar la entrega con nuestro equipo." },
  { id: 6, key: "ENTREGADO", label: "Entregado", message: "Tu producto fue entregado. ¡Gracias por confiar en Laboratorio Genus!" },
] as const;

export type CommercialStatusId = (typeof COMMERCIAL_STATUSES)[number]["id"];
export type CommercialStatusKey = (typeof COMMERCIAL_STATUSES)[number]["key"];
export type CommercialStatus = { id: CommercialStatusId; key: CommercialStatusKey; label: string };

const byId = (id: CommercialStatusId): CommercialStatus => {
  const s = COMMERCIAL_STATUSES[id - 1]!;
  return { id: s.id, key: s.key, label: s.label };
};
export const commercialStatus = byId;

/** Lo mínimo que hace falta saber de un producto (un renglón de pedido) para derivar su estado comercial. */
export type ProductStatusInput = {
  /** Tiene al menos un trabajo operativo vivo (no cancelado ni borrado). */
  hasWork: boolean;
  /** Todos sus trabajos fueron cancelados (o el renglón se canceló). */
  cancelled: boolean;
  /** Etapa del circuito (deriveProductStage). null si no hay trabajos. */
  stage: PortalStageId | null;
  substage?: PortalSubstage;
  /** La elaboración ya empezó (algún trabajo salió de «pendiente»). */
  started: boolean;
  /** Hay un trabajo con rechazo de Calidad todavía abierto (reproceso). */
  reprocess: boolean;
};

export type ProductCommercial = { status: CommercialStatus | null; cancelled: boolean; reprocessing: boolean };

/** Estado comercial de UN producto. `status` es null solo si está cancelado. */
export function deriveClientProductStatus(i: ProductStatusInput): ProductCommercial {
  if (i.cancelled) return { status: null, cancelled: true, reprocessing: false };
  if (!i.hasWork || !i.stage) return { status: byId(1), cancelled: false, reprocessing: false };
  let id: CommercialStatusId;
  switch (i.stage) {
    case "ENTREGADO":
      id = 6;
      break;
    case "LISTO":
      id = 5;
      break;
    case "ENVASADO":
      id = 4;
      break;
    default:
      id = i.started || i.substage === "TERMINADA_EN_TRASPASO" ? 3 : 2;
  }
  let reprocessing = false;
  if (i.reprocess && id >= 5) {
    id = 4;
    reprocessing = true;
  }
  return { status: byId(id), cancelled: false, reprocessing };
}

export type OrderProductSummary = { key: string; status: CommercialStatus | null; cancelled: boolean };

export type OrderStatus = {
  /** Estado del pedido (el del producto menos avanzado). null si todo el pedido fue cancelado. */
  status: CommercialStatus | null;
  cancelled: boolean;
  /** Todo el pedido listo para entregar o entregado, sin productos pendientes. */
  todoListo: boolean;
  /** Algún producto ya está listo/entregado pero el pedido todavía no está completo. */
  partial: boolean;
  progress: {
    /** Productos vigentes (sin cancelados). */
    total: number;
    cancelados: number;
    /** Listos para entregar (aún sin entregar). */
    listos: number;
    entregados: number;
    /** Todavía en proceso (1 a 4). */
    enProceso: number;
  };
  message: string;
};

/** Estado del PEDIDO a partir de los estados de sus productos. */
export function deriveClientOrderStatus(products: ReadonlyArray<ProductCommercial>): OrderStatus {
  const cancelledCount = products.filter((p) => p.cancelled).length;
  const live = products.filter((p) => !p.cancelled && p.status);
  const empty = { total: 0, cancelados: cancelledCount, listos: 0, entregados: 0, enProceso: 0 };
  if (live.length === 0) {
    const cancelled = cancelledCount > 0;
    return { status: null, cancelled, todoListo: false, partial: false, progress: empty, message: cancelled ? "Este pedido fue cancelado." : "Todavía no hay productos en este pedido." };
  }
  const ids = live.map((p) => p.status!.id);
  const min = Math.min(...ids) as CommercialStatusId;
  const ready = ids.filter((x) => x === 5).length;
  const delivered = ids.filter((x) => x === 6).length;
  const inProgress = ids.filter((x) => x < 5).length;
  const todoListo = min >= 5;
  const partial = !todoListo && ready + delivered > 0;
  const progress = { total: live.length, cancelados: cancelledCount, listos: ready, entregados: delivered, enProceso: inProgress };
  let message: string = COMMERCIAL_STATUSES[min - 1]!.message;
  if (live.length > 1) {
    if (min === 6) message = "Todos los productos de tu pedido fueron entregados. ¡Gracias por confiar en Laboratorio Genus!";
    else if (min === 5) message = "Todo tu pedido está listo para entregar. Podés coordinar la entrega con nuestro equipo.";
    else if (partial) message = `${ready + delivered} de ${live.length} productos ya están listos o entregados; el resto sigue en proceso.`;
  }
  return { status: byId(min), cancelled: false, todoListo, partial, progress, message };
}

/** Texto de progreso por producto para el resumen del pedido («Productos listos o entregados: 2 de 3»). */
export function orderProgressText(p: OrderStatus["progress"]): string {
  if (p.total === 0) return "";
  return `Productos listos o entregados: ${p.listos + p.entregados} de ${p.total}`;
}
