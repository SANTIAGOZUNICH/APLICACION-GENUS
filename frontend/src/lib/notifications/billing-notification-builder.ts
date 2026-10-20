import { uuidFromKey, formatCircuitDateTime } from "@/lib/planning/circuit/movements";

export const BILLING_NOTIFICATION_SECTORS = ["ADMINISTRACION"] as const;

export type PackingGroupLite = { cajas: number; unidadesPorCaja: number };

type Base = {
  /** Clave del evento real (id de la marca / de la línea de entrega): entra al id determinístico. */
  eventKey: string;
  workItemId: string;
  client: string | null;
  product: string | null;
  /** Pedido (OP) al que pertenece el trabajo. */
  pedido: string | null;
  /** OE / OA relacionada. */
  orderRef: string | null;
  quantity: number | null;
  unit: string | null;
  at: Date;
  actorName: string;
};

/** Totales del pedido al momento del evento: pedido ≠ producido ≠ entregado ≠ facturado. */
export type BillingTotals = {
  /** Total pedido (null = sin dato numérico). */
  requested: number | null;
  /** Entregado acumulado, incluida esta entrega. */
  delivered: number | null;
  /** Saldo que falta entregar. */
  pending: number | null;
};

export type RemitoLineLite = { product: string; quantity: number; unit: string | null; orderRef?: string | null };

export type BillingEvent =
  | ({ type: "LISTO_PARA_ENTREGAR" } & Base)
  | ({
      type: "ENTREGA_REGISTRADA";
      remito: string | null;
      packingGroups: PackingGroupLite[];
      complete: boolean | null;
      deliveredAt: Date | null;
      totals?: BillingTotals;
    } & Base)
  | ({
      type: "ENTREGA_COMPLETA";
      remito: string | null;
      packingGroups: PackingGroupLite[];
      deliveredAt: Date | null;
      totals?: BillingTotals;
    } & Base)
  | ({ type: "REMITO_GENERADO" } & RemitoBase)
  | ({ type: "REMITO_ANULADO" } & RemitoBase);

type RemitoBase = {
      /** Id del remito: entra al id determinístico junto con el número. */
      remitoId: string;
      remitoNumber: string;
      client: string | null;
      lines: RemitoLineLite[];
      totalUnits: number;
      totalCajas: number | null;
      at: Date;
      actorName: string;
      /** Solo REMITO_ANULADO: motivo y unidades que habían quedado pendientes de facturar por ese remito. */
      reason?: string | null;
      pendingInvoiceUnits?: number | null;
};

export type BillingDraft = { id: string; kind: string; title: string; message: string; sectors: string[]; href: string };

const fmt = (n: number) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(n);

/** «12 cajas de 100 u. + 1 caja de 50 u. = 13 cajas / 1.250 u.» — sin asumir que todas las cajas son iguales. */
export function describePacking(groups: PackingGroupLite[]): string | null {
  const valid = groups.filter((g) => g.cajas > 0 && g.unidadesPorCaja > 0);
  if (valid.length === 0) return null;
  const cajas = valid.reduce((s, g) => s + g.cajas, 0);
  const units = valid.reduce((s, g) => s + g.cajas * g.unidadesPorCaja, 0);
  const parts = valid.map((g) => `${fmt(g.cajas)} ${g.cajas === 1 ? "caja" : "cajas"} de ${fmt(g.unidadesPorCaja)} u.`);
  return `${parts.join(" + ")} = ${fmt(cajas)} ${cajas === 1 ? "caja" : "cajas"} / ${fmt(units)} u.`;
}

function totalsLines(t: BillingTotals | undefined, unit: string | null): string[] {
  if (!t) return [];
  const u = unit ? ` ${unit}` : "";
  const f = (n: number | null) => (n == null ? "—" : `${fmt(n)}${u}`);
  return [
    `Total pedido: ${f(t.requested)}`,
    `Entregado acumulado: ${f(t.delivered)}`,
    `Pendiente de entregar: ${f(t.pending)}`,
    `Facturación: se controla en «Control de facturación» (entregar no es facturar)`,
  ];
}

