/**
 * Dashboard operativo — tipos compartidos (cliente y servidor).
 *
 * Todo lo que viaja en el payload ya está recortado por el servidor según el nivel de acceso del actor:
 * un nivel «aggregate» NUNCA recibe nombres de clientes (ni ranking, ni comparación, ni lista de clientes).
 */

export type DashboardSectorFilter = "ALL" | "ENVASADO_MASIVO" | "ENVASADO_PREMIUM";
export const DASHBOARD_SECTOR_FILTERS: readonly DashboardSectorFilter[] = ["ALL", "ENVASADO_MASIVO", "ENVASADO_PREMIUM"];

/** Nivel de acceso: «full» (Producción/Dirección) ve clientes; «aggregate» solo agregados de planta. */
export type DashboardAccessLevel = "full" | "aggregate";

export type DashboardFilters = {
  year: number;
  /** 1–12 o null (año completo). */
  month: number | null;
  sector: DashboardSectorFilter;
  /** Nombre de cliente tal como lo muestra el ranking (se compara normalizado). Solo nivel «full». */
  client: string | null;
};

/** Qué fecha usa el indicador para ubicarse en el período. */
export type DashboardDateBasis = "pedido" | "produccion" | "entrega";

export const DATE_BASIS_LABELS: Record<DashboardDateBasis, string> = {
  pedido: "Fecha de pedido",
  produccion: "Fecha de producción",
  entrega: "Fecha de entrega",
};

/**
 * exacto: el dato existe tal cual en GENUS OS.
 * adaptado: se calcula con un criterio propuesto sobre datos que GENUS OS sí registra.
 * sin_datos: GENUS OS no registra lo necesario (o la muestra es insuficiente): no se calcula nada.
 */
export type DashboardAccuracy = "exacto" | "adaptado" | "sin_datos";

export type DashboardUnit = "percent" | "days" | "units" | "count";

export type DashboardKpiKey =
  | "nivel_servicio"
  | "sin_reclamos"
  | "lead_time"
  | "unidades_producidas"
  | "pedidos_activos"
  | "pedidos_entregados"
  | "pedidos_en_despacho"
  | "productos_distintos"
  | "clientes_activos";

export type DashboardKpi = {
  key: DashboardKpiKey;
  label: string;
  unit: DashboardUnit;
  /** null = «Sin datos suficientes» (ver reason). */
  value: number | null;
  /** Cantidad de registros que respaldan el valor (pedidos, entregas…). */
  sampleSize: number;
  dateBasis: DashboardDateBasis;
  /** Texto legible del período aplicado a ESTE indicador. */
  periodLabel: string;
  accuracy: DashboardAccuracy;
  /** Si value es null: por qué. */
  reason: string | null;
  /** Si value es null: qué habría que registrar para poder calcularlo. */
  toRecord: string | null;
  /** Qué filtros aplican a este indicador. */
  appliedFilters: { period: boolean; sector: boolean; client: boolean };
  /** Aclaraciones (registros excluidos, etc.). */
  notes: string[];
};

export type DashboardMonthlyPoint = { month: number; masivo: number; premium: number };

export type DashboardProduction = {
  masivo: number;
  premium: number;
  total: number;
  /** Participación 0–100; null si el total es 0. */
  masivoShare: number | null;
  premiumShare: number | null;
  monthly: DashboardMonthlyPoint[];
  periodLabel: string;
  dateBasis: DashboardDateBasis;
  /** Trabajos terminados que no se pudieron ubicar en el tiempo o sin cantidad (se informan, no se suman). */
  excludedWithoutDate: number;
  excludedWithoutQty: number;
  notes: string[];
};

export type DashboardClientRow = {
  client: string;
  pedidos: number;
  entregados: number;
  /** Lead time promedio en días (null = sin entregas válidas). */
  leadTimeDays: number | null;
  leadTimeSample: number;
  /** Nivel de servicio promedio en % (null = sin datos). */
  serviceLevel: number | null;
  serviceSample: number;
  unidades: number;
};

export type DashboardClients = {
  available: true;
  ranking: DashboardClientRow[];
  /** Clientes con menor lead time promedio (solo los que tienen muestra). */
  bestLeadTime: DashboardClientRow[];
  activeClients: DashboardKpi;
  periodLabel: string;
};

export type DashboardClientsBlock =
  | DashboardClients
  | { available: false; reason: string };

export type DashboardTarget = {
  key: string;
  targetValue: number;
  direction: "min" | "max";
  unit: DashboardUnit;
  updatedBy: string;
  updatedAt: string;
};

