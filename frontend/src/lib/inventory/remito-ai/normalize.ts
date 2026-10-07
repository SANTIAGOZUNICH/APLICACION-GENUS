/** Normalización y parseo determinístico (sin IA) de textos y cantidades de remitos. */
import type { RemitoUnidad } from "./types";

export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Clave estable de proveedor / descripción para alias y duplicados. */
export function normalizeKey(s: string): string {
  return stripAccents(String(s ?? ""))
    .toUpperCase()
    .replace(/[^A-Z0-9/]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** "0001-000123" y "1-123" → "1-123". Vacío si no hay dígitos/letras. */
export function normalizeRemitoNumber(raw: string): string {
  const parts = stripAccents(String(raw ?? ""))
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
    .map((p) => (/^\d+$/.test(p) ? p.replace(/^0+(?=\d)/, "") : p));
  return parts.join("-");
}

/**
 * Cantidad impresa → número. Convención es-AR:
 *  "1.000" → 1000 · "1,000" → 1000 · "1.000,50" → 1000.5 · "2,5" → 2.5 · "1000" → 1000.
 * Un único separador seguido de exactamente 3 dígitos se interpreta como miles.
 */
export function parseCantidadRemito(raw: string): number | null {
  const s = String(raw ?? "").trim().replace(/[^\d.,]/g, "");
  if (!s || !/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    const decSep = lastDot > lastComma ? "." : ",";
    const thouSep = decSep === "." ? "," : ".";
    normalized = s.split(thouSep).join("").replace(decSep, ".");
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ",";
    const parts = s.split(sep);
    const last = parts[parts.length - 1] ?? "";
    const thousands = parts.length > 2 || (last.length === 3 && parts[0]!.length <= 3 && parts[0] !== "0");
    normalized = thousands ? parts.join("") : `${parts[0]}.${last}`;
  } else {
    normalized = s;
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

const UNIT_MAP: Array<[RegExp, RemitoUnidad]> = [
  [/^(UN|UNI|UNID|UNIDAD|UNIDADES|U|PCS|PZA|PZAS|PIEZA|PIEZAS)$/, "UN"],
  [/^(CAJA|CAJAS|CJ|CJA|CJAS|CAJ)$/, "CAJA"],
  [/^(BULTO|BULTOS|BTO|BTOS|BLT)$/, "BULTO"],
  [/^(KG|KGS|KILO|KILOS|KILOGRAMO|KILOGRAMOS)$/, "KG"],
];

export function normalizeUnidad(raw: string | null | undefined): RemitoUnidad | null {
  const t = stripAccents(String(raw ?? "")).toUpperCase().replace(/[^A-Z]/g, "");
  if (!t) return null;
  for (const [re, unit] of UNIT_MAP) if (re.test(t)) return unit;
  return "OTRO";
}

const CAPACITY_TOKEN = /\b(\d+(?:[.,]\d+)?)\s*(ML|CC|GR|G|LT|L|MM|CM|OZ)\b/gi;

/** Números que en la descripción son capacidad/medida ("30 ML"): no son cantidades. */
export function capacityNumbers(descripcion: string): number[] {
  const out: number[] = [];
  for (const m of String(descripcion ?? "").matchAll(CAPACITY_TOKEN)) {
    const n = parseCantidadRemito(m[1] ?? "");
    if (n != null) out.push(n);
  }
  return out;
}
