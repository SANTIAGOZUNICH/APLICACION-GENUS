/**
 * Dashboard operativo — cálculo PURO (sin DB, sin red, sin reloj implícito).
 * Recibe filas ya leídas de GENUS OS y devuelve el payload completo, ya recortado según el nivel de acceso.
 *
 * Regla de oro: nada inventado. Si falta un dato o la muestra es insuficiente, el indicador queda con
 * `value: null` + motivo + qué habría que registrar. Los criterios están en `kpi-definitions.ts` y en
 * `docss/58-dashboard-operativo.md` (criterio propuesto, pendiente de validar contra la planilla).
 */
import { normalizeStatus } from "@/lib/production-pedidos/types";
import { fmtDays, fmtInt, fmtPercent, monthName, periodText } from "./format";
import { DASHBOARD_KPI_DEFINITIONS, TARGETABLE_INDICATORS, type TargetableKey } from "./kpi-definitions";
import { CLIENTS_NOT_AVAILABLE_REASON, NOT_AVAILABLE_FOR_SECTOR, resolveDashboardPermissions } from "./permissions";
import { LIGHT_LABELS, evaluateLight } from "./semaforo";
import type {
  DashboardAccessLevel,
  DashboardClientRow,
  DashboardClientsBlock,
  DashboardFilters,
  DashboardIndicatorRow,
  DashboardKpi,
  DashboardKpiKey,
  DashboardLight,
  DashboardMonthlyPoint,
  DashboardPayload,
  DashboardPedidoRow,
  DashboardProduction,
  DashboardRows,
  DashboardTarget,
  DashboardWorkRow,
  NotAvailable,
} from "./types";

// ---------------------------------------------------------------------------
// Constantes del criterio (documentadas)
// ---------------------------------------------------------------------------

export const PRODUCTION_SECTORS = ["ENVASADO_MASIVO", "ENVASADO_PREMIUM"] as const;
/** Entregas que cuentan para el lead time: producto terminado (no el granel de Elaboración). */
export const LEAD_TIME_DELIVERY_SECTORS: readonly string[] = ["ENVASADO_MASIVO", "ENVASADO_PREMIUM", "CODIFICADO"];
/** Estados operativos de un trabajo que indican que la producción terminó. */
const DONE_STATUSES: ReadonlySet<string> = new Set([
  "completo",
  "entregado",
  "revision",
  "codificado_completo",
  "en_codificado",
]);
/** Igual que la planilla local: solo plazos > 0 y < 100 días entran al promedio. */
export const LEAD_TIME_MIN_EXCLUSIVE = 0;
export const LEAD_TIME_MAX_EXCLUSIVE = 100;
const AR_UTC_OFFSET_MS = -3 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Clave de comparación: sin tildes, minúsculas, espacios colapsados. null si queda vacío. */
export function normKey(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const k = String(raw)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return k || null;
}

/** Cantidad cargada como texto (acepta «1.200», «1200», «1.200,5», «12,5»). null si no es un número. */
export function parseQty(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let t = String(raw).trim().replace(/\s/g, "");
  if (!t) return null;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else t = t.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Fecha calendario (YYYY-MM-DD) en hora de Argentina (UTC-3, sin horario de verano) de un timestamp ISO. */
export function toArDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Date(ms + AR_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

function cleanDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(raw));
  return m ? m[1] : null;
}

