/**
 * Vista del cliente (PURA, sin E/S): convierte filas operativas de GENUS OS en lo que el portal muestra.
 *
 * Seguridad por construcción: este módulo SOLO produce campos de una lista blanca (producto, número de pedido, cantidades,
 * etapa, fechas de hitos, entregas). No existe ningún camino para que salgan fórmulas, materias primas, observaciones,
 * usuarios internos, líneas, lotes ni identificadores internos: los ids que se devuelven son opacos y por cliente.
 */
import { clientKey } from "@/lib/entregas/rules";
import { stageCountdown, type BusinessCalendarOptions, type Countdown } from "./business-days";
import { hmac } from "./security";
import {
  ESTIMATE_DISCLAIMER,
  FINALIZATION_MESSAGE,
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
};
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
  product: string;
  orderRef: string | null;
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
  timeline: PortalTimelineStep[];
  deliveries: PortalDeliveryView[];
};

export type PortalSummary = { inProcess: number; elaboracion: number; envasado: number; listos: number; entregados: number };

export type PortalOverviewData = {
  products: PortalProductView[];
  deliveries: PortalDeliveryView[];
  summary: PortalSummary;
  disclaimer: string;
  /** Trabajos con producto disponible (insumo del aviso «listo»). No se envía al navegador. */
  ready: Array<{ productId: string; product: string; workItemId: string; available: number | null; unit: string | null; readySince: string | null }>;
};

const opaque = (clientId: string, label: string, value: string) => hmac(label, `${clientId}:${value}`).slice(0, 24);

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

function messageFor(stage: PortalStageId, substage: PortalSubstage, partial: boolean, available: number): string {
  if (stage === "ELABORACION" && substage === "TERMINADA_EN_TRASPASO") return "Finalizó la elaboración de tu producto. Estamos preparando el paso a envasado.";
  if (stage === "ENVASADO" && substage === "FINALIZACION") return FINALIZATION_MESSAGE;
  if (stage === "ENVASADO" && partial && available > 0) return "Una parte de tu pedido ya está lista para entregar; el resto sigue en proceso.";
  return STAGE_MESSAGES[stage];
}

export function buildOverview(input: {
  clientId: string;
  works: RawWorkRow[];
  deliveries: RawDeliveryRow[];
  events: RawEventRow[];
  confirmations: ReadonlyMap<string, ConfirmationInfo>;
  now: Date;
  calendar?: BusinessCalendarOptions;
  readyStableMinutes?: number;
}): PortalOverviewData {
  const { clientId, now } = input;
  const eventsByWork = new Map<string, RawEventRow[]>();
  for (const e of input.events) eventsByWork.set(e.workItemId, [...(eventsByWork.get(e.workItemId) ?? []), e]);
  const delByWork = new Map<string, RawDeliveryRow[]>();
  for (const d of input.deliveries) delByWork.set(d.workItemId, [...(delByWork.get(d.workItemId) ?? []), d]);
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
    };
    // Cada fila de pedido-producto es UN producto del cliente; sin pedido (trabajos manuales) se agrupa por nombre.
    const key = w.productionPedidoId ? `p:${w.productionPedidoId}` : `n:${clientKey(w.product)}`;
    const g = groups.get(key) ?? { key, rows: [], facts: [] };
    g.rows.push(w);
    g.facts.push(fact);
    groups.set(key, g);
  }

  const products: PortalProductView[] = [];
  const deliveriesAll: PortalDeliveryView[] = [];
  const ready: PortalOverviewData["ready"] = [];

  for (const g of groups.values()) {
    const stage = deriveProductStage(g.facts, { now, readyStableMinutes: input.readyStableMinutes });
    if (!stage) continue;
    const down = g.rows.filter((r) => r.sector !== "ELABORACION");
    const label = g.rows.find((r) => r.pedidoProducto)?.pedidoProducto ?? (down[0] ?? g.rows[0]!).product;
    const orderRef = g.rows.find((r) => r.pedidoOp)?.pedidoOp?.trim() || null;
    const id = opaque(clientId, "product", g.key);

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

    for (const r of stage.readyWorks) ready.push({ productId: id, product: label, workItemId: r.workItemId, available: r.available, unit: stage.quantities.unit, readySince: r.readySince });

    products.push({
      id,
      product: label,
      orderRef,
      stage: stage.stage,
      stageLabel: STAGE_LABELS[stage.stage],
      substage: stage.substage,
      stageIndex: stageIndex(stage.stage),
      message: messageFor(stage.stage, stage.substage, stage.partialDelivery, stage.quantities.available),
      quantities: stage.quantities,
      partialDelivery: stage.partialDelivery,
      countdown,
      progressPct: visualProgress(stage.stage, stage.substage, countdown),
      lastDeliveryAt: stage.lastDeliveryAt,
      timeline: timelineOf(stage.stage, stage.milestones),
      deliveries: dels,
    });
  }

  const order: Record<PortalStageId, number> = { LISTO: 0, ENVASADO: 1, ELABORACION: 2, ENTREGADO: 3 };
  products.sort((a, b) => order[a.stage] - order[b.stage] || a.product.localeCompare(b.product, "es", { sensitivity: "base" }));
  deliveriesAll.sort((a, b) => (a.deliveredAt < b.deliveredAt ? 1 : -1));

  const count = (s: PortalStageId) => products.filter((p) => p.stage === s).length;
  return {
    products,
    deliveries: deliveriesAll,
    summary: {
      inProcess: products.filter((p) => p.stage !== "ENTREGADO").length,
      elaboracion: count("ELABORACION"),
      envasado: count("ENVASADO"),
      listos: count("LISTO"),
      entregados: count("ENTREGADO"),
    },
    disclaimer: ESTIMATE_DISCLAIMER,
    ready,
  };
}

/** Lo único que viaja al navegador: sin el insumo interno de avisos (`ready`, que lleva ids de trabajos). */
export function toClientPayload(o: PortalOverviewData): Omit<PortalOverviewData, "ready"> {
  const { ready: _ready, ...rest } = o;
  void _ready;
  return rest;
}
