/**
 * Productividad de Envasado — cálculo PURO sobre registros del módulo Métricas (packaging_metrics).
 *
 * FUENTE ÚNICA: los mismos registros que lista `MetricasService.list` (activos: `deleted_at` nulo). Nada sale de work_items.
 * Los totales se suman con `computeTotals` de Métricas, así que coinciden exactamente con lo que Métricas muestra para el
 * mismo período/sector. Sin datos ⇒ value null («Sin datos suficientes»): nunca se inventa un número.
 *
 * Qué ve cada sector lo decide el servidor (`responsiblesScope`): los totales agregados los ven todos; los nombres de
 * responsables solo Producción/Dirección y cada sector de Envasado (únicamente los registros de su sector).
 */
import { computeTotals, METRICS_SECTORS, normalizeResponsibleKey, type MetricsSector, type PackagingMetricRecord } from "@/lib/metricas/types";
import { fmtInt, monthName, periodText } from "./format";
import { DASHBOARD_KPI_DEFINITIONS } from "./kpi-definitions";
import { RESPONSIBLES_NOT_AVAILABLE_REASON, RESPONSIBLES_OTHER_SECTOR_REASON, type ResponsiblesScope } from "./permissions";
import {
  OTROS_RESPONSABLES_KEY,
  SIN_RESPONSABLE_KEY,
  SIN_RESPONSABLE_LABEL,
  type DashboardFilters,
  type DashboardKpi,
  type DashboardKpiKey,
  type DashboardMetricRow,
  type DashboardProductividad,
  type DashboardProductividadMonth,
  type DashboardResponsibleColumn,
  type DashboardResponsibleRow,
  type DashboardResponsibles,
} from "./types";

/** Máximo de responsables con columna propia en la tendencia mensual (el resto se agrupa en «Otros»). */
export const MAX_RESPONSIBLE_COLUMNS = 4;

const NO_RESPONSIBLE_TOKENS: ReadonlySet<string> = new Set([
  "sin responsable",
  "sin asignar",
  "sin dato",
  "sin datos",
  "s/r",
  "s/d",
  "s/a",
  "n/a",
  "na",
  "ninguno",
  "ninguna",
  "null",
  "undefined",
]);

/**
 * Clave de agrupación de un responsable. Usa la normalización que ya usa Métricas (`responsible_key`: trim, minúsculas,
 * espacios colapsados) y NO unifica tildes ni apodos: «José» y «Jose» quedan separados antes que unir personas distintas.
 * Devuelve null si no hay un responsable válido (vacío, solo signos, «sin responsable», «n/a»…).
 */