export type DashboardLight = "verde" | "amarillo" | "rojo" | "sin_objetivo" | "sin_datos" | "no_aplica";

export type DashboardIndicatorKey = "nivel_servicio" | "sin_reclamos" | "lead_time" | "unidades_producidas";

export type DashboardIndicatorRow = {
  key: DashboardIndicatorKey;
  label: string;
  unit: DashboardUnit;
  result: number | null;
  target: DashboardTarget | null;
  light: DashboardLight;
  /** Texto del estado: «Cumple», «Atención», «Crítico», «Sin objetivo definido», «Sin datos suficientes»… */
  statusLabel: string;
  /** Motivo cuando no hay resultado o el semáforo no aplica. */
  note: string | null;
  /** Dirección sugerida al definir el objetivo por primera vez. */
  defaultDirection: "min" | "max";
};

export type DashboardPermissions = {
  level: DashboardAccessLevel;
  canEditTargets: boolean;
  canFilterClient: boolean;
  /** Sector propio de Envasado (para resaltarlo en pantalla); null en el resto. */
  ownSector: "ENVASADO_MASIVO" | "ENVASADO_PREMIUM" | null;
};

export type DashboardPayload = {
  header: {
    title: string;
    year: number;
    month: number | null;
    sector: DashboardSectorFilter;
    client: string | null;
    periodLabel: string;
    /** Momento en que se calculó (siempre ahora). */
    generatedAt: string;
    /** Último cambio registrado en los datos de origen (null si no hay datos). */
    lastDataChangeAt: string | null;
  };
  permissions: DashboardPermissions;
  filterOptions: { years: number[]; clients: string[] };
  main: {
    nivelServicio: DashboardKpi | NotAvailable;
    sinReclamos: DashboardKpi | NotAvailable;
    leadTime: DashboardKpi | NotAvailable;
    unidades: DashboardKpi;
  };
  pedidos: {
    total: number;
    activos: DashboardKpi;
    entregados: DashboardKpi;
    enDespacho: DashboardKpi;
    productosDistintos: DashboardKpi;
    sinEstado: number;
  };
  produccion: DashboardProduction;
  clients: DashboardClientsBlock;
  indicators: DashboardIndicatorRow[] | NotAvailable;
  /** Resumen gerencial determinístico (nada de IA); omite lo que no tiene datos. */
  summary: string[];
  targetsSchemaPending: boolean;
  dataSource: "database" | "memory" | "none";
};

/** Bloque que el sector no puede ver: el servidor no envía datos, solo el motivo. */
export type NotAvailable = { notAvailable: true; reason: string };

export function isNotAvailable(v: unknown): v is NotAvailable {
  return typeof v === "object" && v !== null && (v as NotAvailable).notAvailable === true;
}

// ---------------------------------------------------------------------------
// Filas de entrada de compute.ts (todas ya sin registros eliminados desde la consulta,
// pero compute vuelve a excluirlos por defensa).
// ---------------------------------------------------------------------------

export type DashboardPedidoRow = {
  id: string;
  /** YYYY-MM-DD. */
  fecha: string | null;
  cliente: string | null;
  producto: string | null;
  /** Estado crudo de production_pedidos.estado. */
  estado: string | null;
  q: number | null;
  deletedAt?: string | null;
};

export type DashboardWorkRow = {
  id: string;
  /** Sector que produjo (Envasado Masivo/Premium; si pasó por Codificado, el de origen). Otro valor = no cuenta. */
  productionSector: string | null;
  operationalStatus: string;
  cancelled: boolean;
  /** Texto tal como lo cargó el sector. */
  finishedQty: string | null;
  packagingTotalUnits: number | null;
  client: string | null;
  product: string | null;
  productionPedidoId: string | null;
  /** ISO timestamp de cierre de la producción. */
  completedAt: string | null;
  deletedAt?: string | null;
};

export type DashboardDeliveryRow = {
  id: string;
  workItemId: string;
  sourceSector: string;
  client: string | null;
  /** production_pedido_id de la entrega o, si falta, el del trabajo. */
  pedidoId: string | null;
  /** ISO timestamp de la entrega real. */
  actualDeliveredAt: string;
  /** ENTREGADO | ANULADO | REGISTRO_ELIMINADO */
  status: string;
  deletedAt?: string | null;
};

export type DashboardRows = {
  pedidos: DashboardPedidoRow[];
  works: DashboardWorkRow[];
  deliveries: DashboardDeliveryRow[];
};
