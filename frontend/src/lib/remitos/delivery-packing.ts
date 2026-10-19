/**
 * Cajas de UNA entrega real. Cada grupo es «N cajas de M unidades»; puede haber varios grupos con cantidades distintas
 * (nunca se asume que todas las cajas son iguales). El total calculado debe coincidir con las unidades entregadas.
 */
export type DeliveryPackingGroup = { cajas: number; unidadesPorCaja: number };

export type DeliveryPackingResult =
  | { ok: true; groups: DeliveryPackingGroup[]; cajas: number; unidades: number }
  | { ok: false; error: string };

export function validateDeliveryPacking(raw: unknown, deliveredUnits: number | null): DeliveryPackingResult {
  if (raw == null) return { ok: true, groups: [], cajas: 0, unidades: 0 };
  if (!Array.isArray(raw)) return { ok: false, error: "El detalle de cajas no es válido." };
  const groups: DeliveryPackingGroup[] = [];
  for (const g of raw as Array<{ cajas?: unknown; unidadesPorCaja?: unknown }>) {
    const cajas = Number(g?.cajas ?? 0);
    const upc = Number(g?.unidadesPorCaja ?? 0);
    if (cajas === 0 && upc === 0) continue; // fila vacía del editor
    if (!Number.isInteger(cajas) || !Number.isInteger(upc) || cajas <= 0 || upc <= 0) {
      return { ok: false, error: "Cada grupo de cajas necesita una cantidad de cajas y de unidades por caja (enteros mayores a 0)." };
    }
    groups.push({ cajas, unidadesPorCaja: upc });
  }
  const cajas = groups.reduce((s, g) => s + g.cajas, 0);
  const unidades = groups.reduce((s, g) => s + g.cajas * g.unidadesPorCaja, 0);
  if (groups.length > 0 && deliveredUnits != null && unidades !== deliveredUnits) {
    return { ok: false, error: `Las cajas suman ${unidades} u. pero la entrega es de ${deliveredUnits} u. Corregí las cajas o la cantidad.` };
  }
  return { ok: true, groups, cajas, unidades };
}

/** «12 cajas de 100 u. + 1 caja de 50 u. = 13 cajas / 1.250 u.» */
export function describeDeliveryPacking(groups: DeliveryPackingGroup[]): string | null {
  const valid = groups.filter((g) => g.cajas > 0 && g.unidadesPorCaja > 0);
  if (valid.length === 0) return null;
  const fmt = (n: number) => new Intl.NumberFormat("es-AR").format(n);
  const cajas = valid.reduce((s, g) => s + g.cajas, 0);
  const units = valid.reduce((s, g) => s + g.cajas * g.unidadesPorCaja, 0);
  return `${valid.map((g) => `${fmt(g.cajas)} ${g.cajas === 1 ? "caja" : "cajas"} de ${fmt(g.unidadesPorCaja)} u.`).join(" + ")} = ${fmt(cajas)} ${cajas === 1 ? "caja" : "cajas"} / ${fmt(units)} u.`;
}