export function responsibleGroupKey(r: Pick<DashboardMetricRow, "responsibleKey" | "responsibleDisplay">): string | null {
  const raw = (r.responsibleKey || normalizeResponsibleKey(r.responsibleDisplay || "")).trim();
  const key = normalizeResponsibleKey(raw);
  if (!key || !/[\p{L}\p{N}]/u.test(key)) return null;
  if (NO_RESPONSIBLE_TOKENS.has(key)) return null;
  return key;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Registros que cuentan: activos, de Envasado, con fecha y unidades numéricas no negativas. */
export function validMetricRows(rows: DashboardMetricRow[] | undefined): DashboardMetricRow[] {
  return (rows ?? []).filter(
    (r) =>
      !r.deletedAt &&
      (METRICS_SECTORS as readonly string[]).includes(r.sector) &&
      isIsoDate(String(r.metricDate ?? "").slice(0, 10)) &&
      Number.isFinite(r.units) &&
      r.units >= 0
  );
}

/** Adaptador: `DashboardMetricRow` es un subconjunto de `PackagingMetricRecord` (para reutilizar `computeTotals`). */
const asRecords = (rows: DashboardMetricRow[]): PackagingMetricRecord[] => rows as unknown as PackagingMetricRecord[];
const sumUnits = (rows: DashboardMetricRow[]) => computeTotals(asRecords(rows)).totalUnits;

type KpiOpts = { value: number | null; sampleSize: number; unit: DashboardKpi["unit"]; reason?: string; toRecord?: string; notes?: string[]; valueLabel?: string; sectorApplies?: boolean };

function metricKpi(key: DashboardKpiKey, periodLabel: string, o: KpiOpts): DashboardKpi {
  const def = DASHBOARD_KPI_DEFINITIONS[key];
  const hasValue = o.value != null;
  return {
    key,
    label: def.label,
    unit: o.unit,
    value: o.value,
    sampleSize: o.sampleSize,
    dateBasis: def.dateBasis,
    periodLabel,
    accuracy: hasValue ? def.accuracy : "sin_datos",
    reason: hasValue ? null : (o.reason ?? "Sin registros de Métricas en el período."),
    toRecord: hasValue ? null : (o.toRecord ?? "Cargar las unidades envasadas en Métricas (Envasado Masivo / Premium)."),
    appliedFilters: { period: true, sector: o.sectorApplies ?? true, client: false },
    notes: o.notes ?? [],
    ...(o.valueLabel ? { valueLabel: o.valueLabel } : {}),
  };
}

export type ProductividadContext = {
  responsiblesScope: ResponsiblesScope;
  schemaPending?: boolean;
};

function modeDisplay(displays: Map<string, number>): string {
  return [...displays.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0][0];
}

type Group = { key: string; unassigned: boolean; units: number; records: number; displays: Map<string, number> };

function groupByResponsible(rows: DashboardMetricRow[]): Group[] {
  const map = new Map<string, Group>();
  for (const r of rows) {
    const k = responsibleGroupKey(r);
    const key = k ?? SIN_RESPONSABLE_KEY;
    const g = map.get(key) ?? { key, unassigned: k == null, units: 0, records: 0, displays: new Map<string, number>() };
    g.units += r.units;
    g.records += 1;
    if (k != null) {
      const d = (r.responsibleDisplay ?? "").trim().replace(/\s+/g, " ");
      if (d) g.displays.set(d, (g.displays.get(d) ?? 0) + 1);
    }
    map.set(key, g);
  }
  return [...map.values()];
}

const nameOf = (g: Group) => (g.unassigned || g.displays.size === 0 ? (g.unassigned ? SIN_RESPONSABLE_LABEL : g.key) : modeDisplay(g.displays));

/** Orden: unidades desc; empate por nombre (es); «Sin responsable» siempre al final. */
function sortGroups(groups: Group[]): Group[] {
  return [...groups].sort((a, b) => {
    if (a.unassigned !== b.unassigned) return a.unassigned ? 1 : -1;
    return b.units - a.units || nameOf(a).localeCompare(nameOf(b), "es");
  });
}

function toRow(g: Group, total: number): DashboardResponsibleRow {
  return { key: g.key, name: nameOf(g), units: g.units, share: total > 0 ? round1((g.units / total) * 100) : 0, records: g.records, unassigned: g.unassigned };
}

export function computeProductividad(rawRows: DashboardMetricRow[] | undefined, filters: DashboardFilters, ctx: ProductividadContext): DashboardProductividad {
  const periodLbl = periodText(filters.year, filters.month);
  const yearStr = String(filters.year);
  const monthStr = filters.month ? String(filters.month).padStart(2, "0") : null;
  const sectorOk = (r: DashboardMetricRow) => filters.sector === "ALL" || r.sector === filters.sector;

  const all = validMetricRows(rawRows);
  const yearRows = all.filter((r) => r.metricDate.slice(0, 4) === yearStr && sectorOk(r));
  const periodRows = monthStr ? yearRows.filter((r) => r.metricDate.slice(5, 7) === monthStr) : yearRows;

  // --- KPIs ----------------------------------------------------------------------------------------------------------
  const masivoRows = periodRows.filter((r) => r.sector === "ENVASADO_MASIVO");
  const premiumRows = periodRows.filter((r) => r.sector === "ENVASADO_PREMIUM");
  const total = sumUnits(periodRows);
  const masivo = sumUnits(masivoRows);
  const premium = sumUnits(premiumRows);
  const hasData = periodRows.length > 0;
  const noData = "No hay registros de Métricas en el período.";

  const outOfFilter = (key: MetricsSector) => filters.sector !== "ALL" && filters.sector !== key;
  const sectorKpi = (key: DashboardKpiKey, sector: MetricsSector, units: number, n: number) =>
    metricKpi(key, periodLbl, {
      unit: "units",
      value: outOfFilter(sector) ? null : hasData ? units : null,
      sampleSize: n,
      reason: outOfFilter(sector) ? "Fuera del filtro de sector seleccionado." : noData,
    });
  const shareKpi = (key: DashboardKpiKey, sector: MetricsSector, units: number) =>
    metricKpi(key, periodLbl, {
      unit: "percent",
      value: outOfFilter(sector) ? null : total > 0 ? round1((units / total) * 100) : null,
      sampleSize: periodRows.length,
      reason: outOfFilter(sector) ? "Fuera del filtro de sector seleccionado." : "No hay unidades envasadas en el período (no se divide por cero).",
    });

  const activeDates = new Set(periodRows.map((r) => r.metricDate.slice(0, 10)));
  const activeDays = activeDates.size;
  const dailyAverage = metricKpi("envasado_promedio_diario", periodLbl, {
    unit: "decimal",
    value: activeDays > 0 ? round1(total / activeDays) : null,
    sampleSize: activeDays,
    reason: noData,
    notes: activeDays > 0 ? [`${fmtInt(total)} unidades ÷ ${fmtInt(activeDays)} día(s) con registros (fechas distintas, Masivo + Premium el mismo día cuenta 1).`] : [],
  });

  // --- Tendencia mensual (año completo, con filtro de sector) ---------------------------------------------------------
  const names = ctx.responsiblesScope != null;
  const nameRowsYear = ctx.responsiblesScope === "all" ? yearRows : ctx.responsiblesScope ? yearRows.filter((r) => r.sector === ctx.responsiblesScope) : [];

  // Columnas de responsables: los MAX_RESPONSIBLE_COLUMNS con más unidades del año + «Otros» + «Sin responsable».
  let columns: DashboardResponsibleColumn[] = [];
  const columnOf = new Map<string, string>();
  if (names) {
    const yearTotal = sumUnits(nameRowsYear);
    const groups = sortGroups(groupByResponsible(nameRowsYear));
    const identified = groups.filter((g) => !g.unassigned);
    const unassigned = groups.find((g) => g.unassigned);
    const top = identified.slice(0, MAX_RESPONSIBLE_COLUMNS);
    const rest = identified.slice(MAX_RESPONSIBLE_COLUMNS);
    const pct = (u: number) => (yearTotal > 0 ? round1((u / yearTotal) * 100) : 0);
    for (const g of top) {
      columns.push({ key: g.key, name: nameOf(g), yearUnits: g.units, yearShare: pct(g.units) });
      columnOf.set(g.key, g.key);
    }
    if (rest.length) {
      const u = rest.reduce((s, g) => s + g.units, 0);
      columns.push({ key: OTROS_RESPONSABLES_KEY, name: "Otros", yearUnits: u, yearShare: pct(u) });
      for (const g of rest) columnOf.set(g.key, OTROS_RESPONSABLES_KEY);
    }
    if (unassigned) {
      columns.push({ key: SIN_RESPONSABLE_KEY, name: SIN_RESPONSABLE_LABEL, yearUnits: unassigned.units, yearShare: pct(unassigned.units) });
      columnOf.set(SIN_RESPONSABLE_KEY, SIN_RESPONSABLE_KEY);
    }
  } else {
    columns = [];
  }

  const monthly: DashboardProductividadMonth[] = Array.from({ length: 12 }, (_, i) => {
    const mm = String(i + 1).padStart(2, "0");
    const inMonth = yearRows.filter((r) => r.metricDate.slice(5, 7) === mm);
    const byResponsible: Record<string, number> = {};
    if (names) {
      for (const r of nameRowsYear) {
        if (r.metricDate.slice(5, 7) !== mm) continue;
        const col = columnOf.get(responsibleGroupKey(r) ?? SIN_RESPONSABLE_KEY);
        if (col) byResponsible[col] = (byResponsible[col] ?? 0) + r.units;
      }
    }
    return {
      month: i + 1,
      masivo: sumUnits(inMonth.filter((r) => r.sector === "ENVASADO_MASIVO")),
      premium: sumUnits(inMonth.filter((r) => r.sector === "ENVASADO_PREMIUM")),
      total: sumUnits(inMonth),
      records: inMonth.length,
      variationPct: null,
      trend: null,
      byResponsible,
    };
  });
  for (let i = 1; i < monthly.length; i++) {
    const cur = monthly[i];
    const prev = monthly[i - 1];
    if (cur.records === 0 || prev.records === 0 || prev.total <= 0) continue;
    cur.variationPct = round1(((cur.total - prev.total) / prev.total) * 100);
    cur.trend = cur.total > prev.total ? "SUBE" : cur.total < prev.total ? "BAJA" : "IGUAL";
  }

  // Mes más productivo (del año, con filtro de sector; empate: el más temprano).
  let best: DashboardProductividadMonth | null = null;
  for (const m of monthly) if (m.total > 0 && (!best || m.total > best.total)) best = m;
  const bestMonth = metricKpi("envasado_mes_mas_productivo", `Año ${filters.year}`, {
    unit: "units",
    value: best ? best.total : null,
    valueLabel: best ? monthName(best.month) : undefined,
    sampleSize: yearRows.length,
    reason: `No hay registros de Métricas en ${filters.year}.`,
    notes: filters.month ? ["No depende del filtro de mes: compara los 12 meses del año."] : [],
  });

  // --- Responsables ---------------------------------------------------------------------------------------------------
  let responsibles: DashboardResponsibles;
  if (ctx.responsiblesScope == null) {
    responsibles = { available: false, reason: RESPONSIBLES_NOT_AVAILABLE_REASON };
  } else if (ctx.responsiblesScope !== "all" && filters.sector !== "ALL" && filters.sector !== ctx.responsiblesScope) {
    responsibles = { available: false, reason: RESPONSIBLES_OTHER_SECTOR_REASON };
  } else {
    const scoped = ctx.responsiblesScope === "all" ? periodRows : periodRows.filter((r) => r.sector === ctx.responsiblesScope);
    const scopedTotal = sumUnits(scoped);
    const sorted = sortGroups(groupByResponsible(scoped));
    const ranking = sorted.map((g) => toRow(g, scopedTotal));
    const identified = ranking.filter((r) => !r.unassigned);
    const podium = identified.filter((r) => r.units > 0).slice(0, 3);
    responsibles = {
      available: true,
      scopeLabel: ctx.responsiblesScope === "all" ? "Todos los sectores de Envasado" : `Solo tu sector (${ctx.responsiblesScope === "ENVASADO_MASIVO" ? "Envasado Masivo" : "Envasado Premium"})`,
      podium,
      ranking,
      best: identified.length ? identified[0] : null,
      worst: identified.length >= 2 ? identified[identified.length - 1] : null,
      columns,
      totalUnits: scopedTotal,
      unassignedUnits: ranking.find((r) => r.unassigned)?.units ?? 0,
    };
  }

  const notes: string[] = [];
  if (ctx.schemaPending) notes.push("La tabla de Métricas todavía no está disponible en la base: no hay datos de unidades envasadas.");
  const unassignedRecords = periodRows.filter((r) => responsibleGroupKey(r) == null).length;
  if (names && unassignedRecords > 0) notes.push(`${unassignedRecords} registro(s) sin responsable válido se agrupan como «${SIN_RESPONSABLE_LABEL}» y no se asignan a nadie.`);
  if (filters.sector !== "ALL") notes.push("Con filtro de sector solo se cuentan los registros de ese sector.");

  return {
    source: "metricas",
    periodLabel: periodLbl,
    year: filters.year,
    sector: filters.sector,
    schemaPending: Boolean(ctx.schemaPending),
    recordCount: periodRows.length,
    activeDays,
    kpis: {
      total: metricKpi("envasado_total", periodLbl, { unit: "units", value: hasData ? total : null, sampleSize: periodRows.length, reason: noData }),
      masivo: sectorKpi("envasado_masivo", "ENVASADO_MASIVO", masivo, masivoRows.length),
      premium: sectorKpi("envasado_premium", "ENVASADO_PREMIUM", premium, premiumRows.length),
      pctMasivo: shareKpi("envasado_pct_masivo", "ENVASADO_MASIVO", masivo),
      pctPremium: shareKpi("envasado_pct_premium", "ENVASADO_PREMIUM", premium),
      dailyAverage,
      bestMonth,
    },
    monthly,
    responsibles,
    notes,
  };
}
