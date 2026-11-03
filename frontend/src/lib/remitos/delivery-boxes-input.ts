/**
 * Carga de una entrega con cajas — reglas PURAS (sin I/O), compartidas por el formulario, el servidor y los tests.
 *
 * Dos maneras de trabajar (ambas válidas):
 *  A) Cargar cajas: «8 cajas × 100» → el total se calcula solo (y puede haber cajas incompletas: 8 × 100 + 1 × 50 = 850).
 *  B) Cargar unidades: el total manda y el desglose de cajas es opcional; si se informa, DEBE sumar exactamente el total.
 * Nunca se inventan cantidades por caja ni se redondea: si no cierran, se avisa con los números exactos.
 */
import { validateDeliveryPacking, type DeliveryPackingGroup } from "./delivery-packing";

export type BoxesEntryResult =
  | { ok: true; quantity: number | null; groups: DeliveryPackingGroup[]; cajas: number; derivedQuantity: boolean }
  | { ok: false; error: string };

const fmt = (n: number) => new Intl.NumberFormat("es-AR").format(n);

export function resolveBoxesEntry(input: { quantity: number | null | undefined; groups: unknown }): BoxesEntryResult {
  const checked = validateDeliveryPacking(input.groups ?? null, null);
  if (!checked.ok) return checked;
  const qty = input.quantity != null && Number.isFinite(Number(input.quantity)) && Number(input.quantity) > 0 ? Number(input.quantity) : null;
  if (checked.groups.length === 0) return { ok: true, quantity: qty, groups: [], cajas: 0, derivedQuantity: false };
  if (qty == null) return { ok: true, quantity: checked.unidades, groups: checked.groups, cajas: checked.cajas, derivedQuantity: true };
  if (qty !== checked.unidades) {
    return { ok: false, error: `Las cajas suman ${fmt(checked.unidades)} u. pero la cantidad total es ${fmt(qty)} u. Corregí las cajas o la cantidad.` };
  }
  return { ok: true, quantity: qty, groups: checked.groups, cajas: checked.cajas, derivedQuantity: false };
}

/** Suma de cajas de varias entregas conservando cada tipo de caja («8 × 100» + «8 × 100» + «4 × 100 y 1 × 50» → 20 × 100 + 1 × 50). */
export function mergePackingGroups(lists: Array<ReadonlyArray<DeliveryPackingGroup> | null | undefined>): DeliveryPackingGroup[] {
  const byUnits = new Map<number, number>();
  for (const list of lists) for (const g of list ?? []) if (g.cajas > 0 && g.unidadesPorCaja > 0) byUnits.set(g.unidadesPorCaja, (byUnits.get(g.unidadesPorCaja) ?? 0) + g.cajas);
  return [...byUnits.entries()].map(([unidadesPorCaja, cajas]) => ({ cajas, unidadesPorCaja })).sort((a, b) => b.unidadesPorCaja - a.unidadesPorCaja);
}

export function packingTotals(groups: ReadonlyArray<DeliveryPackingGroup> | null | undefined): { cajas: number; unidades: number } {
  const g = (groups ?? []).filter((x) => x.cajas > 0 && x.unidadesPorCaja > 0);
  return { cajas: g.reduce((s, x) => s + x.cajas, 0), unidades: g.reduce((s, x) => s + x.cajas * x.unidadesPorCaja, 0) };
}

export function samePacking(a: ReadonlyArray<DeliveryPackingGroup> | null | undefined, b: ReadonlyArray<DeliveryPackingGroup> | null | undefined): boolean {
  const key = (l: ReadonlyArray<DeliveryPackingGroup> | null | undefined) => mergePackingGroups([l]).map((g) => `${g.cajas}x${g.unidadesPorCaja}`).join("|");
  return key(a) === key(b);
}
