/**
 * Filtro por sector de las entregas: TODAS | ENVASADO | ELABORACIÓN.
 * ENVASADO agrupa Envasado Masivo + Premium. Se decide SIEMPRE por el sector persistente del trabajo (source_sector de la entrega /
 * sector del work item), nunca por nombres de producto. Una entrega tiene un único sector: no se duplica en ningún filtro.
 */
export type DeliverySectorFilter = "TODAS" | "ENVASADO" | "ELABORACION";

export const DELIVERY_SECTOR_FILTERS: Array<{ id: DeliverySectorFilter; label: string }> = [
  { id: "TODAS", label: "Todas" },
  { id: "ENVASADO", label: "Envasado" },
  { id: "ELABORACION", label: "Elaboración" },
];

const ENVASADO_SECTORS = new Set(["ENVASADO_MASIVO", "ENVASADO_PREMIUM"]);

export function matchesDeliverySector(filter: DeliverySectorFilter, sector: string | null | undefined): boolean {
  if (filter === "TODAS") return true;
  if (filter === "ENVASADO") return ENVASADO_SECTORS.has(String(sector ?? ""));
  return String(sector ?? "") === "ELABORACION";
}

type WithItems<I> = { items: I[] };

/**
 * Aplica el filtro a las entregas programadas del calendario: se decide por el sector PERSISTENTE de cada producto
 * (scheduled_delivery_items.sector, o el del trabajo en las «desde trabajo»). Una entrega solo queda si conserva algún producto del
 * filtro; los productos no coincidentes se ocultan en esa vista. No muta ni duplica nada. TODAS devuelve el mismo arreglo.
 */
export function filterDeliveriesBySector<I extends { sector: string | null }, D extends WithItems<I>>(deliveries: readonly D[], filter: DeliverySectorFilter): D[] {
  if (filter === "TODAS") return deliveries as D[];
  const out: D[] = [];
  for (const d of deliveries) {
    const items = d.items.filter((i) => matchesDeliverySector(filter, i.sector));
    if (items.length) out.push({ ...d, items });
  }
  return out;
}
