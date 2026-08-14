/**
 * Agregación pura del reporte gerencial — recibe filas ya traídas de Neon
 * (una sola consulta por tabla, ver data-fetch.ts) y calcula todos los
 * indicadores en memoria. Sin acceso a red/DB acá: 100% testeable con
 * datasets controlados (ver analytics.test.ts — caso Trabajo A/B/C).
 *
 * Reglas que este archivo respeta a propósito (ver informe de la fase):
 *  - "Entregable"/"acondicionado" = deliverableUnits (packedUnits real,
 *    embalado en cajas — regla definitiva de muestras-como-metadata, ver
 *    packing-math.ts) cuando existe cierre físico; si no, cae a
 *    finishedQty/packagingTotalUnits — un trabajo histórico sin cierre no
 *    es "0 muestras", es "sin dato". Muestras (sampleUnits) es metadata
 *    interna que se reporta aparte (columna "muestras"/hoja MUESTRAS) pero
 *    NUNCA se resta de estas cantidades.
 *  - "Tiempo efectivo de trabajo" NO se calcula: no existe un timestamp de
 *    inicio real (progressUpdatedAt se sobreescribe en cada guardado, no es
 *    un registro histórico). Lo que sí es real y se reporta es el lead time
 *    calendario createdAt→completedAt, etiquetado como tal — nunca como
 *    "horas trabajadas".
 *  - Motivos de rechazo de Calidad = texto libre tal cual quedó registrado
 *    (qualityObservation) — no se inventan categorías.
 *  - Unidades/hora excluye divisiones por 0/NaN/Infinity.
 */
import { isIntegerUnit, parseArDecimal, parseArInteger } from "@/lib/utils/ar-number-parsing";
import { resolveWorkItemDeliverableUnits } from "@/lib/remitos/packing-math";
import type {
  CalidadRow,
  ClienteRow,
  DatoRow,
  DeliveryReportRow,
  EmpleadoRow,
  EntregaAgregadaRow,
  KpiRow,
  ManagementReportData,
  MuestraRow,
  PedidoAgregadoRow,
  ProductividadRow,
  ProductoRow,
  ReportDataset,
  ReportFilters,
  SectorRow,
  TiempoRow,
  WorkItemReportRow,
} from "./types";

function effectiveUnits(row: WorkItemReportRow): number | null {
  if (row.deliverableUnits != null && Number.isFinite(row.deliverableUnits)) {
    return row.deliverableUnits;
  }
  if (row.finishedQty?.trim()) {
    const parsed = isIntegerUnit(row.unit)
      ? parseArInteger(row.finishedQty)
      : parseArDecimal(row.finishedQty);
    if (parsed.ok && parsed.value != null) return parsed.value;
  }
  // Último fallback (packagingTotalUnits) delegado a la fuente única
  // compartida con remito/Entregados — mismo criterio en todo el sistema.
  return resolveWorkItemDeliverableUnits({
    deliverableUnits: null,
    packagingTotalUnits: row.packagingTotalUnits,
  });
}

function acondicionadoUnits(row: WorkItemReportRow): number | null {
  const units = effectiveUnits(row);
  if (units == null) return null;
  return units + (row.sampleUnits ?? 0);
}

function hoursBetween(a: Date | null, b: Date | null): number | null {
  if (!a || !b) return null;
  const ms = b.getTime() - a.getTime();
  if (!(ms > 0)) return null;
  const hours = ms / 3_600_000;
  return Number.isFinite(hours) ? hours : null;
}

