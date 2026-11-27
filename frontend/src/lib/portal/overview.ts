/**
 * Vista del cliente (PURA, sin E/S): convierte filas operativas de GENUS OS en lo que el portal muestra.
 *
 * Seguridad por construcción: este módulo SOLO produce campos de una lista blanca (producto, número de pedido, cantidades,
 * etapa, fechas de hitos, entregas). No existe ningún camino para que salgan fórmulas, materias primas, observaciones,
 * usuarios internos, líneas, lotes ni identificadores internos: los ids que se devuelven son opacos y por cliente.
 */
import { clientKey } from "@/lib/entregas/rules";
import {
  commercialStatus,
  deriveClientOrderStatus,
  deriveClientProductStatus,
  orderProgressText,
  type CommercialStatus,
  type OrderStatus,
} from "./order-status";
import { stageCountdown, type BusinessCalendarOptions, type Countdown } from "./business-days";
import { hmac } from "./security";
import { pedidoSentToSector } from "./client-link-rules";
import {
  ESTIMATE_DISCLAIMER,
  FINALIZATION_MESSAGE,
  PARTIAL_READY_MESSAGE,
  STAGE_ESTIMATE_DAYS,
  STAGE_LABELS,
  STAGE_MESSAGES,
  deriveProductStage,
  stageIndex,
  type DeliveryFact,
  type Milestones,
  type PortalStageId,
  type PortalSubstage,
  type PortalWorkSector,
  type ProductStage,
  type WorkFact,
} from "./stage-rules";

export type RawWorkRow = {
  id: string;
  client: string;
  product: string;
  sector: PortalWorkSector;
  operationalStatus: string;
  source: string | null;
  createdAt: string | null;
  completedAt: string | null;
  progressUpdatedAt: string | null;
  sentToCodificadoAt: string | null;
  viaCodificado: boolean;
  plannedQuantity: string | null;
  unit: string | null;
  finishedQty: string | null;
  deliverableUnits: number | null;
  packagingTotalUnits: number | null;
  productionPedidoId: string | null;
  /** production_pedidos.op (número de pedido visible). */
  pedidoOp: string | null;
  /** production_pedidos.producto (nombre del producto tal como lo pidió el cliente). */
  pedidoProducto: string | null;
  /** production_pedidos.fecha (YYYY-MM-DD). */
  pedidoFecha?: string | null;
  /** Decisión de Calidad (solo para derivar «reproceso»; NUNCA sale del servidor). */
  qualityStatus?: string | null;
  /** production_pedidos.estado: el pedido ya fue ENVIADO a un sector por Producción (NUNCA sale del servidor). */
  pedidoEstado?: string | null;
};
/** Renglón de pedido (un producto) SIN trabajos vivos: recién recibido, o con todos sus trabajos cancelados. */
export type RawPedidoRow = {
  id: string;
  op: string | null;
  producto: string | null;
  estado: string | null;
  cancelledWorks: number;
  /** Estado manual de Producción de un pedido vinculado por ID y todavía SIN trabajos: lo que el cliente ve mientras no haya trabajos. */
  manualStage?: "ELABORACION" | "ENVASADO" | null;
  /** Fecha del pedido (YYYY-MM-DD) y cantidad pedida (Q, en unidades): lo que ve el cliente de un pedido sin trabajos. */
  fecha?: string | null;
  q?: number | null;
};
export type RawMarkRow = { id: string; workItemId: string; quantity: number; at: string; /** Entregado al confirmar (base). */ deliveredBefore?: number; retracted?: boolean };
export type RawDeliveryRow = { key: string; workItemId: string; at: string; quantity: number | null; unit: string | null };
export type RawEventRow = { workItemId: string; type: string; at: string };
export type ConfirmationInfo = { at: string; by: string };

export type PortalDeliveryView = {
  id: string;
  product: string;
  orderRef: string | null;
  deliveredAt: string;
  quantity: number | null;
  unit: string | null;
  confirmation: ConfirmationInfo | null;
  /** Se puede confirmar la recepción: hay una entrega física final registrada y todavía no se confirmó. */
  canConfirm: boolean;
};

