/**
 * Normalización de texto compartida por el clasificador y el master-data.
 * Mayúsculas + sin acentos + espacios/guiones colapsados — para comparar
 * "Noce Cana" / "NOCE CANÁ" / "noce  cana" como el mismo valor, sin fuzzy
 * matching agresivo (esto es normalización determinística, no similitud).
 */
export function normalizeText(value: string): string {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

/** Igual que normalizeText pero sin espacios — para lotes/códigos ("G 26043" ~ "G26043"). */
export function normalizeCompact(value: string): string {
  return normalizeText(value).replace(/\s+/g, "");
}

/**
 * Forma sintáctica de un lote: cada letra → "A", cada dígito → "9", el resto
 * se conserva tal cual. "G26043" → "A99999"; "130826" → "999999";
 * "L26054-1" → "A99999-9". Permite reconocer patrones reales sin
 * hardcodear ningún prefijo (G/A/E son solo lo que la historia muestra hoy).
 */
export function loteShape(value: string): string {
  const compact = normalizeCompact(value);
  return compact.replace(/[A-Z]/g, "A").replace(/[0-9]/g, "9");
}

/** Heurística sintáctica genérica de respaldo cuando la forma no está en el histórico. */
export const GENERIC_LOTE_PATTERN = /^[A-Z]{0,2}\d{5,6}(-\d{1,3})?$/;

export function parseNonNegativeAmount(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/\s*(u\.?|un\.?|unidades?|kg|cajas?)\s*$/i, "").trim();
  if (!cleaned) return null;
  // "1.200" (miles) vs "1,200" (miles US) vs "1200,5" (decimal ar) — mismo
  // criterio que parseNonNegativeNumber (clipboard-import.ts), reimplementado
  // acá para no crear una dependencia circular entre libs de import distintos.
  const eu = cleaned.replace(/\s/g, "");
  let value: number;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(eu)) {
    value = Number.parseFloat(eu.replace(/\./g, "").replace(",", "."));
  } else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(eu)) {
    value = Number.parseFloat(eu.replace(/,/g, ""));
  } else if (/^\d+([.,]\d+)?$/.test(eu)) {
    value = Number.parseFloat(eu.replace(",", "."));
  } else {
    return null;
  }
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

export interface VtoParseResult {
  /** ISO YYYY-MM-DD (fin de mes cuando solo hay mes/año) — mismo formato que parseFlexibleDate. */
  iso: string;
  /** Cómo vino escrito, para mostrar en preview sin reinventar el formato del usuario. */
  display: string;
}

/**
 * VTO real de GENUS OS usa año de 2 dígitos con frecuencia ("08-28",
 * "07/29") — parseFlexibleDate (delivery-date.ts) exige año de 4 dígitos,
 * así que un VTO real fallaría ahí. Este parser es un SUPERSET pensado
 * para Smart Paste: no reemplaza parseFlexibleDate (que siguen usando otras
 * pantallas), solo reconoce más formatos de ENTRADA y normaliza a la MISMA
 * salida ISO.
 */
export function parseVtoCandidate(raw: string): VtoParseResult | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const yyyyMm = trimmed.match(/^(\d{4})-(\d{1,2})$/);
  if (yyyyMm) return fromYearMonth(Number(yyyyMm[1]), Number(yyyyMm[2]), trimmed);

  const dmy = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (dmy) {
    const d = Number(dmy[1]);
    const m = Number(dmy[2]);
    const y = Number(dmy[3]);
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const lastDay = new Date(y, m, 0).getDate();
    if (d > lastDay) return null;
    return { iso: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, display: trimmed };
  }

  const myFull = trimmed.match(/^(\d{1,2})[/.-](\d{4})$/);
  if (myFull) return fromYearMonth(Number(myFull[2]), Number(myFull[1]), trimmed);

  // Año de 2 dígitos — el formato más común en packagingVto real ("08-28").
  const myShort = trimmed.match(/^(\d{1,2})[/.-](\d{2})$/);
  if (myShort) {
    const month = Number(myShort[1]);
    const yy = Number(myShort[2]);
    // GENUS opera en el rango 2020-2069 — evita que "12/99" (1999) se
    // interprete como VTO ya vencido hace décadas por error de siglo.
    const year = yy <= 69 ? 2000 + yy : 1900 + yy;
    return fromYearMonth(year, month, trimmed);
  }

  return null;
}

function fromYearMonth(year: number, month: number, display: string): VtoParseResult | null {
  if (month < 1 || month > 12) return null;
  if (year < 2000 || year > 2100) return null;
  const lastDay = new Date(year, month, 0).getDate();
  return { iso: `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`, display };
}
