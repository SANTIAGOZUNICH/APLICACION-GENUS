import type { RemitoCajaCombo, RemitoLine } from "./types";
import { lineTotalCajas } from "./line-qty";

/** Normaliza cliente para agrupación (trim + lower + colapso espacios). */
export function normalizeClientId(clientId: string | null | undefined): string {
  return String(clientId ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Clave de agrupación: un borrador por cliente + fecha de entrega. */
export function remitoGroupKey(clientId: string, deliveryDate: string): string {
  return `${normalizeClientId(clientId)}|${String(deliveryDate).trim()}`;
}

export type ConsolidatableLine = Pick<
  RemitoLine,
  | "product"
  | "lote"
  | "vto"
  | "totalUnits"
  | "cajas1"
  | "unidades1"
  | "cajas2"
  | "unidades2"
  | "cajas3"
  | "unidades3"
  | "extraCajas"
> & { workItemId?: string };

function lineKey(line: ConsolidatableLine): string {
  return [
    line.product.trim().toLowerCase(),
    line.lote.trim().toLowerCase(),
    line.vto.trim().toLowerCase(),
  ].join("|");
}

function mergeExtra(
  a: RemitoCajaCombo[] | undefined,
  b: RemitoCajaCombo[] | undefined
): RemitoCajaCombo[] {
  return [...(a ?? []), ...(b ?? [])];
}

/**
 * Consolida líneas por product + lote + vto (suma cantidades).
 * Distintos lotes / vto → líneas separadas.
 */
export function consolidateLinesByProductLoteVto(
  lines: ConsolidatableLine[]
): ConsolidatableLine[] {
  const map = new Map<string, ConsolidatableLine>();
  for (const line of lines) {
    const key = lineKey(line);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        ...line,
        cajas3: line.cajas3 ?? 0,
        unidades3: line.unidades3 ?? 0,
        extraCajas: [...(line.extraCajas ?? [])],
      });
      continue;
    }
    existing.totalUnits += line.totalUnits;
    existing.cajas1 += line.cajas1;
    existing.unidades1 += line.unidades1;
    existing.cajas2 += line.cajas2;
    existing.unidades2 += line.unidades2;
    existing.cajas3 = (existing.cajas3 ?? 0) + (line.cajas3 ?? 0);
    existing.unidades3 = (existing.unidades3 ?? 0) + (line.unidades3 ?? 0);
    existing.extraCajas = mergeExtra(existing.extraCajas, line.extraCajas);
  }
  return [...map.values()];
}

export function sumLineCajas(lines: ConsolidatableLine[]): number {
  return lines.reduce((s, l) => s + lineTotalCajas(l), 0);
}
