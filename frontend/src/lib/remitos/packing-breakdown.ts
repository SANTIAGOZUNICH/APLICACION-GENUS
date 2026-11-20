/**
 * Desglose de cajas de UNA entrega o producto, para mostrarlo siempre igual (Pendientes a definir, Entregados, remitos).
 * Nunca promedia ni inventa: solo suma lo que está registrado. Sin datos → null (la pantalla dice «Sin detalle de cajas registrado»).
 */
export type PackingGroupLike = { cajas: number; unidadesPorCaja: number };

export type PackingBreakdown = {
  totalUnits: number;
  totalCajas: number;
  /** Una fila por configuración distinta («10 cajas × 5 u. = 50 u.»). */
  items: Array<{ cajas: number; unidadesPorCaja: number; units: number }>;
  /** «10 × 5 + 1 × 3». */
  short: string;
};

export const NO_PACKING_TEXT = "Sin detalle de cajas registrado";

export function packingBreakdown(groups: PackingGroupLike[] | null | undefined): PackingBreakdown | null {
  const valid = (groups ?? []).filter((g) => Number.isFinite(g.cajas) && Number.isFinite(g.unidadesPorCaja) && g.cajas > 0 && g.unidadesPorCaja > 0);
  if (valid.length === 0) return null;
  // Se agrupan SOLO configuraciones idénticas de la misma entrega (3 cajas × 5 + 2 cajas × 5 = 5 cajas × 5).
  const byUpc = new Map<number, number>();
  for (const g of valid) byUpc.set(g.unidadesPorCaja, (byUpc.get(g.unidadesPorCaja) ?? 0) + g.cajas);
  const items = [...byUpc.entries()]
    .map(([unidadesPorCaja, cajas]) => ({ cajas, unidadesPorCaja, units: cajas * unidadesPorCaja }))
    .sort((a, b) => b.unidadesPorCaja - a.unidadesPorCaja);
  return {
    totalUnits: items.reduce((s, i) => s + i.units, 0),
    totalCajas: items.reduce((s, i) => s + i.cajas, 0),
    items,
    short: items.map((i) => `${i.cajas} × ${i.unidadesPorCaja}`).join(" + "),
  };
}

const fmt = (n: number) => new Intl.NumberFormat("es-AR").format(n);
export const unitsAndCajasText = (b: PackingBreakdown) => `${fmt(b.totalUnits)} unidad${b.totalUnits === 1 ? "" : "es"} — ${fmt(b.totalCajas)} caja${b.totalCajas === 1 ? "" : "s"}`;
export const itemText = (i: PackingBreakdown["items"][number]) => `${fmt(i.cajas)} caja${i.cajas === 1 ? "" : "s"} × ${fmt(i.unidadesPorCaja)} unidad${i.unidadesPorCaja === 1 ? "" : "es"} = ${fmt(i.units)} unidades`;

export type DeliveryLineLike = {
  id: string;
  deliveryId: string;
  sequence: number;
  status: string;
  quantity: number;
  packingGroups?: PackingGroupLike[] | null;
  actualDeliveredAt?: string | null;
  observations?: string | null;
  deliveredBy?: string | null;
};

export type DeliveryPackingEntry = { key: string; label: string | null; breakdown: PackingBreakdown | null };

/**
 * Cajas de UNA entrega (registro de Entregados): una entrada por renglón activo de ESA entrega (parciales incluidas),
 * sin mezclar con otras entregas. Si el registro no tiene renglones (histórico), cae al desglose guardado en el registro.
 * `breakdown: null` = «Sin detalle de cajas registrado».
 */
export function deliveryPackingEntries(
  record: { id: string; packingGroups?: PackingGroupLike[] | null },
  lines: DeliveryLineLike[]
): DeliveryPackingEntry[] {
  const mine = lines.filter((l) => l.deliveryId === record.id && l.status !== "ANULADA").sort((a, b) => a.sequence - b.sequence);
  if (mine.length > 0) {
    return mine.map((l) => ({ key: l.id, label: mine.length > 1 ? `Entrega #${l.sequence}` : null, breakdown: packingBreakdown(l.packingGroups) }));
  }
  return [{ key: record.id, label: null, breakdown: packingBreakdown(record.packingGroups) }];
}

/** Una fila de la planilla de Entregados: una ENTREGA (parcial o final) con su propio embalaje. */
export type DeliveryRowEntry<R> = {
  record: R;
  /** null = registro sin renglones (histórico) o con una sola entrega: se muestra como siempre. */
  line: DeliveryLineLike | null;
  index: number;
  count: number;
  /** Totales de TODAS las entregas vigentes del trabajo (solo se informan en la primera fila). */
  totalUnits: number;
  totalCajas: number;
  withoutBoxes: number;
  key: string;
};

/**
 * Producción necesita ver CADA entrega parcial por separado (con su fecha, cajas y observaciones), no solo el acumulado del trabajo:
 * un registro con 2 o más renglones vigentes se abre en una fila por entrega. Un registro con una sola entrega o sin renglones
 * (histórico) queda en una sola fila. Solo presentación: no modifica ni mezcla datos.
 */
export function expandDeliveryRows<R extends { id: string; packingGroups?: PackingGroupLike[] | null }>(records: R[], lines: DeliveryLineLike[]): DeliveryRowEntry<R>[] {
  const out: DeliveryRowEntry<R>[] = [];
  for (const record of records) {
    const mine = lines.filter((l) => l.deliveryId === record.id && l.status !== "ANULADA").sort((a, b) => a.sequence - b.sequence);
    if (mine.length < 2) {
      out.push({ record, line: mine[0] ?? null, index: 0, count: Math.max(mine.length, 1), totalUnits: mine[0]?.quantity ?? 0, totalCajas: packingBreakdown(mine[0]?.packingGroups ?? record.packingGroups)?.totalCajas ?? 0, withoutBoxes: 0, key: record.id });
      continue;
    }
    const totalUnits = mine.reduce((s, l) => s + (Number(l.quantity) || 0), 0);
    const totalCajas = mine.reduce((s, l) => s + (packingBreakdown(l.packingGroups)?.totalCajas ?? 0), 0);
    const withoutBoxes = mine.filter((l) => !packingBreakdown(l.packingGroups)).length;
    mine.forEach((line, index) => out.push({ record, line, index, count: mine.length, totalUnits, totalCajas, withoutBoxes, key: `${record.id}:${line.id}` }));
  }
  return out;
}
