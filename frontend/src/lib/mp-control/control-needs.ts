/**
 * Faltantes de UN control guardado (una fórmula + una producción). Reglas puras, sin I/O.
 * Solo devuelve las MP que no alcanzan: SIN STOCK (rojo), STOCK INSUFICIENTE (amarillo) y MP NO IDENTIFICADA (rojo).
 * Las MP con stock suficiente no se devuelven. El stock es compartido: si el control corresponde a una producción de la
 * semana, la disponibilidad sale del reparto por fecha del control semanal (`availableForThis`); si no, se descuenta lo que
 * ya necesitan los controles guardados antes (`earlierNeedByMp`). Así los mismos kg nunca cubren a dos productos.
 */
import { normText, round3 } from "./availability";
import type { ProductSection } from "./product-breakdown";

export type ControlNeedStatus = "SIN_STOCK" | "INSUFICIENTE" | "NO_IDENTIFICADA";
export const CONTROL_NEED_LABEL: Record<ControlNeedStatus, string> = {
  SIN_STOCK: "SIN STOCK",
  INSUFICIENTE: "STOCK INSUFICIENTE",
  NO_IDENTIFICADA: "NO IDENTIFICADA",
};

export type ControlNeedItem = {
  materiaPrima: string;
  codigo: string;
  necesarioKg: number;
  /** null = MP no identificada en Stock MP (dato desconocido: NO es 0 kg). */
  stockFisicoKg: number | null;
  /** Kg asignables a ESTA producción (0 si no está identificada). */
  disponibleKg: number;
  faltanteKg: number;
  status: ControlNeedStatus;
  shared: boolean;
};

export type ControlNeeds = {
  controlId: string;
  client: string;
  product: string;
  quantityKg: number | null;
  linkedOe: string | null;
  allocation: "PRODUCCION" | "CONTROL";
  items: ControlNeedItem[];
  generatedAt: string;
};

export type ControlInput = {
  id: string;
  client: string;
  product: string;
  quantityKg: number | null;
  linkedOe?: string | null;
  lines: Array<{ materiaPrima: string; codigo: string; formulaPct: number | null; kgNecesarios: number | null; kgEditados: number | null; stockActual: number | null }>;
};

const EPS = 0.0005;
const ORDER: Record<ControlNeedStatus, number> = { NO_IDENTIFICADA: 0, SIN_STOCK: 1, INSUFICIENTE: 2 };

function pickSection(c: ControlInput, sections: ProductSection[]): ProductSection | null {
  const key = `${normText(c.client)}|${normText(c.product)}`;
  const cands = sections.filter((s) => `${normText(s.client)}|${normText(s.product)}` === key);
  if (cands.length === 0) return null;
  if (c.quantityKg != null) {
    const exact = cands.find((s) => s.totalKg != null && Math.abs(s.totalKg - c.quantityKg!) < 0.0005);
    if (exact) return exact;
  }
  return cands[0];
}

export function buildControlNeeds(params: {
  control: ControlInput;
  sections: ProductSection[];
  /** Kg ya comprometidos por controles guardados antes (sin producción en la semana), por nombre normalizado de MP. */
  earlierNeedByMp?: ReadonlyMap<string, number>;
  generatedAt?: string;
}): ControlNeeds {
  const { control: c } = params;
  const section = pickSection(c, params.sections);
  const earlier = new Map(params.earlierNeedByMp ?? []);
  const items: ControlNeedItem[] = [];
  for (const l of c.lines) {
    const need =
      l.kgEditados ?? l.kgNecesarios ?? (l.formulaPct != null && c.quantityKg != null ? round3((l.formulaPct * c.quantityKg) / 100) : null);
    if (need == null || need <= EPS) continue;
    const name = normText(l.materiaPrima);
    const sl = section?.lines.find((x) => normText(x.materiaPrima) === name || (l.codigo && x.codigo && normText(x.codigo) === normText(l.codigo)));
    let status: ControlNeedStatus | null = null;
    let stockFisico: number | null;
    let disponible: number;
    let shared = false;
    if (sl) {
      shared = sl.shared;
      if (sl.rowEstado === "MP NO IDENTIFICADA") {
        stockFisico = null;
        disponible = 0;
        status = "NO_IDENTIFICADA";
      } else {
        stockFisico = round3(sl.stockFisico);
        // Dos producciones del mismo producto comparten la sección: el disponible se reparte en proporción a los kg.
        const scale = section && section.totalKg && c.quantityKg != null && c.quantityKg > 0 && c.quantityKg < section.totalKg ? c.quantityKg / section.totalKg : 1;
        disponible = Math.max(0, round3(sl.availableForThis * scale));
      }
    } else if (l.stockActual == null) {
      stockFisico = null;
      disponible = 0;
      status = "NO_IDENTIFICADA";
    } else {
      stockFisico = round3(l.stockActual);
      disponible = Math.max(0, round3(l.stockActual - (earlier.get(name) ?? 0)));
      earlier.set(name, (earlier.get(name) ?? 0) + need);
    }
    if (!status) status = disponible <= EPS ? "SIN_STOCK" : need - disponible > EPS ? "INSUFICIENTE" : null;
    if (!status) continue;
    items.push({
      materiaPrima: l.materiaPrima,
      codigo: l.codigo,
      necesarioKg: round3(need),
      stockFisicoKg: stockFisico,
      disponibleKg: disponible,
      faltanteKg: round3(Math.max(0, need - disponible)),
      status,
      shared,
    });
  }
  items.sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.faltanteKg - a.faltanteKg || a.materiaPrima.localeCompare(b.materiaPrima));
  return {
    controlId: c.id,
    client: c.client,
    product: c.product,
    quantityKg: c.quantityKg,
    linkedOe: c.linkedOe ?? null,
    allocation: section ? "PRODUCCION" : "CONTROL",
    items,
    generatedAt: params.generatedAt ?? new Date().toISOString(),
  };
}
