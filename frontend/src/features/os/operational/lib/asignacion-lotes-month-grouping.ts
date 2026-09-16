/**
 * Agrupación/filtro por mes de Asignación de Lotes.
 *
 * INVESTIGACIÓN PREVIA (Production, sept. 2026, work items reales con
 * packagingLote): se relevaron 40 registros reales (lotes G26043, L26069,
 * A26042, etc.) contra sus fechas reales (plannedDate/deliveryDate). TODOS
 * los registros actualmente activos corresponden a un único mes calendario
 * (agosto 2026) — no hay variación de mes para correlacionar contra la
 * letra inicial del lote. Patrón observado: la letra parece indicar una
 * LÍNEA/PRODUCTO (G/L/A/E se repiten consistentemente por línea, no por
 * fecha) y las posiciones 2-3 del número SÍ parecen codificar el AÑO
 * (G26043 → "26" → 2026), pero el resto es un correlativo secuencial sin
 * relación visible con el mes calendario.
 *
 * CONCLUSIÓN: no hay evidencia real para una regla letra→mes. Por lo tanto
 * NO se hardcodea ninguna (nada de "G=Agosto"). La fecha es la ÚNICA fuente
 * para determinar el mes. `loteMonthMap` queda como punto de extensión
 * explícito y auditable por si en el futuro se junta evidencia real
 * multi-mes — vacío por defecto, tal como pide "no adivinar".
 */

export interface AsignacionLoteForGrouping {
  id: string;
  lote: string;
  fecha: string | null;
  cantidades?: number;
}

export interface ResolvedMonth {
  /** "2026-09" o null si no se pudo determinar. */
  key: string | null;
  /** "SEPTIEMBRE 2026" o el label de "sin mes". */
  label: string;
  source: "fecha" | "lote_inferido" | "sin_mes";
}

export interface MonthGroup<T> {
  key: string | null;
  label: string;
  count: number;
  items: T[];
}

export interface MonthFilterOption {
  key: string; // "" = Todos
  label: string;
  count: number;
}

export const SIN_MES_LABEL = "SIN MES / FECHA NO IDENTIFICADA";
export const SIN_MES_KEY = "__sin_mes__";

const MONTH_NAMES = [
  "ENERO",
  "FEBRERO",
  "MARZO",
  "ABRIL",
  "MAYO",
  "JUNIO",
  "JULIO",
  "AGOSTO",
  "SEPTIEMBRE",
  "OCTUBRE",
  "NOVIEMBRE",
  "DICIEMBRE",
];

/** Letra inicial de lote → mes (1-12), SOLO si hay evidencia real confirmada. Vacío hoy — ver cabecera del archivo. */
export type LoteMonthMap = ReadonlyMap<string, { monthIndex: number; confidence: "alta" }>;

export function monthKeyFromIso(iso: string): { key: string; label: string } | null {
  const match = iso.match(/^(\d{4})-(\d{2})/);
  if (!match) return null;
  const year = match[1]!;
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return null;
  return { key: `${year}-${match[2]}`, label: `${MONTH_NAMES[monthIndex]} ${year}` };
}

/**
 * Determina el mes de UN registro. La fecha real (`fecha`) es SIEMPRE la
 * fuente principal — nunca se sobreescribe con una inferencia. Solo si no
 * hay fecha se intenta `loteMonthMap` (vacío por defecto ⇒ "sin mes").
 */
export function resolveRecordMonth(
  record: Pick<AsignacionLoteForGrouping, "fecha" | "lote">,
  loteMonthMap: LoteMonthMap = new Map()
): ResolvedMonth {
  if (record.fecha) {
    const resolved = monthKeyFromIso(record.fecha);
    if (resolved) return { ...resolved, source: "fecha" };
  }
  const letra = record.lote.trim().charAt(0).toUpperCase();
  const inferred = letra ? loteMonthMap.get(letra) : undefined;
  if (inferred) {
    // Sin fecha no hay año confiable tampoco — se documenta la inferencia
    // pero SIN inventar un año, así que no arma una clave de grupo real.
    return {
      key: null,
      label: `${MONTH_NAMES[inferred.monthIndex]} (mes inferido por lote — año desconocido)`,
      source: "lote_inferido",
    };
  }
  return { key: null, label: SIN_MES_LABEL, source: "sin_mes" };
}