export type PortalCountdownView = {
  totalDays: number;
  remainingDays: number;
  elapsedDays: number;
  /** Fecha estimada de fin de etapa (orientativa; NO es una fecha de entrega comprometida). */
  estimatedDate: string;
  overdue: boolean;
  progressPct: number;
  startedDate: string;
};

export type PortalTimelineStep = { stage: PortalStageId; label: string; state: "done" | "current" | "upcoming"; date: string | null };

export type PortalProductView = {
  id: string;
  /** Pedido al que pertenece (id opaco; ver `orders`). */
  orderId: string;
  /** Estado comercial simplificado (1 a 6; 0 = cancelado). La etapa de abajo es la del circuito de 4 pasos. */
  commercial: PortalCommercialView;
  product: string;
  orderRef: string | null;
  /** Fecha del pedido (YYYY-MM-DD) cargada por Producción; null si no tiene. */
  orderedAt: string | null;
  stage: PortalStageId;
  stageLabel: string;
  substage: PortalSubstage;
  stageIndex: number;
  message: string;
  quantities: ProductStage["quantities"];
  partialDelivery: boolean;
  countdown: PortalCountdownView | null;
  /** Avance visual de 0 a 100. */
  progressPct: number;
  lastDeliveryAt: string | null;
  /** Fecha y hora en que un usuario autorizado confirmó la primera disponibilidad vigente (null = nada confirmado). */
  availableSince: string | null;
  timeline: PortalTimelineStep[];
  deliveries: PortalDeliveryView[];
};

/** Estado comercial visible (id 0 = cancelado, fuera de los 6 estados del circuito). */
export type PortalCommercialView = { id: 0 | CommercialStatus["id"]; key: CommercialStatus["key"] | "CANCELADO"; label: string };
const CANCELLED_VIEW: PortalCommercialView = { id: 0, key: "CANCELADO", label: "Cancelado" };

export type PortalOrderView = {
  id: string;
  orderRef: string | null;
  status: PortalCommercialView;
  cancelled: boolean;
  todoListo: boolean;
  partial: boolean;
  message: string;
  progress: OrderStatus["progress"];
  progressText: string;
  productIds: string[];
};

export type PortalSummary = {
  /** Productos que todavía no se entregaron (incluye los listos para entregar; sin cancelados). */
  inProcess: number;
  recibidos: number;
  programados: number;
  elaboracion: number;
  envasado: number;
  listos: number;
  entregados: number;
  pedidos: number;
};

export type PortalOverviewData = {
  orders: PortalOrderView[];
  products: PortalProductView[];
  deliveries: PortalDeliveryView[];
  summary: PortalSummary;
  disclaimer: string;
  /** Marcas de disponibilidad con cantidad aún sin entregar (insumo del aviso «listo»). No se envía al navegador. */
  ready: Array<{ productId: string; product: string; workItemId: string; markId: string; available: number; unit: string | null; readySince: string }>;
};

export const opaque = (clientId: string, label: string, value: string) => hmac(label, `${clientId}:${value}`).slice(0, 24);

/** Etapa → avance visual base; la cuenta regresiva suma hasta 28 puntos dentro de Elaboración y Envasado. */
function visualProgress(stage: PortalStageId, substage: PortalSubstage, countdown: PortalCountdownView | null): number {
  const within = countdown ? Math.min(1, Math.max(0, countdown.progressPct / 100)) : 0;
  switch (stage) {
    case "ELABORACION":
      return Math.round(substage === "TERMINADA_EN_TRASPASO" ? 36 : 8 + 28 * within);
    case "ENVASADO":
      return Math.round(substage === "FINALIZACION" ? 74 : 40 + 28 * within);
    case "LISTO":
      return 90;
    default:
      return 100;
  }
}

function timelineOf(stage: PortalStageId, m: Milestones): PortalTimelineStep[] {
  const cur = stageIndex(stage);
  const dates: Record<PortalStageId, string | null> = { ELABORACION: m.elaboracion, ENVASADO: m.envasado, LISTO: m.listo, ENTREGADO: m.entregado };
  return (["ELABORACION", "ENVASADO", "LISTO", "ENTREGADO"] as PortalStageId[]).map((s, i) => ({
    stage: s,
    label: STAGE_LABELS[s],
    // ENTREGADO es el último paso: cuando se alcanza queda completo.
    state: i < cur || (stage === "ENTREGADO" && i === cur) ? "done" : i === cur ? "current" : "upcoming",
    date: dates[s],
  }));
}

