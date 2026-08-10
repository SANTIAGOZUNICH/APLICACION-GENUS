import type { SectorId } from "@/types/operational/sector";

/** Filtros del reporte gerencial — rango obligatorio, resto opcional. */
export type ReportFilters = {
  /** ISO YYYY-MM-DD, inclusive. */
  from: string;
  /** ISO YYYY-MM-DD, inclusive. */
  to: string;
  client?: string;
  product?: string;
  sector?: SectorId;
  /** Email o nombre visible — matchea createdBy/completedBy/progressUpdatedBy/qualityDecidedBy. */
  employee?: string;
};

/** Fila cruda de work_items necesaria para el reporte (sin server-only). */
export type WorkItemReportRow = {
  id: string;
  client: string;
  product: string;
  sector: string;
  status: string;
  operationalStatus: string;
  qualityStatus: string;
  plannedDate: string;
  deliveryDate: string | null;
  createdAt: Date;
  completedAt: Date | null;
  finishedQty: string | null;
  unit: string;
  packagingTotalUnits: number | null;
  deliverableUnits: number | null;
  sampleUnits: number | null;
  packagingClosedAt: Date | null;
  packagingClosedBy: string | null;
  createdBy: string;
  completedBy: string | null;
  progressUpdatedBy: string | null;
  qualityDecidedAt: Date | null;
  qualityDecidedBy: string | null;
  qualityObservation: string | null;
  qualityChangeReason: string | null;
  sentToCodificadoAt: Date | null;
  deliveredFromCodificadoAt: Date | null;
  bulkRemainderKg: number | null;
  operationalCancelledAt: Date | null;
};

export type DeliveryReportRow = {
  id: string;
  workItemId: string;
  product: string;
  codigo: string | null;
  client: string | null;
  lote: string | null;
  quantity: string | null;
  unit: string | null;
  actualDeliveredAt: Date;
  status: "ENTREGADO" | "ANULADO" | "REGISTRO_ELIMINADO";
  deliveredBy: string;
  deliveredBySector: string;
};

export type PedidoReportRow = {
  id: string;
  fecha: string | null;
  cliente: string | null;
  producto: string | null;
  estado: string | null;
  kg: number | null;
  ml: number | null;
  q: number | null;
};

export type MeMaterialReportRow = {
  codigo: string;
  nombre: string | null;
  stockActual: number | null;
};

export type ReportDataset = {
  workItems: WorkItemReportRow[];
  deliveries: DeliveryReportRow[];
  pedidos: PedidoReportRow[];
  meMaterials: MeMaterialReportRow[];
};

/** Un renglón de KPI con disponibilidad explícita — nunca se inventa un valor. */
export type KpiRow = {
  categoria: string;
  indicador: string;
  valor: number | string | null;
  unidad: string;
  disponible: boolean;
  motivoNoDisponible?: string;
};

export type ClienteRow = {
  cliente: string;
  trabajos: number;
  unidadesEntregables: number;
  muestras: number;
  participacionPct: number;
};

export type ProductoRow = {
  producto: string;
  trabajos: number;
  unidadesEntregables: number;
  muestras: number;
};

export type SectorRow = {
  sector: string;
  trabajos: number;
  unidadesEntregables: number;
  unidadesPorHoraProm: number | null;
  horasPor1000Prom: number | null;
};

export type EmpleadoRow = {
  empleado: string;
  trabajos: number;
  unidadesEntregables: number;
  unidadesPorHoraProm: number | null;
  sectores: string[];
};

export type ProductividadRow = {
  workItemId: string;
  cliente: string;
  producto: string;
  sector: string;
  unidadesEntregables: number | null;
  leadTimeHoras: number | null;
  unidadesPorHora: number | null;
  horasPor1000: number | null;
};

export type TiempoRow = {
  workItemId: string;
  cliente: string;
  producto: string;
  leadTimeCalendarioHoras: number | null;
  codificadoDwellHoras: number | null;
  calidadDecisionHoras: number | null;
};

export type CalidadRow = {
  workItemId: string;
  cliente: string;
  producto: string;
  qualityStatus: string;
  primeraDecision: boolean;
  observacion: string | null;
};

export type PedidoAgregadoRow = {
  estado: string;
  cantidad: number;
  kgTotal: number;
};

export type EntregaAgregadaRow = {
  cliente: string;
  entregas: number;
  unidades: number;
};

export type MuestraRow = {
  cliente: string;
  producto: string;
  muestras: number;
  producido: number;
  muestrasPct: number | null;
};

export type DatoRow = {
  workItemId: string;
  cliente: string;
  producto: string;
  sector: string;
  status: string;
  qualityStatus: string;
  plannedDate: string;
  deliveryDate: string | null;
  unidadesAcondicionadas: number | null;
  unidadesEntregables: number | null;
  muestras: number | null;
  createdAt: string;
  completedAt: string | null;
};

export type ManagementReportData = {
  filters: ReportFilters;
  generatedAt: string;
  resumen: {
    totalTrabajos: number;
    totalEntregable: number;
    totalMuestras: number;
    tasaAprobacionCalidadPct: number | null;
    topCliente: string | null;
    topProducto: string | null;
  };
  kpis: KpiRow[];
  clientes: ClienteRow[];
  productos: ProductoRow[];
  sectores: SectorRow[];
  empleados: EmpleadoRow[];
  productividad: ProductividadRow[];
  tiempos: TiempoRow[];
  calidad: CalidadRow[];
  pedidos: PedidoAgregadoRow[];
  entregas: EntregaAgregadaRow[];
  inventario: MeMaterialReportRow[];
  muestras: MuestraRow[];
  datos: DatoRow[];
};
