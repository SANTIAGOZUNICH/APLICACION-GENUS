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

export type BillingEvent =
  | ({ type: "LISTO_PARA_ENTREGAR" } & Base)
  | ({ type: "ENTREGA_REGISTRADA"; remito: string | null; packingGroups: PackingGroupLite[]; complete: boolean | null; deliveredAt: Date | null } & Base);

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

export function buildBillingNotification(e: BillingEvent): BillingDraft {
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
      href: `/entregas?workItemId=${encodeURIComponent(e.workItemId)}`,
    };
  }
  lines.push(`Cantidad real entregada: ${qty}${e.complete === false ? " (entrega parcial)" : ""}`);
  const packing = describePacking(e.packingGroups);
  lines.push(`Cajas y unidades: ${packing ?? "sin detalle de cajas"}`);
  lines.push(`Fecha efectiva de entrega: ${formatCircuitDateTime(e.deliveredAt ?? e.at)}`);
  lines.push(`Registró: ${e.actorName}`);
  lines.push(`Remito: ${e.remito?.trim() || "sin remito asociado"}`);
  return {
    id: uuidFromKey(`facturacion:entrega:${e.workItemId}:${e.eventKey}`),
    kind: "entrega_registrada",
    title: `ENTREGA REGISTRADA — YA SE PUEDE FACTURAR · ${e.client ?? "Cliente"}`,
    message: lines.join("\n"),
    sectors: [...BILLING_NOTIFICATION_SECTORS],
    href: `/entregados?workItemId=${encodeURIComponent(e.workItemId)}`,
  };
}