function messageFor(stage: PortalStageId, substage: PortalSubstage, available: number): string {
  if (stage === "ELABORACION" && substage === "TERMINADA_EN_TRASPASO") return "Finalizó la elaboración de tu producto. Estamos preparando el paso a envasado.";
  if (stage === "ENVASADO" && substage === "FINALIZACION") return FINALIZATION_MESSAGE;
  if (stage === "ENVASADO" && available > 0) return PARTIAL_READY_MESSAGE;
  return STAGE_MESSAGES[stage];
}

export function buildOverview(input: {
  clientId: string;
  works: RawWorkRow[];
  deliveries: RawDeliveryRow[];
  events: RawEventRow[];
  /** Marcas de disponibilidad vigentes (no retiradas). Sin marca explícita no hay «Listo para entregar». */
  marks?: RawMarkRow[];
  /** Renglones de pedido sin trabajos vivos (recibidos o cancelados). */
  pedidos?: RawPedidoRow[];
  confirmations: ReadonlyMap<string, ConfirmationInfo>;
  now: Date;
  calendar?: BusinessCalendarOptions;
}): PortalOverviewData {
  const { clientId, now } = input;
  const eventsByWork = new Map<string, RawEventRow[]>();
  for (const e of input.events) eventsByWork.set(e.workItemId, [...(eventsByWork.get(e.workItemId) ?? []), e]);
  const delByWork = new Map<string, RawDeliveryRow[]>();
  for (const d of input.deliveries) delByWork.set(d.workItemId, [...(delByWork.get(d.workItemId) ?? []), d]);
  const marksByWork = new Map<string, RawMarkRow[]>();
  for (const m of input.marks ?? []) marksByWork.set(m.workItemId, [...(marksByWork.get(m.workItemId) ?? []), m]);
  const first = (events: RawEventRow[] | undefined, type: string) => (events ?? []).filter((e) => e.type === type).map((e) => e.at).sort()[0] ?? null;

  type Group = { key: string; rows: RawWorkRow[]; facts: WorkFact[] };
  const groups = new Map<string, Group>();
  for (const w of input.works) {
    const ev = eventsByWork.get(w.id);
    const fact: WorkFact = {
      id: w.id,
      sector: w.sector,
      status: w.operationalStatus,
      source: w.source,
      createdAt: w.createdAt,
      assignedAt: first(ev, "ITEM_ASSIGNED"),
      receivedFromElaboracionAt: first(ev, "RECEIVED_FROM_ELABORACION"),
      completedAt: w.completedAt,
      progressUpdatedAt: w.progressUpdatedAt,
      sentToCodificadoAt: w.sentToCodificadoAt,
      viaCodificado: w.viaCodificado,
      plannedQuantity: w.plannedQuantity,
      unit: w.unit,
      finishedQty: w.finishedQty,
      deliverableUnits: w.deliverableUnits,
      packagingTotalUnits: w.packagingTotalUnits,
      deliveries: (delByWork.get(w.id) ?? []).map((d): DeliveryFact => ({ key: d.key, at: d.at, quantity: d.quantity, unit: d.unit })),
      marks: (marksByWork.get(w.id) ?? []).filter((m) => !m.retracted).map((m) => ({ id: m.id, quantity: m.quantity, at: m.at })),
      // Base: entregado al hacerse la PRIMERA confirmación del trabajo (aunque después se haya retirado).
      markBase: (() => {
        const all = [...(marksByWork.get(w.id) ?? [])].sort((a, b) => (a.at < b.at ? -1 : 1));
        return all.length ? (all[0]!.deliveredBefore ?? 0) : null;
      })(),
    };
    // Cada fila de pedido-producto es UN producto del cliente; sin pedido (trabajos manuales) se agrupa por nombre.
    const key = w.productionPedidoId ? `p:${w.productionPedidoId}` : `n:${clientKey(w.product)}`;
    const g = groups.get(key) ?? { key, rows: [], facts: [] };
    g.rows.push(w);
    g.facts.push(fact);
    groups.set(key, g);
  }

  const products: PortalProductView[] = [];
  /** id de producto → clave interna del pedido (para agrupar sin exponer nada). */
  const productOrder = new Map<string, string>();
  const deliveriesAll: PortalDeliveryView[] = [];
  const ready: PortalOverviewData["ready"] = [];

  for (const g of groups.values()) {
    const stage = deriveProductStage(g.facts);
    if (!stage) continue;
    const down = g.rows.filter((r) => r.sector !== "ELABORACION");
    const label = g.rows.find((r) => r.pedidoProducto)?.pedidoProducto ?? (down[0] ?? g.rows[0]!).product;
    const orderRef = g.rows.find((r) => r.pedidoOp)?.pedidoOp?.trim() || null;
    const id = opaque(clientId, "product", g.key);
    const orderKey = orderKeyOf(orderRef, g.key);
    // «En elaboración» desde que Producción envía el pedido a Elaboración (estado del pedido), no recién cuando hay avance.
    const started = g.rows.some((r) => r.sector !== "ELABORACION" || r.operationalStatus !== "pendiente" || r.progressUpdatedAt != null || pedidoSentToSector(r.pedidoEstado));
    const reprocess = g.rows.some((r) => r.qualityStatus === "rechazado" && r.operationalStatus !== "entregado");
    const commercial = deriveClientProductStatus({ hasWork: true, cancelled: false, stage: stage.stage, substage: stage.substage, started, reprocess });
    const cs = commercial.status!;

    let countdown: PortalCountdownView | null = null;
    const total = STAGE_ESTIMATE_DAYS[stage.stage];
    if (total && stage.substage !== "TERMINADA_EN_TRASPASO") {
      const c: Countdown | null = stageCountdown(stage.stageStartedAt, now, total, input.calendar);
      if (c) {
        countdown = { totalDays: c.totalDays, remainingDays: c.remainingDays, elapsedDays: c.elapsedDays, estimatedDate: c.estimatedDate, overdue: c.overdue, progressPct: c.progressPct, startedDate: c.startDate };
      }
    }

    const dels: PortalDeliveryView[] = g.facts
      .flatMap((f) => f.deliveries)
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .map((d) => {
        const conf = input.confirmations.get(d.key) ?? null;
        return { id: opaque(clientId, "delivery", d.key), product: label, orderRef, deliveredAt: d.at, quantity: d.quantity, unit: d.unit, confirmation: conf, canConfirm: !conf };
      });
    deliveriesAll.push(...dels);

    for (const r of stage.readyWorks) ready.push({ productId: id, product: label, workItemId: r.workItemId, markId: r.markId, available: r.available, unit: stage.quantities.unit, readySince: r.readySince });

    // Con reproceso el cliente ve la etapa anterior (sin motivo): el avance visual y los textos acompañan al estado comercial.
    const shownStage: PortalStageId = commercial.reprocessing ? "ENVASADO" : stage.stage;
    productOrder.set(id, orderKey);
    products.push({
      id,
      orderId: opaque(clientId, "order", orderKey),
      commercial: { id: cs.id, key: cs.key, label: cs.label },
      product: label,
      orderRef,
      orderedAt: g.rows.find((r) => r.pedidoFecha)?.pedidoFecha ?? null,
      stage: shownStage,
      stageLabel: STAGE_LABELS[shownStage],
      substage: commercial.reprocessing ? null : stage.substage,
      stageIndex: stageIndex(shownStage),
      message: cs.id <= 2 ? cs.key === "PROGRAMADO" ? "Tu pedido está programado en nuestro laboratorio. Todavía no comenzó la elaboración." : cs.key === "RECIBIDO" ? "Recibimos tu pedido. Pronto lo vamos a programar." : "" : messageFor(shownStage, commercial.reprocessing ? null : stage.substage, commercial.reprocessing ? 0 : stage.quantities.available),
      quantities: stage.quantities,
      partialDelivery: stage.partialDelivery,
      countdown,
      progressPct: visualProgress(stage.stage, stage.substage, countdown),
      lastDeliveryAt: stage.lastDeliveryAt,
      availableSince: stage.availableSince,
      timeline: timelineOf(stage.stage, stage.milestones),
      deliveries: dels,
    });
  }

  // Renglones de pedido SIN trabajos vivos: recién recibidos («Pedido recibido») o con todos sus trabajos cancelados.
  const seenPedidos = new Set([...groups.keys()]);
  for (const ped of input.pedidos ?? []) {
    const key = `p:${ped.id}`;
    if (seenPedidos.has(key)) continue;
    seenPedidos.add(key);
    const cancelled = ped.cancelledWorks > 0;
    const received = !cancelled && (ped.estado == null || ped.estado === "" || ped.estado === "INGRESO");
    const manual = !cancelled && !received ? ped.manualStage ?? null : null;
    if (!cancelled && !received && !manual) continue; // estado ajeno al circuito sin trabajos: no se inventa nada
    const commercial = manual
      ? deriveClientProductStatus({ hasWork: true, cancelled: false, stage: manual, substage: null, started: true, reprocess: false })
      : deriveClientProductStatus({ hasWork: false, cancelled, stage: null, started: false, reprocess: false });
    const orderRef = ped.op?.trim() || null;
    const orderKey = orderKeyOf(orderRef, key);
    const id = opaque(clientId, "product", key);
    const cs = commercial.status;
    productOrder.set(id, orderKey);
    products.push({
      id,
      orderId: opaque(clientId, "order", orderKey),
      commercial: cs ? { id: cs.id, key: cs.key, label: cs.label } : CANCELLED_VIEW,
      product: ped.producto?.trim() || "Producto",
      orderRef,
      orderedAt: ped.fecha ?? null,
      stage: manual ?? "ELABORACION",
      stageLabel: STAGE_LABELS[manual ?? "ELABORACION"],
      substage: null,
      stageIndex: stageIndex(manual ?? "ELABORACION"),
      message: !cs ? "Este producto fue cancelado." : manual ? messageFor(manual, null, 0) : "Recibimos tu pedido. Pronto lo vamos a programar.",
      quantities: { unit: ped.q != null ? "un" : null, requested: ped.q ?? null, delivered: 0, pending: ped.q ?? null, available: 0, mixedUnits: false },
      partialDelivery: false,
      countdown: null,
      progressPct: manual ? visualProgress(manual, null, null) : 0,
      lastDeliveryAt: null,
      availableSince: null,
      timeline: timelineOf(manual ?? "ELABORACION", { elaboracion: null, envasado: null, listo: null, entregado: null }),
      deliveries: [],
    });
  }

  // Orden: lo que requiere atención del cliente primero (listos), después más avanzado → menos avanzado, entregados y cancelados al final.
  const rank = (p: PortalProductView) => (p.commercial.id === 0 ? 9 : p.commercial.id === 6 ? 8 : 5 - p.commercial.id);
  products.sort((a, b) => rank(a) - rank(b) || a.product.localeCompare(b.product, "es", { sensitivity: "base" }));
  deliveriesAll.sort((a, b) => (a.deliveredAt < b.deliveredAt ? 1 : -1));

  // Pedidos: el estado es el del producto menos avanzado; nunca «Listo» con productos pendientes.
  const byOrder = new Map<string, PortalProductView[]>();
  for (const p of products) byOrder.set(p.orderId, [...(byOrder.get(p.orderId) ?? []), p]);
  const orders: PortalOrderView[] = [...byOrder.entries()].map(([orderId, ps]) => {
    const st = deriveClientOrderStatus(ps.map((p) => (p.commercial.id === 0 ? { status: null, cancelled: true, reprocessing: false } : { status: commercialStatus(p.commercial.id), cancelled: false, reprocessing: false })));
    return {
      id: orderId,
      orderRef: ps.find((p) => p.orderRef)?.orderRef ?? null,
      status: st.status ? { id: st.status.id, key: st.status.key, label: st.status.label } : CANCELLED_VIEW,
      cancelled: st.cancelled,
      todoListo: st.todoListo,
      partial: st.partial,
      message: st.message,
      progress: st.progress,
      progressText: orderProgressText(st.progress),
      productIds: ps.map((p) => p.id),
    };
  });
  const orderRank = (o: PortalOrderView) => (o.cancelled ? 9 : o.status.id === 6 ? 8 : o.status.id === 5 ? 0 : 6 - o.status.id);
  orders.sort((a, b) => orderRank(a) - orderRank(b) || (a.orderRef ?? "~").localeCompare(b.orderRef ?? "~", "es", { numeric: true }));

  const cnt = (id: number) => products.filter((p) => p.commercial.id === id).length;
  return {
    orders,
    products,
    deliveries: deliveriesAll,
    summary: {
      inProcess: products.filter((p) => p.commercial.id >= 1 && p.commercial.id <= 5).length,
      recibidos: cnt(1),
      programados: cnt(2),
      elaboracion: cnt(3),
      envasado: cnt(4),
      listos: cnt(5),
      entregados: cnt(6),
      pedidos: orders.filter((o) => !o.cancelled).length,
    },
    disclaimer: ESTIMATE_DISCLAIMER,
    ready,
  };
}

