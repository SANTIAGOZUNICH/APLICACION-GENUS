import type { RemitoCajaCombo, RemitoLine } from "./types";

/** Formato del modelo: L: 1234   VTO: 2/8 */
export function formatLoteVtoCell(lote: string, vto: string): string {
  const l = (lote ?? "").trim() || "—";
  const v = (vto ?? "").trim() || "—";
  return `L: ${l}   VTO: ${v}`;
}

export function lineCajaCombos(
  line: Pick<
    RemitoLine,
    "cajas1" | "unidades1" | "cajas2" | "unidades2" | "cajas3" | "unidades3" | "extraCajas"
  >
): RemitoCajaCombo[] {
  const out: RemitoCajaCombo[] = [
    { cajas: line.cajas1 || 0, unidades: line.unidades1 || 0 },
    { cajas: line.cajas2 || 0, unidades: line.unidades2 || 0 },
    { cajas: line.cajas3 || 0, unidades: line.unidades3 || 0 },
    ...(line.extraCajas ?? []),
  ];
  return out;
}

export function lineTotalUnitsFromCajas(
  line: Pick<
    RemitoLine,
    "cajas1" | "unidades1" | "cajas2" | "unidades2" | "cajas3" | "unidades3" | "extraCajas"
  >
): number {
  return lineCajaCombos(line).reduce((s, c) => s + (c.cajas || 0) * (c.unidades || 0), 0);
}

export function lineTotalCajas(
  line: Pick<
    RemitoLine,
    "cajas1" | "cajas2" | "cajas3" | "extraCajas"
  >
): number {
  const extras = (line.extraCajas ?? []).reduce((s, c) => s + (c.cajas || 0), 0);
  return (line.cajas1 || 0) + (line.cajas2 || 0) + (line.cajas3 || 0) + extras;
}