function safeDivide(a: number, b: number): number | null {
  if (!(b > 0)) return null;
  const v = a / b;
  return Number.isFinite(v) ? v : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function matchesFilters(row: WorkItemReportRow, filters: ReportFilters): boolean {
  if (filters.client && row.client !== filters.client) return false;
  if (filters.product && row.product !== filters.product) return false;
  if (filters.sector && row.sector !== filters.sector) return false;
  if (filters.employee) {
    const emp = filters.employee;
    const matches = [row.createdBy, row.completedBy, row.progressUpdatedBy, row.qualityDecidedBy].some(
      (v) => v === emp
    );
    if (!matches) return false;
  }
  return true;
}

function average(values: number[]): number | null {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return null;
  return finite.reduce((a, b) => a + b, 0) / finite.length;
}

export function buildManagementReport(
  dataset: ReportDataset,
  filters: ReportFilters
): ManagementReportData {
  const workItems = dataset.workItems.filter((r) => matchesFilters(r, filters));

  // ---- CLIENTES / PRODUCTOS -------------------------------------------
  const clienteMap = new Map<string, { trabajos: number; entregable: number; muestras: number }>();
  const productoMap = new Map<string, { trabajos: number; entregable: number; muestras: number }>();
  const sectorMap = new Map<string, { trabajos: number; entregable: number; unidadesPorHora: number[] }>();
  const empleadoMap = new Map<
    string,
    { trabajos: number; entregable: number; unidadesPorHora: number[]; sectores: Set<string> }
  >();

  let totalEntregable = 0;
  let totalMuestras = 0;

  for (const row of workItems) {
    const units = effectiveUnits(row) ?? 0;
    const muestras = row.sampleUnits ?? 0;
    totalEntregable += units;
    totalMuestras += muestras;

    const c = clienteMap.get(row.client) ?? { trabajos: 0, entregable: 0, muestras: 0 };
    c.trabajos += 1;
    c.entregable += units;
    c.muestras += muestras;
    clienteMap.set(row.client, c);

    const p = productoMap.get(row.product) ?? { trabajos: 0, entregable: 0, muestras: 0 };
    p.trabajos += 1;
    p.entregable += units;
    p.muestras += muestras;
    productoMap.set(row.product, p);

    const leadHours = hoursBetween(row.createdAt, row.completedAt);
    const uph = leadHours != null && units > 0 ? safeDivide(units, leadHours) : null;

    const s = sectorMap.get(row.sector) ?? { trabajos: 0, entregable: 0, unidadesPorHora: [] };
    s.trabajos += 1;
    s.entregable += units;
    if (uph != null) s.unidadesPorHora.push(uph);
    sectorMap.set(row.sector, s);

    const empleadoKey = row.completedBy || row.progressUpdatedBy || row.createdBy;
    if (empleadoKey) {
      const e = empleadoMap.get(empleadoKey) ?? {
        trabajos: 0,
        entregable: 0,
        unidadesPorHora: [],
        sectores: new Set<string>(),
      };
      e.trabajos += 1;
      e.entregable += units;
      if (uph != null) e.unidadesPorHora.push(uph);
      e.sectores.add(row.sector);
      empleadoMap.set(empleadoKey, e);
    }
  }

  const clientes: ClienteRow[] = [...clienteMap.entries()]
    .map(([cliente, v]) => ({
      cliente,
      trabajos: v.trabajos,
      unidadesEntregables: round2(v.entregable),
      muestras: v.muestras,
      participacionPct: totalEntregable > 0 ? round2((v.entregable / totalEntregable) * 100) : 0,
    }))
    .sort((a, b) => b.unidadesEntregables - a.unidadesEntregables);

  const productos: ProductoRow[] = [...productoMap.entries()]
    .map(([producto, v]) => ({
      producto,
      trabajos: v.trabajos,
      unidadesEntregables: round2(v.entregable),
      muestras: v.muestras,
    }))
    .sort((a, b) => b.unidadesEntregables - a.unidadesEntregables);

  const sectores: SectorRow[] = [...sectorMap.entries()]
    .map(([sector, v]) => ({
      sector,
      trabajos: v.trabajos,
      unidadesEntregables: round2(v.entregable),
      unidadesPorHoraProm: v.unidadesPorHora.length ? round2(average(v.unidadesPorHora)!) : null,
      horasPor1000Prom: v.unidadesPorHora.length
        ? round2(average(v.unidadesPorHora.map((u) => 1000 / u))!)
        : null,
    }))
    .sort((a, b) => b.unidadesEntregables - a.unidadesEntregables);

  const empleados: EmpleadoRow[] = [...empleadoMap.entries()]
    .map(([empleado, v]) => ({
      empleado,
      trabajos: v.trabajos,
      unidadesEntregables: round2(v.entregable),
      unidadesPorHoraProm: v.unidadesPorHora.length ? round2(average(v.unidadesPorHora)!) : null,
      sectores: [...v.sectores].sort(),
    }))
    .sort((a, b) => b.trabajos - a.trabajos);

  // ---- PRODUCTIVIDAD / TIEMPOS ------------------------------------------
  const productividad: ProductividadRow[] = workItems.map((row) => {
    const units = effectiveUnits(row);
    const leadHours = hoursBetween(row.createdAt, row.completedAt);
    const uph = units != null && leadHours != null ? safeDivide(units, leadHours) : null;
    return {
      workItemId: row.id,
      cliente: row.client,
      producto: row.product,
      sector: row.sector,
      unidadesEntregables: units,
      leadTimeHoras: leadHours != null ? round2(leadHours) : null,
      unidadesPorHora: uph != null ? round2(uph) : null,
      horasPor1000: units != null && units > 0 && uph != null ? round2((1000 / uph)) : null,
    };
  });

  const tiempos: TiempoRow[] = workItems.map((row) => ({
    workItemId: row.id,
    cliente: row.client,
    producto: row.product,
    leadTimeCalendarioHoras: (() => {
      const h = hoursBetween(row.createdAt, row.completedAt);
      return h != null ? round2(h) : null;
    })(),
    codificadoDwellHoras: (() => {
      const h = hoursBetween(row.sentToCodificadoAt, row.deliveredFromCodificadoAt);
      return h != null ? round2(h) : null;
    })(),
    calidadDecisionHoras: (() => {
      const h = hoursBetween(row.completedAt, row.qualityDecidedAt);
      return h != null ? round2(h) : null;
    })(),
  }));

  // ---- CALIDAD -----------------------------------------------------------
  const decided = workItems.filter((r) => r.qualityStatus === "aprobado" || r.qualityStatus === "rechazado");
  const aprobados = decided.filter((r) => r.qualityStatus === "aprobado").length;
  const tasaAprobacionPct = decided.length > 0 ? round2((aprobados / decided.length) * 100) : null;
  const primeraDecisionAprobados = decided.filter(
    (r) => r.qualityStatus === "aprobado" && !r.qualityChangeReason
  ).length;
  const firstPassQualityPct =
    decided.length > 0 ? round2((primeraDecisionAprobados / decided.length) * 100) : null;

  const calidad: CalidadRow[] = decided.map((row) => ({
    workItemId: row.id,
    cliente: row.client,
    producto: row.product,
    qualityStatus: row.qualityStatus,
    primeraDecision: !row.qualityChangeReason,
    observacion: row.qualityObservation?.trim() || null,
  }));

  // ---- MUESTRAS ------------------------------------------------------
  const muestrasMap = new Map<string, { muestras: number; producido: number }>();
  for (const row of workItems) {
    const key = `${row.client}|||${row.product}`;
    const m = muestrasMap.get(key) ?? { muestras: 0, producido: 0 };
    const acond = acondicionadoUnits(row);
    if (row.sampleUnits != null) m.muestras += row.sampleUnits;
    if (acond != null) m.producido += acond;
    muestrasMap.set(key, m);
  }
  const muestras: MuestraRow[] = [...muestrasMap.entries()]
    .filter(([, v]) => v.muestras > 0)
    .map(([key, v]) => {
      const [cliente, producto] = key.split("|||");
      return {
        cliente,
        producto,
        muestras: v.muestras,
        producido: round2(v.producido),
        muestrasPct: v.producido > 0 ? round2((v.muestras / v.producido) * 100) : null,
      };
    })
    .sort((a, b) => b.muestras - a.muestras);

  // ---- PEDIDOS ---------------------------------------------------------
  const pedidosInRange = dataset.pedidos.filter(
    (p) => p.fecha != null && p.fecha >= filters.from && p.fecha <= filters.to
  );
  const pedidoMap = new Map<string, { cantidad: number; kg: number }>();
  for (const p of pedidosInRange) {
    const estado = p.estado?.trim() || "SIN_ESTADO";
    const v = pedidoMap.get(estado) ?? { cantidad: 0, kg: 0 };
    v.cantidad += 1;
    v.kg += p.kg ?? 0;
    pedidoMap.set(estado, v);
  }
  const pedidos: PedidoAgregadoRow[] = [...pedidoMap.entries()]
    .map(([estado, v]) => ({ estado, cantidad: v.cantidad, kgTotal: round2(v.kg) }))
    .sort((a, b) => b.cantidad - a.cantidad);

  // ---- ENTREGAS ----------------------------------------------------------
  const workItemIdsInScope = new Set(workItems.map((r) => r.id));
  const deliveriesInRange = dataset.deliveries.filter(
    (d) =>
      d.status === "ENTREGADO" &&
      d.actualDeliveredAt.toISOString().slice(0, 10) >= filters.from &&
      d.actualDeliveredAt.toISOString().slice(0, 10) <= filters.to &&
      (workItemIdsInScope.size === 0 || workItemIdsInScope.has(d.workItemId))
  );
  const entregaMap = new Map<string, { entregas: number; unidades: number }>();
  for (const d of deliveriesInRange) {
    const cliente = d.client || "Sin cliente";
    const v = entregaMap.get(cliente) ?? { entregas: 0, unidades: 0 };
    v.entregas += 1;
    const parsed = parseArDecimal(d.quantity ?? "");
    if (parsed.ok && parsed.value != null) v.unidades += parsed.value;
    entregaMap.set(cliente, v);
  }
  const entregas: EntregaAgregadaRow[] = [...entregaMap.entries()]
    .map(([cliente, v]) => ({ cliente, entregas: v.entregas, unidades: round2(v.unidades) }))
    .sort((a, b) => b.entregas - a.entregas);

  // ---- DATOS (detalle granular) ------------------------------------------
  const datos: DatoRow[] = workItems.map((row) => ({
    workItemId: row.id,
    cliente: row.client,
    producto: row.product,
    sector: row.sector,
    status: row.status,
    qualityStatus: row.qualityStatus,
    plannedDate: row.plannedDate,
    deliveryDate: row.deliveryDate,
    unidadesAcondicionadas: acondicionadoUnits(row),
    unidadesEntregables: effectiveUnits(row),
    muestras: row.sampleUnits,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  }));

  // ---- RESUMEN + KPIs ------------------------------------------------
  const topCliente = clientes[0]?.cliente ?? null;
  const topProducto = productos[0]?.producto ?? null;

  const overdue = workItems.filter(
    (r) =>
      r.deliveryDate != null &&
      r.deliveryDate < filters.to &&
      !r.completedAt &&
      r.operationalStatus !== "cancelado"
  ).length;
  const wip = workItems.filter(
    (r) => r.operationalStatus === "en_curso" || r.operationalStatus === "bloqueado"
  ).length;
  const cancelados = workItems.filter((r) => r.operationalStatus === "cancelado").length;
  const top3Share =
    totalEntregable > 0
      ? round2(
          (clientes.slice(0, 3).reduce((sum, c) => sum + c.unidadesEntregables, 0) / totalEntregable) * 100
        )
      : null;

  const kpis: KpiRow[] = [
    { categoria: "General", indicador: "Trabajos en el período", valor: workItems.length, unidad: "trabajos", disponible: true },
    { categoria: "General", indicador: "Unidades entregables totales", valor: round2(totalEntregable), unidad: "un.", disponible: true },
    { categoria: "General", indicador: "Muestras totales", valor: totalMuestras, unidad: "un.", disponible: true },
    { categoria: "General", indicador: "Trabajos cancelados", valor: cancelados, unidad: "trabajos", disponible: true },
    { categoria: "General", indicador: "Trabajos en curso (WIP)", valor: wip, unidad: "trabajos", disponible: true },
    {
      categoria: "General",
      indicador: "Trabajos vencidos (fecha de entrega superada, sin completar)",
      valor: overdue,
      unidad: "trabajos",
      disponible: true,
    },
    {
      categoria: "Concentración",
      indicador: "Participación Top 3 clientes",
      valor: top3Share,
      unidad: "%",
      disponible: top3Share != null,
      motivoNoDisponible: top3Share == null ? "Sin unidades entregables en el período." : undefined,
    },
    {
      categoria: "Calidad",
      indicador: "Tasa de aprobación",
      valor: tasaAprobacionPct,
      unidad: "%",
      disponible: tasaAprobacionPct != null,
      motivoNoDisponible: tasaAprobacionPct == null ? "Sin decisiones de Calidad en el período." : undefined,
    },
    {
      categoria: "Calidad",
      indicador: "First-pass quality (aprobado sin corrección previa)",
      valor: firstPassQualityPct,
      unidad: "%",
      disponible: firstPassQualityPct != null,
      motivoNoDisponible: firstPassQualityPct == null ? "Sin decisiones de Calidad en el período." : undefined,
    },
    {
      categoria: "Tiempos",
      indicador: "Tiempo efectivo de trabajo (horas-persona reales)",
      valor: null,
      unidad: "h",
      disponible: false,
      motivoNoDisponible:
        "No existe timestamp de inicio real distinto de la creación/asignación (progressUpdatedAt se sobreescribe en cada guardado, no es histórico). Se reporta en su lugar el lead time calendario (hoja TIEMPOS).",
    },
    {
      categoria: "Tiempos",
      indicador: "Capacidad utilizada (% de capacidad instalada)",
      valor: null,
      unidad: "%",
      disponible: false,
      motivoNoDisponible: "No hay datos de capacidad/dotación por sector en el sistema.",
    },
    {
      categoria: "Calidad",
      indicador: "Tasa de retrabajo",
      valor: null,
      unidad: "%",
      disponible: false,
      motivoNoDisponible:
        "No existe un flag de \"retrabajo\" distinto del rechazo de Calidad. Ver codificadoRevision por trabajo en la hoja DATOS como indicador relacionado (reenvíos a Codificado).",
    },
  ];

  return {
    filters,
    generatedAt: new Date().toISOString(),
    resumen: {
      totalTrabajos: workItems.length,
      totalEntregable: round2(totalEntregable),
      totalMuestras,
      tasaAprobacionCalidadPct: tasaAprobacionPct,
      topCliente,
      topProducto,
    },
    kpis,
    clientes,
    productos,
    sectores,
    empleados,
    productividad,
    tiempos,
    calidad,
    pedidos,
    entregas,
    inventario: dataset.meMaterials,
    muestras,
    datos,
  };
}
