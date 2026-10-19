/**
 * Relleno tipo Excel (controlador de relleno) — lógica PURA, sin React ni DOM.
 *
 * Dada la selección origen (los valores en el orden en que están en la planilla a lo largo del eje de arrastre) y
 * cuántas celdas hay que completar, devuelve los valores a escribir. Dos modos, como «Opciones de autorrelleno» de Excel:
 *  - "series": continúa la serie (1 → 2, 3…; 10 y 20 → 30, 40…; fechas día a día o con el paso que marquen las celdas).
 *  - "copy":   repite las celdas origen en ciclo.
 * El tipo de dato lo manda la columna (`kind`): una columna de texto nunca se convierte en número por el relleno.
 */
import { parseFlexibleDate } from "@/features/os/operational/lib/delivery-date";

export type FillMode = "copy" | "series";
export type FillKind = "text" | "number" | "date";
/** 1 = hacia abajo/derecha (continúa después del último origen); -1 = hacia arriba/izquierda (antes del primero). */
export type FillDirection = 1 | -1;

/** Número escrito como lo muestra la planilla («1.234,5», «-10», «12,5») → número, o null si no es un número. */
export function parseSheetNumber(text: string): number | null {
  const t = String(text ?? "").trim().replace(/\s/g, "");
  if (!t || t === "—") return null;
  if (/^[-+]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return Number(t.replace(/\./g, "").replace(",", "."));
  if (/^[-+]?\d+([.,]\d+)?$/.test(t)) return Number(t.replace(",", "."));
  return null;
}

/** Número → texto de planilla (coma decimal, sin separador de miles, sin ruido de coma flotante). */
export function formatSheetNumber(n: number): string {
  const rounded = Math.round(n * 1e9) / 1e9;
  return String(rounded).replace(".", ",");
}

const MS_DAY = 86_400_000;
const isoToDays = (iso: string): number => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / MS_DAY);
};
const daysToDisplay = (days: number): string => {
  const d = new Date(days * MS_DAY);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
};

/** Tendencia lineal por mínimos cuadrados (con ≥ 2 puntos equiespaciados da exactamente el paso aritmético). */
function trend(values: number[]): { at: (index: number) => number } {
  const n = values.length;
  if (n === 1) return { at: (i) => values[0]! + i };
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  values.forEach((y, x) => {
    num += (x - meanX) * (y - meanY);
    den += (x - meanX) ** 2;
  });
  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;
  return { at: (i) => intercept + slope * i };
}

const TRAILING = /^(.*?)(\d+)$/;

/** ¿Se puede continuar una serie con estas celdas origen (según el tipo de la columna)? */
export function canSeries(source: string[], kind: FillKind): boolean {
  const filled = source.map((s) => s.trim());
  if (filled.length === 0 || filled.some((s) => s === "")) return false;
  if (kind === "number") return filled.every((s) => parseSheetNumber(s) !== null);
  if (kind === "date") return filled.every((s) => parseFlexibleDate(s) !== null);
  // Texto con número final («Lote 1», «A-07»): misma raíz en todas las celdas y la raíz con letras (una fecha escrita
  // como texto, «01/03/2026», NO es «Lote»: no se le suma un año).
  const parts = filled.map((s) => TRAILING.exec(s));
  if (parts.some((p) => !p)) return false;
  return parts.every((p) => p![1] === parts[0]![1]) && /\p{L}/u.test(parts[0]![1]!);
}

/** Modo por defecto: serie si los datos la permiten (1 → 2, 3…), copia en caso contrario. */
export function defaultFillMode(source: string[], kind: FillKind): FillMode {
  return canSeries(source, kind) ? "series" : "copy";
}

/**
 * Valores para las `count` celdas siguientes. `source` va en orden de planilla (de arriba hacia abajo / de izquierda a
 * derecha). Con direction -1 el primer valor devuelto es el de la celda que está justo antes del primer origen, el
 * segundo la anterior, etc. (el orden de «alejándose de la selección»).
 */
export function fillValues(
  source: string[],
  count: number,
  direction: FillDirection,
  mode: FillMode,
  kind: FillKind
): string[] {
  if (count <= 0 || source.length === 0) return [];
  const n = source.length;
  const copyAt = (k: number): string => {
    // k-ésima celda alejándose de la selección: continúa el ciclo del origen.
    const idx = direction === 1 ? k % n : (n - 1 - (k % n) + n) % n;
    return source[idx]!;
  };
  if (mode === "copy" || !canSeries(source, kind)) return Array.from({ length: count }, (_, k) => copyAt(k));

  const at = (k: number): number => {
    // posición en la serie: hacia adelante n + k; hacia atrás -1 - k.
    return direction === 1 ? n + k : -1 - k;
  };
  if (kind === "number") {
    const t = trend(source.map((s) => parseSheetNumber(s)!));
    return Array.from({ length: count }, (_, k) => formatSheetNumber(t.at(at(k))));
  }
  if (kind === "date") {
    const t = trend(source.map((s) => isoToDays(parseFlexibleDate(s)!)));
    return Array.from({ length: count }, (_, k) => daysToDisplay(Math.round(t.at(at(k)))));
  }
  // Texto con número final: se conserva la raíz y el relleno con ceros.
  const parts = source.map((s) => TRAILING.exec(s.trim())!);
  const prefix = parts[0]![1]!;
  const width = parts[0]![2]!.length;
  const padded = parts.every((p) => p[2]!.length === width && p[2]!.startsWith("0"));
  const t = trend(parts.map((p) => Number(p[2])));
  return Array.from({ length: count }, (_, k) => {
    const v = Math.max(0, Math.round(t.at(at(k))));
    return `${prefix}${padded ? String(v).padStart(width, "0") : String(v)}`;
  });
}