/** Clave interna del pedido: su número visible si existe; si no, el propio renglón. Nunca sale del servidor (se la vuelve opaca). */
function orderKeyOf(orderRef: string | null, productKey: string): string {
  return orderRef ? `op:${clientKey(orderRef)}` : productKey;
}

// ───────────────────────── Serialización con LISTA BLANCA ─────────────────────────
// Lo único que viaja al navegador del cliente. Se arma campo por campo: un campo nuevo que alguien agregue a las filas
// operativas (fórmulas, costos, operarios, incidencias, lotes, ids internos) NO sale hasta que se lo incluya acá a propósito.

const pickCommercial = (c: PortalCommercialView): PortalCommercialView => ({ id: c.id, key: c.key, label: String(c.label) });
const pickDelivery = (d: PortalDeliveryView): PortalDeliveryView => ({
  id: d.id,
  product: d.product,
  orderRef: d.orderRef,
  deliveredAt: d.deliveredAt,
  quantity: d.quantity,
  unit: d.unit,
  confirmation: d.confirmation ? { at: d.confirmation.at, by: d.confirmation.by } : null,
  canConfirm: d.canConfirm === true,
});
const pickProduct = (p: PortalProductView): PortalProductView => ({
  id: p.id,
  orderId: p.orderId,
  commercial: pickCommercial(p.commercial),
  product: p.product,
  orderRef: p.orderRef,
  orderedAt: p.orderedAt,
  stage: p.stage,
  stageLabel: p.stageLabel,
  substage: p.substage,
  stageIndex: p.stageIndex,
  message: p.message,
  quantities: { unit: p.quantities.unit, requested: p.quantities.requested, delivered: p.quantities.delivered, pending: p.quantities.pending, available: p.quantities.available, mixedUnits: p.quantities.mixedUnits },
  partialDelivery: p.partialDelivery,
  countdown: p.countdown
    ? { totalDays: p.countdown.totalDays, remainingDays: p.countdown.remainingDays, elapsedDays: p.countdown.elapsedDays, estimatedDate: p.countdown.estimatedDate, overdue: p.countdown.overdue, progressPct: p.countdown.progressPct, startedDate: p.countdown.startedDate }
    : null,
  progressPct: p.progressPct,
  lastDeliveryAt: p.lastDeliveryAt,
  availableSince: p.availableSince,
  timeline: p.timeline.map((t) => ({ stage: t.stage, label: t.label, state: t.state, date: t.date })),
  deliveries: p.deliveries.map(pickDelivery),
});
const pickOrder = (o: PortalOrderView): PortalOrderView => ({
  id: o.id,
  orderRef: o.orderRef,
  status: pickCommercial(o.status),
  cancelled: o.cancelled,
  todoListo: o.todoListo,
  partial: o.partial,
  message: o.message,
  progress: { total: o.progress.total, cancelados: o.progress.cancelados, listos: o.progress.listos, entregados: o.progress.entregados, enProceso: o.progress.enProceso },
  progressText: o.progressText,
  productIds: [...o.productIds],
});

export function toClientPayload(o: PortalOverviewData): Omit<PortalOverviewData, "ready"> {
  const s = o.summary;
  return {
    orders: o.orders.map(pickOrder),
    products: o.products.map(pickProduct),
    deliveries: o.deliveries.map(pickDelivery),
    summary: { inProcess: s.inProcess, recibidos: s.recibidos, programados: s.programados, elaboracion: s.elaboracion, envasado: s.envasado, listos: s.listos, entregados: s.entregados, pedidos: s.pedidos },
    disclaimer: o.disclaimer,
  };
}
