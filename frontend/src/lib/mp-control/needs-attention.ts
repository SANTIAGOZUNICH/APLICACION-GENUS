/**
 * «Materias primas a resolver» — reglas PURAS (sin I/O). Parte de lo ya calculado por `computeAvailability` (stock
 * compartido, equivalencias, consumos) y de la vista por producto (`buildProductBreakdown`): no recalcula stock.
 *
 * Solo entran las MP que necesitan atención:
 *   SIN_STOCK     necesidad > 0 y nada utilizable (rojo)
 *   INSUFICIENTE  hay algo de stock pero no alcanza (amarillo)
 *   SIN_DATOS     MP no identificada / datos incompletos: NO se mezcla con «stock cero» (gris)
 * Las suficientes y las que una persona quitó del control no aparecen.
 *
 * Stock compartido: el faltante TOTAL sale de la fila consolidada (un solo stock para todos los productos); el detalle por
 * producto usa lo que se le asignó a cada uno (orden de elaboración), así la suma no duplica kilos.
 */
import type { AvailabilityRow } from "./availability";
import type { ProductSection } from "./product-breakdown";

export type AttentionStatus = "SIN_STOCK" | "INSUFICIENTE" | "SIN_DATOS";
export const ATTENTION_LABEL: Record<AttentionStatus, string> = { SIN_STOCK: "SIN STOCK", INSUFICIENTE: "STOCK INSUFICIENTE", SIN_DATOS: "SIN DATOS" };

export type AttentionProduct = {
  client: string;
  product: string;
  /** OE vinculadas (puede haber más de una). */
  oes: string[];
  /** Cantidad a elaborar en la semana (kg) de este producto. */
  weekKg: number | null;
  /** Necesidad de MP de este producto; null = sin cantidad confiable. */
  necesidadKg: number | null;
  /** Kg que le tocan a este producto del stock compartido. */
  disponibleKg: number;
  /** Lo que le falta a ESTE producto (0 = cubierto con su parte). null = sin datos. */
  faltanteKg: number | null;
  afectado: boolean;
};

export type AttentionItem = {
  rowKey: string;
  materiaPrima: string;
  codigo: string;
  status: AttentionStatus;
  stockUtilizable: number;
  necesidadTotal: number;
  /** Faltante TOTAL de la MP (stock compartido, sin duplicar); null en SIN_DATOS. */
  faltanteTotal: number | null;
  compartida: boolean;
  productos: AttentionProduct[];
  observacion: string;
  gestion: string;
};

export type AttentionSummary = { sinStock: number; insuficientes: number; sinDatos: number; total: number };
export type AttentionResult = { items: AttentionItem[]; summary: AttentionSummary };

type RowLike = AvailabilityRow & { state?: { excluded?: boolean; observacion?: string; gestion?: string } };

const STATUS_OF: Partial<Record<AvailabilityRow["estado"], AttentionStatus>> = {
  "SIN STOCK": "SIN_STOCK",
  "SIN STOCK UTILIZABLE": "SIN_STOCK",
  FALTANTE: "INSUFICIENTE",
  "MP NO IDENTIFICADA": "SIN_DATOS",
  "DATOS INCOMPLETOS": "SIN_DATOS",
};
const ORDER: Record<AttentionStatus, number> = { SIN_STOCK: 0, INSUFICIENTE: 1, SIN_DATOS: 2 };
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function buildNeedsAttention(rows: RowLike[], sections: ProductSection[]): AttentionResult {
  const items: AttentionItem[] = [];
  for (const row of rows) {
    const status = STATUS_OF[row.estado];
    if (!status || row.state?.excluded) continue;
    const productos: AttentionProduct[] = [];
    for (const s of sections) {
      for (const l of s.lines) {
        if (l.rowKey !== row.key || l.excluded) continue;
        const need = l.needKg;
        productos.push({
          client: s.client,
          product: s.product,
          oes: s.oes.map((o) => o.oeNumber).filter((x): x is string => Boolean(x)),
          weekKg: s.totalKg,
          necesidadKg: need,
          disponibleKg: r3(l.availableForThis),
          faltanteKg: need == null || status === "SIN_DATOS" ? null : r3(Math.max(0, need - l.availableForThis)),
          afectado: need == null || status === "SIN_DATOS" || need - l.availableForThis > 0.0005,
        });
      }
    }
    items.push({
      rowKey: row.key,
      materiaPrima: row.materiaPrima,
      codigo: row.codigoMaestro,
      status,
      stockUtilizable: r3(row.stockUtilizable),
      necesidadTotal: r3(row.requerido),
      faltanteTotal: status === "SIN_DATOS" ? null : r3(Math.max(0, row.faltante)),
      compartida: productos.length > 1,
      productos: productos.sort((a, b) => Number(b.afectado) - Number(a.afectado) || a.client.localeCompare(b.client) || a.product.localeCompare(b.product)),
      observacion: row.state?.observacion ?? "",
      gestion: row.state?.gestion ?? "",
    });
  }
  items.sort((a, b) => ORDER[a.status] - ORDER[b.status] || (b.faltanteTotal ?? 0) - (a.faltanteTotal ?? 0) || a.materiaPrima.localeCompare(b.materiaPrima));
  const count = (s: AttentionStatus) => items.filter((i) => i.status === s).length;
  return { items, summary: { sinStock: count("SIN_STOCK"), insuficientes: count("INSUFICIENTE"), sinDatos: count("SIN_DATOS"), total: items.length } };
}

export type AttentionFilter = "TODAS" | AttentionStatus;
export const filterAttention = (items: AttentionItem[], f: AttentionFilter) => (f === "TODAS" ? items : items.filter((i) => i.status === f));

/** Compara lo guardado con lo actual por MP: «cambió el stock desde el guardado». */
export function attentionDiff(saved: AttentionItem[], current: AttentionItem[]): { changed: string[]; resolved: string[]; added: string[] } {
  const cur = new Map(current.map((i) => [i.rowKey, i]));
  const old = new Map(saved.map((i) => [i.rowKey, i]));
  const changed: string[] = [];
  const resolved: string[] = [];
  const added: string[] = [];
  for (const [k, s] of old) {
    const c = cur.get(k);
    if (!c) resolved.push(k);
    else if (c.status !== s.status || Math.abs(c.stockUtilizable - s.stockUtilizable) > 0.0005 || Math.abs(c.necesidadTotal - s.necesidadTotal) > 0.0005) changed.push(k);
  }
  for (const k of cur.keys()) if (!old.has(k)) added.push(k);
  return { changed, resolved, added };
}
