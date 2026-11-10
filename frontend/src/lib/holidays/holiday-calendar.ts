/**
 * Calendario CENTRAL de feriados aplicables a la planta (Villa Domínico, partido de Avellaneda, Provincia de Buenos Aires).
 *
 * Criterio: exactitud antes que cantidad. Solo se muestran FERIADOS que obligan a una empresa privada de PBA:
 *  - nacionales por regla legal (Ley 27.399: inamovibles y trasladables en su fecha efectiva),
 *  - extraordinarios oficialmente decretados (tabla `OFFICIAL_ADJUSTMENTS`),
 *  - provinciales / municipales SOLO si aplican realmente a la planta (hoy no hay ninguno permanente).
 * NO se marcan: días no laborables (turísticos, Jueves Santo, etc. — en Genus se trabaja normal), asuetos administrativos,
 * feriados bancarios, celebraciones locales ni feriados de otras jurisdicciones (p. ej. CABA o Córdoba).
 *
 * Es solo INFORMATIVO: no bloquea ni mueve la planificación, ni entra en cálculos de productividad, asistencia o incentivos.
 * No depende de ninguna API externa: para sumar una nueva disposición se agrega una entrada a `OFFICIAL_ADJUSTMENTS`.
 */
import { nationalHolidays } from "@/lib/portal/business-days";

export type HolidayScope = "nacional" | "provincial" | "municipal";
/** `regla_legal`: fecha determinada por ley; `decreto_oficial`: decreto publicado; `confirmado_direccion`: confirmado por Dirección con referencia oficial, pendiente de cotejo en el Boletín Oficial. */
export type HolidayVerification = "regla_legal" | "decreto_oficial" | "confirmado_direccion" | "pendiente";

export interface PlantHoliday {
  date: string; // YYYY-MM-DD
  name: string;
  scope: HolidayScope;
  jurisdiction: string;
  source: string;
  verification: HolidayVerification;
}

export const PLANT_JURISDICTION = "Provincia de Buenos Aires";
const LEY_NACIONALES = "Ley 27.399 — Feriados nacionales y días no laborables";

/**
 * Disposiciones oficiales que suman o modifican feriados. Las entradas con verificación `pendiente` NO se muestran como oficiales.
 * `remove` quita una fecha de la regla legal cuando un decreto la traslada (se debe acompañar del `add` con la fecha efectiva).
 */
export const OFFICIAL_ADJUSTMENTS: { add: PlantHoliday[]; remove: string[] } = {
  add: [
    {
      date: "2026-11-09",
      name: "Feriado nacional extraordinario — Visita del Papa León XIV",
      scope: "nacional",
      jurisdiction: "Nacional",
      source: "Decreto Nacional 1103/2026",
      verification: "confirmado_direccion",
    },
    {
      date: "2026-11-11",
      name: "Feriado provincial — Visita del Papa León XIV",
      scope: "provincial",
      jurisdiction: PLANT_JURISDICTION,
      source: "Feriado extraordinario para toda la Provincia de Buenos Aires (referencia: Decreto Nacional 1103/2026)",
      verification: "confirmado_direccion",
    },
  ],
  remove: [],
};

/**
 * Fechas que se publican en medios pero NO aplican a la planta. Solo documentación y pruebas: nunca se marcan.
 */
export const NOT_APPLICABLE_TO_PLANT: Record<string, string> = {
  "2026-11-10": "Feriado de CABA y Córdoba (no de la Provincia de Buenos Aires).",
  "2026-12-07": "Día no laborable con fines turísticos (en Genus se trabaja normal).",
};

const cache = new Map<number, Map<string, PlantHoliday>>();

function buildYear(year: number): Map<string, PlantHoliday> {
  const out = new Map<string, PlantHoliday>();
  const removed = new Set(OFFICIAL_ADJUSTMENTS.remove);
  for (const h of nationalHolidays(year)) {
    if (h.kind !== "feriado" || removed.has(h.date)) continue;
    out.set(h.date, { date: h.date, name: h.name, scope: "nacional", jurisdiction: "Nacional", source: LEY_NACIONALES, verification: "regla_legal" });
  }
  for (const a of OFFICIAL_ADJUSTMENTS.add) {
    if (a.verification === "pendiente" || !a.date.startsWith(`${year}-`)) continue;
    const prev = out.get(a.date);
    // Si coincide con un feriado por regla, se conserva el nombre legal y se suma la disposición como fuente.
    out.set(a.date, prev ? { ...prev, source: `${prev.source}; ${a.source}` } : a);
  }
  return out;
}

function yearMap(year: number): Map<string, PlantHoliday> {
  let m = cache.get(year);
  if (!m) {
    m = buildYear(year);
    cache.set(year, m);
  }
  return m;
}

/** Feriado aplicable a la planta en esa fecha (YYYY-MM-DD) o null. */
export function plantHolidayOn(dateIso: string): PlantHoliday | null {
  const year = Number(dateIso.slice(0, 4));
  if (!Number.isInteger(year)) return null;
  return yearMap(year).get(dateIso) ?? null;
}

/** Feriados aplicables entre dos fechas (inclusive), indexados por fecha. */
export function plantHolidaysBetween(fromIso: string, toIso: string): Map<string, PlantHoliday> {
  const found: PlantHoliday[] = [];
  for (let y = Number(fromIso.slice(0, 4)); y <= Number(toIso.slice(0, 4)); y++) {
    for (const [d, h] of yearMap(y)) if (d >= fromIso && d <= toIso) found.push(h);
  }
  return new Map(found.sort((a, b) => a.date.localeCompare(b.date)).map((h) => [h.date, h]));
}

export function holidayScopeLabel(scope: HolidayScope): string {
  return scope === "nacional" ? "Feriado nacional" : scope === "provincial" ? "Feriado provincial" : "Feriado municipal";
}
