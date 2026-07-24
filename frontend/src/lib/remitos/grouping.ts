import type { RemitoLine } from "./types";

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
  "product" | "lote" | "vto" | "totalUnits" | "cajas1" | "unidades1" | "cajas2" | "unidades2"
> & { workItemId?: string };

function lineKey(line: ConsolidatableLine): string {
  return [
    line.product.trim().toLowerCase(),
    line.lote.trim().toLowerCase(),
    line.vto.trim().toLowerCase(),
  ].join("|");
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
      map.set(key, { ...line });
      continue;
    }
    existing.totalUnits += line.totalUnits;
    existing.cajas1 += line.cajas1;
    existing.unidades1 += line.unidades1;
    existing.cajas2 += line.cajas2;
    existing.unidades2 += line.unidades2;
  }
  return [...map.values()];
}
