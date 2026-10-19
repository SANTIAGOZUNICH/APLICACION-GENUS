import { normalizeClientId } from "./grouping";
import type { PackingGroup } from "./packing-math";

export type EligibleDelivery = {
  deliveryLineId: string;
  workItemId: string;
  client: string;
  pedido: string | null;
  orderRef: string | null;
  product: string;
  lote: string;
  vto: string;
  quantity: number;
  unit: string | null;
  kind: "PARCIAL" | "FINAL";
  deliveredAt: string;
  /** Fecha de entrega (día calendario, hora de Argentina). */
  deliveryDate: string;
  packingGroups: PackingGroup[];
  boxesText: string | null;
  deliveredBy: string;
  deliveryRemito: string | null;
};

export type RemitoPreviewGroup = {
  client: string;
  deliveryDate: string;
  pedidos: string[];
  lines: EligibleDelivery[];
  totalUnits: number;
  totalCajas: number;
  withoutBoxes: number;
};

/** Agrupa por cliente + fecha de entrega. Nunca mezcla clientes ni fechas; conserva pedido y renglón de cada entrega. */
export function groupDeliveries(lines: EligibleDelivery[]): RemitoPreviewGroup[] {
  const map = new Map<string, RemitoPreviewGroup>();
  for (const l of lines) {
    const key = `${normalizeClientId(l.client)}|${l.deliveryDate}`;
    const g = map.get(key) ?? { client: l.client, deliveryDate: l.deliveryDate, pedidos: [], lines: [], totalUnits: 0, totalCajas: 0, withoutBoxes: 0 };
    g.lines.push(l);
    if (l.pedido && !g.pedidos.includes(l.pedido)) g.pedidos.push(l.pedido);
    g.totalUnits += l.quantity;
    g.totalCajas += l.packingGroups.reduce((s, x) => s + x.cajas, 0);
    if (l.packingGroups.length === 0) g.withoutBoxes += 1;
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) => a.client.localeCompare(b.client) || a.deliveryDate.localeCompare(b.deliveryDate));
}

