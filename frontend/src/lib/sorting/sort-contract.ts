/**
 * Contrato común de ordenamiento — un solo lugar para comparadores
 * reutilizables por TODAS las listas/tablas de la app, en vez de que cada
 * pantalla reinvente su propio `.sort()`. Ver AUDIT_ORDENAMIENTO_GLOBAL.
 *
 * Reglas duras que todo comparador acá respeta:
 * - Números se comparan NUMÉRICAMENTE, nunca como string — "2" < "9" < "10"
 *   < "100", nunca "10" < "100" < "2" < "9" (orden alfabético de dígitos).
 * - Valores nulos/vacíos/indefinidos SIEMPRE quedan al final, sin importar
 *   la dirección — nunca se inventa un valor para poder ordenar.
 * - `compareStrings` usa `localeCompare` con `numeric: true`, así que un
 *   texto con números embebidos ("Línea 2" vs "Línea 10") también ordena
 *   numéricamente esa porción, no solo un sort A-Z puro.
 */

export type SortDirection = "asc" | "desc";

export interface SortOption<T> {
  /** Identificador estable — es lo que se persiste (ver use-sort-preference). */
  key: string;
  /** Texto visible en el selector, ej. "Más recientes primero". */
  label: string;
  compare: (a: T, b: T) => number;
}

/**
 * Extrae el ÚLTIMO grupo de dígitos de un string — mismo criterio que
 * pedido-order-ref.ts (extractPedidoNumber) para no atarse a un único
 * formato de prefijo ("OP-4521", "OA-2026-000145", "OA-2026-4521", etc.).
 * null si no hay ningún dígito — nunca se inventa un 0.
 */
export function extractTrailingNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const matches = String(value).match(/\d+/g);
  if (!matches || matches.length === 0) return null;
  const n = Number(matches[matches.length - 1]);
  return Number.isFinite(n) ? n : null;
}

function nullsLast<V>(a: V | null | undefined, b: V | null | undefined): number | null {
  const aEmpty = a == null || a === "";
  const bEmpty = b == null || b === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  return null;
}

export function compareNumbers(
  a: number | null | undefined,
  b: number | null | undefined,
  direction: SortDirection = "asc"
): number {
  const short = nullsLast(a, b);
  if (short !== null) return short;
  const diff = (a as number) - (b as number);
  return direction === "asc" ? diff : -diff;
}

/** Extrae número (extractTrailingNumber) de campos texto/número mixtos y compara numéricamente. */
export function compareNumericField(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
  direction: SortDirection = "asc"
): number {
  return compareNumbers(extractTrailingNumber(a), extractTrailingNumber(b), direction);
}

export function compareStrings(
  a: string | null | undefined,
  b: string | null | undefined,
  direction: SortDirection = "asc"
): number {
  const short = nullsLast(a?.trim(), b?.trim());
  if (short !== null) return short;
  const cmp = (a as string)
    .trim()
    .localeCompare((b as string).trim(), "es", { numeric: true, sensitivity: "base" });
  return direction === "asc" ? cmp : -cmp;
}

/** Acepta ISO date/datetime strings o Date. Fechas inválidas quedan al final. */
export function compareDates(
  a: string | Date | null | undefined,
  b: string | Date | null | undefined,
  direction: SortDirection = "asc"
): number {
  const at = a == null ? NaN : a instanceof Date ? a.getTime() : Date.parse(a);
  const bt = b == null ? NaN : b instanceof Date ? b.getTime() : Date.parse(b);
  const aValid = Number.isFinite(at);
  const bValid = Number.isFinite(bt);
  if (!aValid && !bValid) return 0;
  if (!aValid) return 1;
  if (!bValid) return -1;
  const diff = at - bt;
  return direction === "asc" ? diff : -diff;
}

/**
 * "VTO más próximo primero": entre dos vencimientos futuros, el más cercano
 * a hoy gana. Un VTO ya vencido se trata como más urgente que uno futuro
 * (sigue siendo información operativa relevante — no se oculta), pero un
 * vencido más antiguo no debe "ganarle" a uno recién vencido de forma
 * contraintuitiva: se ordena por proximidad absoluta a hoy en ambos
 * sentidos, vencidos primero (ya requieren acción) y dentro de vencidos el
 * más reciente primero; luego futuros, el más próximo primero. VTO ausente
 * siempre al final.
 */
export function compareVtoNearest(
  a: string | Date | null | undefined,
  b: string | Date | null | undefined,
  referenceDate: Date = new Date()
): number {
  const short = nullsLast(
    a == null ? null : String(a),
    b == null ? null : String(b)
  );
  if (short !== null) return short;
  const now = referenceDate.getTime();
  const at = a instanceof Date ? a.getTime() : Date.parse(a as string);
  const bt = b instanceof Date ? b.getTime() : Date.parse(b as string);
  const aValid = Number.isFinite(at);
  const bValid = Number.isFinite(bt);
  if (!aValid && !bValid) return 0;
  if (!aValid) return 1;
  if (!bValid) return -1;
  const aExpired = at < now;
  const bExpired = bt < now;
  if (aExpired !== bExpired) return aExpired ? -1 : 1; // vencidos primero
  if (aExpired && bExpired) return bt - at; // vencido más reciente primero
  return at - bt; // futuros: más próximo primero
}

/** Aplica la opción de orden seleccionada sobre el array COMPLETO — nunca sobre una página ya recortada. */
export function applySort<T>(rows: readonly T[], options: readonly SortOption<T>[], key: string): T[] {
  const opt = options.find((o) => o.key === key) ?? options[0];
  if (!opt) return [...rows];
  return [...rows].sort(opt.compare);
}