/** Agrupa YA FILTRADOS — nunca es una fuente de datos separada, solo presentación sobre el mismo array. */
export function groupByMonth<T extends AsignacionLoteForGrouping>(
  records: T[],
  loteMonthMap: LoteMonthMap = new Map()
): MonthGroup<T>[] {
  const groups = new Map<string, MonthGroup<T>>();
  for (const record of records) {
    const resolved = resolveRecordMonth(record, loteMonthMap);
    const groupKey = resolved.key ?? SIN_MES_KEY;
    const existing = groups.get(groupKey);
    if (existing) {
      existing.items.push(record);
      existing.count += 1;
    } else {
      groups.set(groupKey, { key: resolved.key, label: resolved.label, count: 1, items: [record] });
    }
  }
  return [...groups.values()].sort((a, b) => {
    if (a.key === null) return 1;
    if (b.key === null) return -1;
    return b.key.localeCompare(a.key);
  });
}

/** Opciones de filtro rápido — SOLO meses realmente presentes en los datos, más reciente primero. Nunca hardcodeadas. */
export function buildMonthFilterOptions<T extends AsignacionLoteForGrouping>(
  records: T[],
  loteMonthMap: LoteMonthMap = new Map()
): MonthFilterOption[] {
  const groups = groupByMonth(records, loteMonthMap);
  const options: MonthFilterOption[] = [{ key: "", label: "Todos", count: records.length }];
  for (const group of groups) {
    options.push({ key: group.key ?? SIN_MES_KEY, label: group.label, count: group.count });
  }
  return options;
}

/** Filtra por la clave elegida en buildMonthFilterOptions ("" = todos). */
export function filterByMonthKey<T extends AsignacionLoteForGrouping>(
  records: T[],
  monthKey: string,
  loteMonthMap: LoteMonthMap = new Map()
): T[] {
  if (!monthKey) return records;
  return records.filter((record) => {
    const resolved = resolveRecordMonth(record, loteMonthMap);
    return (resolved.key ?? SIN_MES_KEY) === monthKey;
  });
}

export interface LoteMonthInconsistency {
  fechaLabel: string;
  loteInferredLabel: string;
}

/**
 * Compara el mes real (fecha) contra el mes que el lote "diría" según
 * `loteMonthMap`. Con el mapa vacío (estado real hoy, ver cabecera) esta
 * función NUNCA reporta nada — no hay regla para contradecir. Queda lista
 * para el día en que se confirme una convención real con evidencia
 * multi-mes. NO bloquea nada — es puramente informativo (mismo criterio
 * que los warnings de lote/VTO del WorkItem).
 */
export function detectLoteMonthInconsistency(
  record: Pick<AsignacionLoteForGrouping, "fecha" | "lote">,
  loteMonthMap: LoteMonthMap
): LoteMonthInconsistency | null {
  if (!record.fecha || loteMonthMap.size === 0) return null;
  const fechaResolved = monthKeyFromIso(record.fecha);
  if (!fechaResolved) return null;
  const letra = record.lote.trim().charAt(0).toUpperCase();
  const inferred = loteMonthMap.get(letra);
  if (!inferred) return null;
  const fechaMonthIndex = Number(fechaResolved.key.slice(5, 7)) - 1;
  if (fechaMonthIndex === inferred.monthIndex) return null;
  return {
    fechaLabel: fechaResolved.label,
    loteInferredLabel: MONTH_NAMES[inferred.monthIndex]!,
  };
}
