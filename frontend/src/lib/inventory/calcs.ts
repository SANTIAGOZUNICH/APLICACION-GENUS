/**
 * Cálculos de inventario ME/MP — sin NaN/undefined/cero artificial.
 */

export function multiplyTotal(
  bultos: number | null | undefined,
  cantidad: number | null | undefined
): number | null {
  if (bultos == null || cantidad == null) return null;
  if (!Number.isFinite(bultos) || !Number.isFinite(cantidad)) return null;
  return Number((bultos * cantidad).toFixed(6));
}

/**
 * Presentación de bultos a partir de stock total y cantidad por bulto.
 * No inventa conversión si falta cantidadPorBulto.
 */
export function formatMeBultosDisplay(
  stockTotal: number,
  cantidadPorBulto: number | null | undefined
): string {
  if (cantidadPorBulto == null || !Number.isFinite(cantidadPorBulto) || cantidadPorBulto <= 0) {
    return "";
  }
  if (!Number.isFinite(stockTotal)) return "";
  const completos = Math.floor(stockTotal / cantidadPorBulto);
  const remanente = Number((stockTotal - completos * cantidadPorBulto).toFixed(6));
  if (remanente === 0) {
    return String(completos);
  }
  if (completos === 0) {
    return `${remanente} unidades`;
  }
  return `${completos} completos + ${remanente} unidades`;
}

export type MpStockEstado =
  | "Sin dato"
  | "Sin stock"
  | "Stock crítico"
  | "Stock bajo"
  | "Stock OK";

export type MpVencimientoEstado =
  | "Sin dato"
  | "Vencido"
  | "Vence pronto"
  | "Vigente";

export function calcMpEstadoStock(
  cantidad: number | null | undefined,
  thresholds: { critico: number; bajo: number } = { critico: 2, bajo: 5 }
): MpStockEstado {
  if (cantidad == null || !Number.isFinite(cantidad)) return "Sin dato";
  if (cantidad === 0) return "Sin stock";
  if (cantidad > 0 && cantidad < thresholds.critico) return "Stock crítico";
  if (cantidad >= thresholds.critico && cantidad < thresholds.bajo) return "Stock bajo";
  return "Stock OK";
}

export function calcDiasAlVence(
  vencimientoIso: string | null | undefined,
  today = new Date()
): number | null {
  if (!vencimientoIso?.trim()) return null;
  const v = new Date(vencimientoIso.slice(0, 10) + "T12:00:00");
  if (Number.isNaN(v.getTime())) return null;
  const t = new Date(today);
  t.setHours(12, 0, 0, 0);
  return Math.round((v.getTime() - t.getTime()) / (24 * 60 * 60 * 1000));
}

export function calcMpEstadoVencimiento(
  dias: number | null,
  prontoDays = 90
): MpVencimientoEstado {
  if (dias == null) return "Sin dato";
  if (dias < 0) return "Vencido";
  if (dias <= prontoDays) return "Vence pronto";
  return "Vigente";
}

export function calcFalta(
  necesaria: number | null | undefined,
  enInventario: number | null | undefined
): number | null {
  if (necesaria == null || !Number.isFinite(necesaria)) return null;
  if (enInventario == null || !Number.isFinite(enInventario)) return necesaria;
  return Math.max(necesaria - enInventario, 0);
}

export function calcControlEstado(falta: number | null): "" | "FALTA" | "HAY" {
  if (falta == null) return "";
  return falta > 0 ? "FALTA" : "HAY";
}

export type MeAlertLevel = "OK" | "BAJO" | "CRITICO" | "SIN_STOCK";

export function calcMeAlertLevel(
  stock: number,
  minimo: number | null,
  puntoReposicion: number | null
): MeAlertLevel {
  if (stock <= 0) return "SIN_STOCK";
  if (minimo != null && stock < minimo) return "CRITICO";
  if (puntoReposicion != null && stock <= puntoReposicion) return "BAJO";
  if (minimo != null && stock < minimo * 1.5) return "BAJO";
  return "OK";
}

export function parseOptionalNumber(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const n = Number(raw.replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function displayCell(value: unknown): string {
  if (value == null) return "";
  const s = String(value).trim();
  if (!s || /^(undefined|null|n\/a|na|nan)$/i.test(s)) return "";
  return s;
}
