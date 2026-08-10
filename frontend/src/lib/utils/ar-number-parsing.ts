/**
 * Parsing numérico consistente para el formato argentino (coma decimal,
 * punto de miles) — reemplaza los `Number.parseFloat(str.replace(",", "."))`
 * sueltos que convertían "1.500" (mil quinientos) en 1.5.
 *
 * No hay una regla única para todo: "12.5 kg" y "1.500 unidades" tienen el
 * mismo separador pero significan cosas distintas según el tipo de campo.
 * Por eso hay dos funciones — quien parsea decide cuál corresponde según el
 * campo (cantidades en kg/decimales vs. cajas/unidades enteras).
 */

export interface ArNumberParseResult {
  ok: boolean;
  value: number | null;
  error?: string;
}

function stripWhitespace(raw: string): string {
  return raw.replace(/\s/g, "");
}

/**
 * Cantidades decimales (kg, litros, etc.). Coma siempre es decimal.
 * Con un solo punto y sin coma, el punto se interpreta como decimal
 * ("12.5" → 12.5), no como separador de miles — es la lectura más común
 * al tipear con teclado numérico. Con más de un punto, todos menos el
 * último son de miles ("1.234.567,89" o "1.234.567.89").
 */
export function parseArDecimal(raw: string | number | null | undefined): ArNumberParseResult {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? { ok: true, value: raw } : { ok: false, value: null };
  }
  const text = stripWhitespace(String(raw ?? "").trim());
  if (!text) return { ok: true, value: null };

  const hasComma = text.includes(",");
  const dotCount = (text.match(/\./g) ?? []).length;

  let normalized: string;
  if (hasComma) {
    // Punto(s) = miles, última coma = decimal.
    normalized = text.replace(/\./g, "").replace(",", ".");
  } else if (dotCount > 1) {
    // Varios puntos sin coma: todos menos el último son de miles.
    const lastDot = text.lastIndexOf(".");
    normalized = text.slice(0, lastDot).replace(/\./g, "") + "." + text.slice(lastDot + 1);
  } else {
    // Un solo punto o ninguno: se interpreta tal cual (decimal).
    normalized = text;
  }

  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    return { ok: false, value: null, error: `Número inválido: "${raw}".` };
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? { ok: true, value } : { ok: false, value: null };
}

/**
 * Cantidades enteras (unidades, cajas, unidades por caja). El punto SIEMPRE
 * es separador de miles ("1.500" → 1500), nunca decimal. La coma es decimal
 * pero el resultado se trunca a entero (no debería llegar coma acá, pero no
 * se descarta el dato: se redondea hacia abajo en vez de fallar).
 */
export function parseArInteger(raw: string | number | null | undefined): ArNumberParseResult {
  if (typeof raw === "number") {
    return Number.isFinite(raw)
      ? { ok: true, value: Math.trunc(raw) }
      : { ok: false, value: null };
  }
  const text = stripWhitespace(String(raw ?? "").trim());
  if (!text) return { ok: true, value: null };

  const normalized = text.replace(/\./g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    return { ok: false, value: null, error: `Número entero inválido: "${raw}".` };
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? { ok: true, value: Math.trunc(value) } : { ok: false, value: null };
}

/** true si `unit` describe un conteo entero (unidades/cajas) en vez de un peso/volumen decimal. */
export function isIntegerUnit(unit: string | null | undefined): boolean {
  const u = (unit ?? "").trim().toLowerCase();
  return u === "un." || u === "un" || u === "unidades" || u === "unidad" || u === "cajas" || u === "u.";
}