export function daysBetween(fromDate: string, toDate: string): number {
  const a = Date.UTC(+fromDate.slice(0, 4), +fromDate.slice(5, 7) - 1, +fromDate.slice(8, 10));
  const b = Date.UTC(+toDate.slice(0, 4), +toDate.slice(5, 7) - 1, +toDate.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

function avg(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export type DashboardComputeContext = {
  level: DashboardAccessLevel;
  sector: string;
  targets: DashboardTarget[];
  /** Momento del cálculo (ISO). */
  generatedAt: string;
  lastDataChangeAt: string | null;
  targetsSchemaPending: boolean;
  dataSource: "database" | "memory" | "none";
};

// ---------------------------------------------------------------------------
// Armado de indicadores
// ---------------------------------------------------------------------------

type KpiOverrides = Partial<Omit<DashboardKpi, "key" | "label" | "unit" | "dateBasis" | "accuracy">> & {
  unit?: DashboardKpi["unit"];
};

function makeKpi(
  key: DashboardKpiKey,
  periodLabel: string,
  filters: { period: boolean; sector: boolean; client: boolean },
  o: KpiOverrides
): DashboardKpi {
  const def = DASHBOARD_KPI_DEFINITIONS[key];
  const hasValue = o.value != null;
  return {
    key,
    label: def.label,
    unit: o.unit ?? "count",
    value: o.value ?? null,
    sampleSize: o.sampleSize ?? 0,
    dateBasis: def.dateBasis,
    periodLabel,
    accuracy: hasValue ? def.accuracy : "sin_datos",
    reason: hasValue ? null : (o.reason ?? "Sin datos suficientes."),
    toRecord: hasValue ? null : (o.toRecord ?? null),
    appliedFilters: filters,
    notes: o.notes ?? [],
  };
}

const PEDIDO_ACTIVE_STATES = new Set(["INGRESO", "EN_ELABORACION", "EN_ENVASADO", "EN_CODIFICADO"]);

type ProducedRow = { sector: string; date: string; qty: number; productKey: string | null; clientKey: string | null };

type ServiceRow = { pedidoId: string; clientKey: string | null; ratio: number; date: string };
type LeadRow = { pedidoId: string; clientKey: string | null; days: number; date: string };

export function computeDashboard(rows: DashboardRows, filters: DashboardFilters, ctx: DashboardComputeContext): DashboardPayload {
  const full = ctx.level === "full";
  const clientKeyFilter = full && filters.client ? normKey(filters.client) : null;
  const perm = resolveDashboardPermissions(ctx.sector);
  const periodLbl = periodText(filters.year, filters.month);
  const yearStr = String(filters.year);
  const monthStr = filters.month ? String(filters.month).padStart(2, "0") : null;
  const inPeriod = (date: string | null): boolean => {
    if (!date) return false;
    if (date.slice(0, 4) !== yearStr) return false;
    return monthStr ? date.slice(5, 7) === monthStr : true;
  };

  // --- Normalización de filas (excluye eliminados / cancelados / anulados) ----------------------------------------
  const allPedidos = rows.pedidos.filter((p) => !p.deletedAt);
  const pedidoById = new Map(allPedidos.map((p) => [p.id, p]));
  const pedidosScoped = clientKeyFilter ? allPedidos.filter((p) => normKey(p.cliente) === clientKeyFilter) : allPedidos;
  const scopedIds = new Set(pedidosScoped.map((p) => p.id));

  const validWorks = rows.works.filter(
    (w) => !w.deletedAt && !w.cancelled && w.operationalStatus !== "cancelado" && (PRODUCTION_SECTORS as readonly string[]).includes(String(w.productionSector))
  );
  const isDone = (w: DashboardWorkRow) => Boolean(w.completedAt) || DONE_STATUSES.has(w.operationalStatus);
  const workQty = (w: DashboardWorkRow): number | null => {
    const q = parseQty(w.finishedQty);
    if (q != null && q > 0) return q;
    if (w.packagingTotalUnits != null && Number.isFinite(w.packagingTotalUnits) && w.packagingTotalUnits > 0) return w.packagingTotalUnits;
    return null;
  };

  // --- Producción (fecha de producción = cierre del trabajo) -------------------------------------------------------
  let excludedWithoutDate = 0;
  let excludedWithoutQty = 0;
  const produced: ProducedRow[] = [];
  for (const w of validWorks) {
    if (!isDone(w)) continue;
    const ck = normKey(w.client);
    if (clientKeyFilter && ck !== clientKeyFilter) continue;
    const date = toArDate(w.completedAt);
    const qty = workQty(w);
    if (!date) {
      excludedWithoutDate++;
      continue;
    }
    if (qty == null) {
      excludedWithoutQty++;
      continue;
    }
    produced.push({ sector: String(w.productionSector), date, qty, productKey: normKey(w.product), clientKey: ck });
  }
  const producedInYear = produced.filter((r) => r.date.slice(0, 4) === yearStr);
  const producedInPeriod = produced.filter((r) => inPeriod(r.date));
  const sumQty = (list: ProducedRow[], sector?: string) =>
    list.reduce((s, r) => (sector && r.sector !== sector ? s : s + r.qty), 0);

  const monthly: DashboardMonthlyPoint[] = Array.from({ length: 12 }, (_, i) => {
    const mm = String(i + 1).padStart(2, "0");
    const inMonth = producedInYear.filter((r) => r.date.slice(5, 7) === mm);
    return { month: i + 1, masivo: sumQty(inMonth, "ENVASADO_MASIVO"), premium: sumQty(inMonth, "ENVASADO_PREMIUM") };
  });
  const masivo = sumQty(producedInPeriod, "ENVASADO_MASIVO");
  const premium = sumQty(producedInPeriod, "ENVASADO_PREMIUM");
  const totalBoth = masivo + premium;
  const prodNotes: string[] = [];
  if (excludedWithoutDate > 0)
    prodNotes.push(`${excludedWithoutDate} trabajo(s) terminado(s) sin fecha de cierre no se pudieron ubicar en el tiempo y no se suman.`);
  if (excludedWithoutQty > 0)
    prodNotes.push(`${excludedWithoutQty} trabajo(s) terminado(s) sin cantidad final cargada no se suman.`);
  const produccion: DashboardProduction = {
    masivo,
    premium,
    total: totalBoth,
    masivoShare: totalBoth > 0 ? round1((masivo / totalBoth) * 100) : null,
    premiumShare: totalBoth > 0 ? round1((premium / totalBoth) * 100) : null,
    monthly,
    periodLabel: periodLbl,
    dateBasis: "produccion",
    excludedWithoutDate,
    excludedWithoutQty,
    notes: prodNotes,
  };

  // Unidades / productos distintos respetan el filtro de sector.
  const sectorScoped = filters.sector === "ALL" ? producedInPeriod : producedInPeriod.filter((r) => r.sector === filters.sector);
  const prodFilters = { period: true, sector: true, client: full };
  const unidades = makeKpi("unidades_producidas", periodLbl, prodFilters, {
    unit: "units",
    value: sectorScoped.length ? sumQty(sectorScoped) : null,
    sampleSize: sectorScoped.length,
    notes: prodNotes,
    reason: "No hay trabajos de Envasado terminados con fecha de cierre y cantidad final cargadas en el período.",
    toRecord: "Que el sector complete el trabajo con la cantidad final (queda la fecha de cierre automáticamente).",
  });
  const distinctProducts = new Set(sectorScoped.map((r) => r.productKey).filter((k): k is string => k != null));
  const productosDistintos = makeKpi("productos_distintos", periodLbl, prodFilters, {
    unit: "count",
    value: sectorScoped.length ? distinctProducts.size : null,
    sampleSize: sectorScoped.length,
    reason: "No hay trabajos de Envasado terminados con fecha de cierre y cantidad final cargadas en el período.",
    toRecord: "Que el sector complete el trabajo con la cantidad final.",
  });

  // --- Pedidos (fecha de pedido) ------------------------------------------------------------------------------------
  const pedidosInPeriod = pedidosScoped.filter((p) => inPeriod(cleanDate(p.fecha)));
  const pedidosNoDate = pedidosScoped.filter((p) => !cleanDate(p.fecha)).length;
  let nActivos = 0;
  let nDespacho = 0;
  let nEntregados = 0;
  let nSinEstado = 0;
  for (const p of pedidosInPeriod) {
    const st = normalizeStatus(p.estado);
    if (!st) nSinEstado++;
    else if (st === "ENTREGADO") nEntregados++;
    else if (st === "LISTO_PARA_ENTREGAR") nDespacho++;
    else if (PEDIDO_ACTIVE_STATES.has(st)) nActivos++;
  }
  const pedFilters = { period: true, sector: false, client: full };
  const pedNotes: string[] = [];
  if (nSinEstado > 0) pedNotes.push(`${nSinEstado} pedido(s) sin estado reconocible no entran en ningún grupo.`);
  if (pedidosNoDate > 0) pedNotes.push(`${pedidosNoDate} pedido(s) sin fecha de pedido no se pueden ubicar en el período.`);
  if (filters.sector !== "ALL") pedNotes.push("El filtro de sector no aplica a pedidos (el pedido no tiene sector).");
  const noPedidosReason = "No hay pedidos con fecha de pedido en el período.";
  const noPedidosToRecord = "Cargar los pedidos en «Pedidos» con su fecha.";
  const pedidoKpi = (key: DashboardKpiKey, n: number): DashboardKpi =>
    makeKpi(key, periodLbl, pedFilters, {
      unit: "count",
      value: pedidosInPeriod.length ? n : null,
      sampleSize: pedidosInPeriod.length,
      notes: pedNotes,
      reason: noPedidosReason,
      toRecord: noPedidosToRecord,
    });
  const pedidos = {
    total: pedidosInPeriod.length,
    activos: pedidoKpi("pedidos_activos", nActivos),
    entregados: pedidoKpi("pedidos_entregados", nEntregados),
    enDespacho: pedidoKpi("pedidos_en_despacho", nDespacho),
    productosDistintos,
    sinEstado: nSinEstado,
  };

  // --- Años disponibles ---------------------------------------------------------------------------------------------
  const yearSet = new Set<number>();
  for (const p of allPedidos) {
    const d = cleanDate(p.fecha);
    if (d) yearSet.add(+d.slice(0, 4));
  }
  for (const r of produced) yearSet.add(+r.date.slice(0, 4));
  for (const d of rows.deliveries) {
    const ad = toArDate(d.actualDeliveredAt);
    if (ad) yearSet.add(+ad.slice(0, 4));
  }
  const nowYear = +(toArDate(ctx.generatedAt) ?? ctx.generatedAt).slice(0, 4);
  if (Number.isFinite(nowYear)) yearSet.add(nowYear);
  yearSet.add(filters.year);
  const years = [...yearSet].filter((y) => Number.isFinite(y)).sort((a, b) => b - a);

  // Nombre a mostrar de un cliente: la escritura más frecuente en los pedidos (empate: orden alfabético estable).
  const nameCounts = new Map<string, Map<string, number>>();
  if (full) {
    for (const p of allPedidos) {
      const k = normKey(p.cliente);
      if (!k || !p.cliente) continue;
      const display = p.cliente.trim().replace(/\s+/g, " ");
      const m = nameCounts.get(k) ?? new Map<string, number>();
      m.set(display, (m.get(display) ?? 0) + 1);
      nameCounts.set(k, m);
    }
  }
  const displayOf = (k: string): string => {
    const m = nameCounts.get(k);
    if (!m) return k;
    return [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0][0];
  };

  // --- Indicadores de servicio (solo nivel full) --------------------------------------------------------------------
  let nivelServicio: DashboardKpi | NotAvailable = { notAvailable: true, reason: NOT_AVAILABLE_FOR_SECTOR };
  let sinReclamos: DashboardKpi | NotAvailable = { notAvailable: true, reason: NOT_AVAILABLE_FOR_SECTOR };
  let leadTime: DashboardKpi | NotAvailable = { notAvailable: true, reason: NOT_AVAILABLE_FOR_SECTOR };
  let clients: DashboardClientsBlock = { available: false, reason: CLIENTS_NOT_AVAILABLE_REASON };
  const serviceRows: ServiceRow[] = [];
  const leadRows: LeadRow[] = [];

  if (full) {
    // Nivel de servicio por pedido: unidades producidas / unidades pedidas.
    const worksByPedido = new Map<string, DashboardWorkRow[]>();
    for (const w of validWorks) {
      if (!w.productionPedidoId) continue;
      const list = worksByPedido.get(w.productionPedidoId) ?? [];
      list.push(w);
      worksByPedido.set(w.productionPedidoId, list);
    }
    let svcExcludedIncomplete = 0;
    let svcExcludedData = 0;
    let svcNoQ = 0;
    for (const p of pedidosScoped) {
      const ws = worksByPedido.get(p.id);
      if (!ws?.length) continue;
      if (p.q == null || !(p.q > 0)) {
        svcNoQ++;
        continue;
      }
      if (!ws.every(isDone)) {
        svcExcludedIncomplete++;
        continue;
      }
      const dates = ws.map((w) => toArDate(w.completedAt));
      const qtys = ws.map(workQty);
      if (dates.some((d) => !d) || qtys.some((q) => q == null)) {
        svcExcludedData++;
        continue;
      }
      const date = (dates as string[]).sort().at(-1) as string;
      const total = (qtys as number[]).reduce((s, q) => s + q, 0);
      serviceRows.push({ pedidoId: p.id, clientKey: normKey(p.cliente), ratio: (total / p.q) * 100, date });
    }
    const svcInPeriod = serviceRows.filter((r) => inPeriod(r.date));
    const svcNotes: string[] = [];
    const over = svcInPeriod.filter((r) => r.ratio > 100).length;
    if (over > 0) svcNotes.push(`${over} pedido(s) con producción mayor a lo pedido (no se limita a 100 %).`);
    if (svcExcludedIncomplete > 0) svcNotes.push(`${svcExcludedIncomplete} pedido(s) con trabajos de Envasado sin terminar quedan afuera hasta que terminen.`);
    if (svcExcludedData > 0) svcNotes.push(`${svcExcludedData} pedido(s) con trabajos terminados sin fecha de cierre o sin cantidad final quedan afuera.`);
    if (svcNoQ > 0) svcNotes.push(`${svcNoQ} pedido(s) sin cantidad pedida (Q) quedan afuera.`);
    if (filters.sector !== "ALL") svcNotes.push("El filtro de sector no aplica a este indicador.");
    const svcAvg = avg(svcInPeriod.map((r) => r.ratio));
    nivelServicio = makeKpi("nivel_servicio", periodLbl, { period: true, sector: false, client: true }, {
      unit: "percent",
      value: svcAvg == null ? null : round1(svcAvg),
      sampleSize: svcInPeriod.length,
      notes: svcNotes,
      reason:
        "Ningún pedido del período tiene sus trabajos de Envasado terminados con cantidad pedida (Q), fecha de cierre y cantidad final.",
      toRecord:
        "Vincular los trabajos de Envasado al pedido, cargar la cantidad pedida (Q) del pedido y la cantidad final al completar el trabajo.",
    });

    // Reclamos: GENUS OS no registra reclamos de clientes.
    sinReclamos = makeKpi("sin_reclamos", periodLbl, { period: false, sector: false, client: false }, {
      unit: "percent",
      value: null,
      reason:
        "GENUS OS no registra reclamos de clientes. Los rechazos y «rehacer» de Calidad son internos y no equivalen a un reclamo, por eso no se usan.",
      toRecord:
        "Registrar los reclamos de clientes: un campo «reclamo» (sí/no, fecha y motivo) en cada pedido, o una tabla de reclamos vinculada al pedido.",
    });

    // Lead time por pedido: fecha de pedido → última entrega real.
    const lastDeliveryByPedido = new Map<string, string>();
    let unlinked = 0;
    for (const d of rows.deliveries) {
      if (d.deletedAt || d.status !== "ENTREGADO") continue;
      if (!LEAD_TIME_DELIVERY_SECTORS.includes(String(d.sourceSector))) continue;
      const ad = toArDate(d.actualDeliveredAt);
      if (!ad) continue;
      if (!d.pedidoId || !pedidoById.has(d.pedidoId)) {
        if (inPeriod(ad)) unlinked++;
        continue;
      }
      const prev = lastDeliveryByPedido.get(d.pedidoId);
      if (!prev || ad > prev) lastDeliveryByPedido.set(d.pedidoId, ad);
    }
    let ltNoFecha = 0;
    let ltOutliers = 0;
    for (const [pedidoId, delivered] of lastDeliveryByPedido) {
      if (!scopedIds.has(pedidoId)) continue;
      const p = pedidoById.get(pedidoId) as DashboardPedidoRow;
      const fecha = cleanDate(p.fecha);
      if (!fecha) {
        if (inPeriod(delivered)) ltNoFecha++;
        continue;
      }
      const days = daysBetween(fecha, delivered);
      if (!(days > LEAD_TIME_MIN_EXCLUSIVE && days < LEAD_TIME_MAX_EXCLUSIVE)) {
        if (inPeriod(delivered)) ltOutliers++;
        continue;
      }
      leadRows.push({ pedidoId, clientKey: normKey(p.cliente), days, date: delivered });
    }
    const ltInPeriod = leadRows.filter((r) => inPeriod(r.date));
    const ltNotes: string[] = [];
    if (ltOutliers > 0)
      ltNotes.push(
        `${ltOutliers} pedido(s) con plazo ≤ ${LEAD_TIME_MIN_EXCLUSIVE} o ≥ ${LEAD_TIME_MAX_EXCLUSIVE} días quedan afuera (mismo criterio que la planilla local).`
      );
    if (ltNoFecha > 0) ltNotes.push(`${ltNoFecha} pedido(s) entregados sin fecha de pedido quedan afuera.`);
    if (unlinked > 0) ltNotes.push(`${unlinked} entrega(s) del período no están vinculadas a un pedido y no entran.`);
    if (filters.sector !== "ALL") ltNotes.push("El filtro de sector no aplica a este indicador.");
    const ltAvg = avg(ltInPeriod.map((r) => r.days));
    leadTime = makeKpi("lead_time", periodLbl, { period: true, sector: false, client: true }, {
      unit: "days",
      value: ltAvg == null ? null : round1(ltAvg),
      sampleSize: ltInPeriod.length,
      notes: ltNotes,
      reason: "No hay entregas reales del período vinculadas a un pedido con fecha de pedido y plazo válido.",
      toRecord: "Registrar la entrega en «Entregados» desde un trabajo vinculado a su pedido (y que el pedido tenga fecha).",
    });

    // Clientes.
    const clientRowFor = (k: string): DashboardClientRow => {
      const peds = pedidosInPeriod.filter((p) => normKey(p.cliente) === k);
      const lt = ltInPeriod.filter((r) => r.clientKey === k).map((r) => r.days);
      const sv = svcInPeriod.filter((r) => r.clientKey === k).map((r) => r.ratio);
      const ltAvgC = avg(lt);
      const svAvgC = avg(sv);
      return {
        client: displayOf(k),
        pedidos: peds.length,
        entregados: peds.filter((p) => normalizeStatus(p.estado) === "ENTREGADO").length,
        leadTimeDays: ltAvgC == null ? null : round1(ltAvgC),
        leadTimeSample: lt.length,
        serviceLevel: svAvgC == null ? null : round1(svAvgC),
        serviceSample: sv.length,
        unidades: sumQty(sectorScoped.filter((r) => r.clientKey === k)),
      };
    };
    const pedidosByClient = new Map<string, number>();
    for (const p of pedidosInPeriod) {
      const k = normKey(p.cliente);
      if (k) pedidosByClient.set(k, (pedidosByClient.get(k) ?? 0) + 1);
    }
    const ranking = [...pedidosByClient.keys()]
      .map(clientRowFor)
      .sort((a, b) => b.pedidos - a.pedidos || a.client.localeCompare(b.client, "es"))
      .slice(0, 50);
    const ltClientKeys = new Set(ltInPeriod.map((r) => r.clientKey).filter((k): k is string => k != null));
    const bestLeadTime = [...ltClientKeys]
      .map(clientRowFor)
      .filter((r) => r.leadTimeDays != null)
      .sort((a, b) => (a.leadTimeDays as number) - (b.leadTimeDays as number) || a.client.localeCompare(b.client, "es"))
      .slice(0, 10);
    const clientsNoName = pedidosInPeriod.filter((p) => !normKey(p.cliente)).length;
    const activeNotes: string[] = [];
    if (clientsNoName > 0) activeNotes.push(`${clientsNoName} pedido(s) sin cliente no se asignan a ningún cliente.`);
    activeNotes.push("Los clientes se derivan de los pedidos (no existe una tabla de clientes); las unidades por cliente salen del cliente del trabajo.");
    clients = {
      available: true,
      ranking,
      bestLeadTime,
      activeClients: makeKpi("clientes_activos", periodLbl, { period: true, sector: false, client: true }, {
        unit: "count",
        value: pedidosByClient.size > 0 ? pedidosByClient.size : null,
        sampleSize: pedidosInPeriod.length,
        notes: activeNotes,
        reason: noPedidosReason,
        toRecord: noPedidosToRecord,
      }),
      periodLabel: periodLbl,
    };
  }

  // --- Indicadores con objetivo y semáforo --------------------------------------------------------------------------
  const targetMap = new Map(ctx.targets.map((t) => [t.key, t]));
  const indicatorRow = (key: TargetableKey, result: number | null, forcedLight?: DashboardLight, note?: string | null): DashboardIndicatorRow => {
    const meta = TARGETABLE_INDICATORS[key];
    const target = targetMap.get(key) ?? null;
    const light = forcedLight ?? evaluateLight(result, target);
    return {
      key,
      label: meta.label,
      unit: meta.unit,
      result,
      target,
      light,
      statusLabel: LIGHT_LABELS[light],
      note: note ?? null,
      defaultDirection: meta.defaultDirection,
    };
  };
  const unitsApplies = filters.month == null && filters.sector === "ALL" && clientKeyFilter == null;
  const unitsRow = indicatorRow(
    "unidades_producidas",
    unidades.value,
    !unitsApplies && unidades.value != null ? "no_aplica" : undefined,
    !unitsApplies ? "El objetivo de unidades es anual: se evalúa solo con «Año completo», sector «Todos» y sin cliente." : unidades.reason
  );
  let indicators: DashboardIndicatorRow[] | NotAvailable;
  if (full) {
    const nv = nivelServicio as DashboardKpi;
    const lt = leadTime as DashboardKpi;
    const sr = sinReclamos as DashboardKpi;
    indicators = [
      indicatorRow("nivel_servicio", nv.value, undefined, nv.reason),
      indicatorRow("sin_reclamos", null, "sin_datos", sr.reason),
      indicatorRow("lead_time", lt.value, undefined, lt.reason),
      unitsRow,
    ];
  } else {
    indicators = [unitsRow];
  }

  // --- Resumen gerencial determinístico ----------------------------------------------------------------------------
  const summary: string[] = [];
  if (unidades.value != null && filters.sector === "ALL") {
    const parts: string[] = [];
    if (produccion.masivoShare != null) parts.push(`Masivo ${fmtInt(masivo)} (${fmtPercent(produccion.masivoShare)})`);
    if (produccion.premiumShare != null) parts.push(`Premium ${fmtInt(premium)} (${fmtPercent(produccion.premiumShare)})`);
    summary.push(`En ${periodLbl} se produjeron ${fmtInt(unidades.value)} unidades${parts.length ? `: ${parts.join(" · ")}` : ""}.`);
  } else if (unidades.value != null) {
    const sectorLabel = filters.sector === "ENVASADO_MASIVO" ? "Envasado Masivo" : "Envasado Premium";
    summary.push(`En ${periodLbl} ${sectorLabel} produjo ${fmtInt(unidades.value)} unidades.`);
  }
  if (!filters.month && producedInYear.length > 0) {
    const best = monthly.reduce((b, m) => (m.masivo + m.premium > b.masivo + b.premium ? m : b), monthly[0]);
    if (best.masivo + best.premium > 0) summary.push(`El mes de mayor producción fue ${monthName(best.month)} con ${fmtInt(best.masivo + best.premium)} unidades.`);
  }
  if (pedidosInPeriod.length > 0) {
    summary.push(
      `Hay ${fmtInt(nActivos)} pedidos activos, ${fmtInt(nDespacho)} en despacho y ${fmtInt(nEntregados)} entregados sobre ${fmtInt(pedidosInPeriod.length)} pedidos de ${periodLbl}.`
    );
  }
  if (full) {
    const nv = nivelServicio as DashboardKpi;
    const lt = leadTime as DashboardKpi;
    const [nvRow, , ltRow] = indicators as DashboardIndicatorRow[];
    if (nv.value != null) {
      summary.push(
        `El nivel de servicio promedio es ${fmtPercent(nv.value)} (sobre ${nv.sampleSize} pedidos)${statusSuffix(nvRow)}.`
      );
    }
    if (lt.value != null) {
      summary.push(`El lead time promedio es ${fmtDays(lt.value)} (sobre ${lt.sampleSize} pedidos)${statusSuffix(ltRow)}.`);
    }
    if (clients.available) {
      const top = clients.ranking[0];
      if (top) summary.push(`El cliente con más pedidos es ${top.client} (${top.pedidos}).`);
      const best = clients.bestLeadTime[0];
      if (best && best.leadTimeDays != null) summary.push(`El menor lead time promedio es el de ${best.client} (${fmtDays(best.leadTimeDays)}).`);
    }
  }
  for (const row of indicators as DashboardIndicatorRow[]) {
    if (row.light === "rojo") summary.push(`Atención: «${row.label}» está en rojo respecto del objetivo definido.`);
  }

  return {
    header: {
      title: "Dashboard Operativo",
      year: filters.year,
      month: filters.month,
      sector: filters.sector,
      client: clientKeyFilter ? filters.client : null,
      periodLabel: periodLbl,
      generatedAt: ctx.generatedAt,
      lastDataChangeAt: ctx.lastDataChangeAt,
    },
    permissions: perm,
    filterOptions: {
      years,
      clients: full ? [...nameCounts.keys()].map(displayOf).sort((a, b) => a.localeCompare(b, "es")) : [],
    },
    main: { nivelServicio, sinReclamos, leadTime, unidades },
    pedidos,
    produccion,
    clients,
    indicators,
    summary,
    targetsSchemaPending: ctx.targetsSchemaPending,
    dataSource: ctx.dataSource,
  };
}

function statusSuffix(row: DashboardIndicatorRow | undefined): string {
  if (!row || !row.target) return "";
  if (row.light === "sin_datos" || row.light === "sin_objetivo" || row.light === "no_aplica") return "";
  const sym = row.target.direction === "min" ? "≥" : "≤";
  const v = row.unit === "percent" ? fmtPercent(row.target.targetValue) : row.unit === "days" ? fmtDays(row.target.targetValue) : fmtInt(row.target.targetValue);
  return ` — objetivo ${sym} ${v}: ${row.statusLabel}`;
}