function buildRemitoNotification(e: Extract<BillingEvent, { type: "REMITO_GENERADO" | "REMITO_ANULADO" }>): BillingDraft {
  const generated = e.type === "REMITO_GENERADO";
  const products = e.lines.map((l) => `${l.product} (${fmt(l.quantity)}${l.unit ? ` ${l.unit}` : ""}${l.orderRef ? ` · ${l.orderRef}` : ""})`);
  const lines = [
    `Cliente: ${e.client ?? "—"}`,
    `Remito: ${e.remitoNumber}`,
    `Productos: ${products.length ? products.join("; ") : "—"}`,
    `Unidades del remito: ${fmt(e.totalUnits)}`,
  ];
  if (e.totalCajas != null && e.totalCajas > 0) lines.push(`Cajas: ${fmt(e.totalCajas)}`);
  lines.push(`Fecha y hora: ${formatCircuitDateTime(e.at)}`);
  lines.push(`Usuario: ${e.actorName}`);
  if (generated) {
    lines.push("Estado: REMITO GENERADO (las entregas de este remito ya pueden controlarse para facturar)");
  } else {
    lines.push(`Motivo de anulación: ${e.reason?.trim() || "sin motivo informado"}`);
    if (e.pendingInvoiceUnits != null) lines.push(`Entregas pendientes de facturar afectadas: ${fmt(e.pendingInvoiceUnits)} u. (revisá el Control de facturación)`);
    lines.push("Estado: REMITO ANULADO — las entregas vuelven a quedar sin remito; NO se anularon las entregas");
  }
  return {
    id: uuidFromKey(`facturacion:${generated ? "remito" : "remito-anulado"}:${e.remitoId}:${e.remitoNumber}`),
    kind: generated ? "remito_generado" : "remito_anulado",
    title: `${generated ? "REMITO GENERADO" : "REMITO ANULADO"} ${e.remitoNumber} — ${e.client ?? "Cliente"}`,
    message: lines.join("\n"),
    sectors: [...BILLING_NOTIFICATION_SECTORS],
    href: generated ? "/facturacion" : "/facturacion?estado=PENDIENTE_DE_FACTURAR",
  };
}

export function buildBillingNotification(e: BillingEvent): BillingDraft {
  if (e.type === "REMITO_GENERADO" || e.type === "REMITO_ANULADO") return buildRemitoNotification(e);
  const qty = e.quantity != null ? `${fmt(e.quantity)}${e.unit ? ` ${e.unit}` : ""}` : "—";
  const lines = [
    `Cliente: ${e.client ?? "—"}`,
    `Pedido: ${e.pedido ?? "—"}`,
    `Producto: ${e.product ?? "—"}`,
    `OE/OA: ${e.orderRef ?? "—"}`,
  ];
  if (e.type === "LISTO_PARA_ENTREGAR") {
    lines.push(`Cantidad terminada y disponible para entregar: ${qty}`);
    lines.push(`Fecha y hora: ${formatCircuitDateTime(e.at)}`);
    lines.push(`Estado: LISTO PARA ENTREGAR (todavía NO se entregó: no facturar como entrega realizada)`);
    return {
      id: uuidFromKey(`facturacion:listo:${e.workItemId}:${e.eventKey}`),
      kind: "listo_para_entregar",
      title: `Listo para entregar — ${e.client ?? "Cliente"} · ${e.product ?? "Producto"}`,
      message: lines.join("\n"),
      sectors: [...BILLING_NOTIFICATION_SECTORS],
      href: `/facturacion?workItemId=${encodeURIComponent(e.workItemId)}`,
    };
  }
  if (e.type === "ENTREGA_COMPLETA") {
    lines.push(`Cantidad de la última entrega: ${qty}`);
    lines.push(...totalsLines(e.totals, e.unit));
    lines.push(`Cajas y unidades: ${describePacking(e.packingGroups) ?? "sin detalle de cajas"}`);
    lines.push(`Fecha efectiva de entrega: ${formatCircuitDateTime(e.deliveredAt ?? e.at)}`);
    lines.push(`Registró: ${e.actorName}`);
    lines.push(`Remito: ${e.remito?.trim() || "sin remito asociado"}`);
    lines.push("Estado: ENTREGA COMPLETA del pedido");
    return {
      id: uuidFromKey(`facturacion:completa:${e.workItemId}:${e.eventKey}`),
      kind: "entrega_completa",
      title: `PEDIDO ENTREGADO COMPLETO · ${e.client ?? "Cliente"} · ${e.product ?? "Producto"}`,
      message: lines.join("\n"),
      sectors: [...BILLING_NOTIFICATION_SECTORS],
      href: `/facturacion?workItemId=${encodeURIComponent(e.workItemId)}`,
    };
  }
  lines.push(`Cantidad real entregada en este movimiento: ${qty}${e.complete === false ? " (entrega parcial)" : ""}`);
  lines.push(...totalsLines(e.totals, e.unit));
  const packing = describePacking(e.packingGroups);
  lines.push(`Cajas y unidades: ${packing ?? "sin detalle de cajas"}`);
  lines.push(`Fecha efectiva de entrega: ${formatCircuitDateTime(e.deliveredAt ?? e.at)}`);
  lines.push(`Registró: ${e.actorName}`);
  lines.push(`Remito: ${e.remito?.trim() || "sin remito asociado"}`);
  return {
    id: uuidFromKey(`facturacion:entrega:${e.workItemId}:${e.eventKey}`),
    kind: "entrega_registrada",
    title: `${e.complete === false ? "ENTREGA PARCIAL REGISTRADA" : "ENTREGA REGISTRADA"} — YA SE PUEDE FACTURAR · ${e.client ?? "Cliente"}`,
    message: lines.join("\n"),
    sectors: [...BILLING_NOTIFICATION_SECTORS],
    href: `/facturacion?workItemId=${encodeURIComponent(e.workItemId)}`,
  };
}
