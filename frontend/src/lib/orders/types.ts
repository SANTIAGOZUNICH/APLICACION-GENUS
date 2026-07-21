/** Tipos de dominio para órdenes OE/OA nativas (persistencia Neon). */

import type { SectorId } from "@/types/operational/sector";

export type OrderDocType = "OE" | "OA";

export type OrderStatus =
  | "BORRADOR"
  | "PENDIENTE"
  | "EN_PROCESO"
  | "COMPLETA"
  | "COMPLETA_CON_PENDIENTES"
  | "DEVUELTA_PARA_CORRECCION"
  | "ANULADA"
  | "ARCHIVADA";

/** Sector asignado de una orden; SIN_ASIGNAR = borrador sin destino. */
export type OrderAssignedSector = SectorId | "SIN_ASIGNAR";

export type TemplateStatus = "VIGENTE" | "OBSOLETA";

export type ProposalStatus = "PENDIENTE" | "APROBADA" | "RECHAZADA";

export type OrdersActor = {
  email: string;
  sector: SectorId;
  displayName: string;
};

export type OeMaterialRow = {
  id: string;
  materiaPrima: string;
  codigo: string;
  formulaPct: number | null;
  kgAPesar: number | null;
  /**
   * Ajuste (+/- kg) respecto de kg teóricos a pesar.
   * Kg real utilizado = kgAPesar + ajuste.
   */
  ajuste: number | null;
  ajusteMotivo: string;
  ajusteAt: string | null;
  ajusteBy: string | null;
  lote: string;
};

export type OeProcedureStep = {
  id: string;
  text: string;
};

export type OeContent = {
  kind: "OE";
  title: "OE";
  productType: "PT";
  header: {
    productName: string;
    code: string;
    date: string;
    quantityKg: number | null;
    lot: string;
    vigencia: string;
    client: string;
    envaseCubica: string;
    equipoCalefactor: string;
  };
  materials: OeMaterialRow[];
  totals: {
    formulaPctSum: number | null;
    kgSum: number | null;
    ajusteSum: number | null;
    kgRealSum: number | null;
    diferenciaPct: number | null;
    cantidadReal: number | null;
    mermaPct: number | null;
    cantidadObtenida: number | null;
  };
  cleaning: { notes: string };
  samples: { notes: string };
  procedureTitle: "PROCEDIMIENTO DE ELABORACIÓN";
  procedureSteps: OeProcedureStep[];
  processControl: {
    date: string;
    aspecto: string;
    aspectoSpec: string;
    color: string;
    colorSpec: string;
    olor: string;
    olorSpec: string;
    ph: string;
    phSpec: string;
    viscosidad: string;
    viscosidadSpec: string;
    cantidadReal: number | null;
    mermaPct: number | null;
    cantidadObtenida: number | null;
    fechaFin: string;
  };
  qualityControl: {
    ensayo: string;
    resultado: string;
    fecha: string;
  };
  /** Firmas físicas — siempre vacías; no se almacenan imágenes. */
  signatures: {
    pesada: null;
    limpieza: null;
    muestras: null;
    calidad: null;
    produccion: null;
    controlCalidad: null;
    direccionTecnica: null;
  };
};

export type OaMaterialRow = {
  id: string;
  nro: number;
  codigo: string;
  nombreInsumo: string;
  recibidos: string;
  desechados: string;
  usados: string;
  fecha: string;
  responsable: string;
};

export type OaOperarioRow = {
  id: string;
  nombre: string;
  sector: string;
};

export type OaCargaParcialRow = {
  id: string;
  fecha: string;
  cantidadUnidades: number | null;
};

export type OaPesoControlRow = {
  id: string;
  fecha: string;
  inicio: string;
  medio: string;
  final: string;
};

export type OaContent = {
  kind: "OA";
  title: "ORDEN DE ACONDICIONAMIENTO";
  header: {
    productName: string;
    client: string;
    lot: string;
    analisis: string;
    productCode: string;
    vto: string;
    aprobo: string;
    fechaEmision: string;
  };
  analisisGranel: {
    resultado: string;
    aprobado: boolean | null;
  };
  materials: OaMaterialRow[];
  materialsFecha: string;
  envasado: {
    fechaInicio: string;
    fechaTerminacion: string;
    /** Texto legado / resumen. */
    operarios: string;
    operariosList: OaOperarioRow[];
  };
  rendimientos: {
    produccionTeoricaUnidades: number | null;
    contenidoTeorico: string;
    fecha: string;
    /** Total llenadas (suma de cargas parciales). */
    cantidadUnidades: number | null;
    unidadesDesechadas: number | null;
    unidadesAceptadas: number | null;
    rendimientoA: number | null;
    rangoTeorico: "95-101%";
    cargasParciales: OaCargaParcialRow[];
  };
  observaciones: string;
  controlesPeso: {
    limiteTexto: "Limite inferior/ superior: +/- 5 %";
    /** Campos legado (primera fila). */
    fecha: string;
    inicio: string;
    medio: string;
    final: string;
    filas: OaPesoControlRow[];
  };
  /** Texto legal fijo — no editable en órdenes comunes. */
  etiquetadoCodificadoLegalText: "Codificar en la hoja lote y vencimiento, como se realiza en el envase y firmar fecha del responsable.";
  etiquetadoCodificado: {
    notas: string;
    fechaResponsable: string;
    loteCodificado: string;
    vencimientoCodificado: string;
    fechaControl: string;
    responsable: string;
    observaciones: string;
    resultado: "" | "CONFORME" | "NO_CONFORME";
  };
  analisisProductoTerminado: {
    resultado: string;
  };
  signatures: {
    granel: null;
    pesoInicio: null;
    pesoMedio: null;
    pesoFinal: null;
    productoTerminado: null;
    autorizacionProduccion: null;
    autorizacionControlCalidad: null;
    autorizacionDireccionTecnica: null;
  };
};

export type OrderContent = OeContent | OaContent;

export type OrderTemplateRecord = {
  id: string;
  type: OrderDocType;
  productId: string;
  productName: string;
  productCode: string;
  brandClient: string | null;
  version: number;
  status: TemplateStatus;
  content: OrderContent;
  changeReason: string | null;
  /** Origen del archivo de referencia (si aplica). Persistido en changeReason / meta. */
  sourceFile?: string | null;
  previousVersionId: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateTemplateInput = {
  type: OrderDocType;
  productName: string;
  productCode: string;
  brandClient?: string | null;
  productId?: string;
  content?: OrderContent;
  changeReason?: string;
  sourceFile?: string | null;
};

export type DuplicateTemplateInput = {
  templateId: string;
  productName?: string;
  productCode?: string;
  brandClient?: string | null;
  changeReason?: string;
};

export type OperationalOrderRecord = {
  id: string;
  orderNumber: string;
  type: OrderDocType;
  templateId: string;
  templateVersion: number;
  templateSnapshot: OrderContent;
  product: string;
  client: string;
  code: string;
  lot: string;
  assignedSector: OrderAssignedSector;
  status: OrderStatus;
  formData: OrderContent;
  completionPercentage: number;
  revision: number;
  version: number;
  linkedWorkItemId: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  completedAt: string | null;
  completedBy: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
};

export type OrderVersionRecord = {
  id: string;
  orderId: string;
  version: number;
  snapshot: OperationalOrderRecord;
  event: string;
  reason: string | null;
  createdBy: string;
  createdAt: string;
};

export type TemplateChangeProposalRecord = {
  id: string;
  templateId: string;
  orderId: string | null;
  proposedChanges: OrderContent;
  proposedBy: string;
  proposedAt: string;
  status: ProposalStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
};

export type OrderAuditEventRecord = {
  id: string;
  orderId: string | null;
  eventType: string;
  actor: string;
  actorSector: string;
  metadata: Record<string, unknown> | null;
  timestamp: string;
};

export type OsNotificationRecord = {
  id: string;
  kind: string;
  title: string;
  message: string;
  sectors: SectorId[];
  href: string | null;
  orderId: string | null;
  readBy: string[];
  dismissedBy: string[];
  createdAt: string;
};

export type CreateOrderInput = {
  type: OrderDocType;
  templateId?: string;
  product?: string;
  client?: string;
  code?: string;
  lot?: string;
  assignedSector?: OrderAssignedSector;
  formOverrides?: Partial<OrderContent>;
  linkedWorkItemId?: string | null;
  /** Crear como borrador vacío (sin exigir plantilla ni datos). */
  emptyDraft?: boolean;
};

export type ListOrdersFilters = {
  type?: OrderDocType;
  tab?: "pendientes" | "completas" | "all";
  search?: string;
  status?: OrderStatus;
  assignedSector?: OrderAssignedSector;
  product?: string;
  client?: string;
  year?: number;
  month?: number;
  dateFrom?: string;
  dateTo?: string;
  /** Filtros de borradores vacíos / sin datos */
  emptyProduct?: boolean;
  emptyClient?: boolean;
  emptyLot?: boolean;
  unassigned?: boolean;
  createdBy?: string;
  emptyDraft?: boolean;
  sort?:
    | "fecha_desc"
    | "fecha_asc"
    | "producto"
    | "numero"
    | "entrega_desc"
    | "updated_desc";
  page?: number;
  pageSize?: number;
};

export type PatchOrderInput = {
  expectedVersion: number;
  formData: OrderContent;
  lot?: string;
  client?: string;
  code?: string;
  product?: string;
};

export class OrdersValidationError extends Error {
  readonly status = 400;
  readonly code = "ORDERS_VALIDATION";
  constructor(message: string) {
    super(message);
    this.name = "OrdersValidationError";
  }
}

export class OrdersForbiddenError extends Error {
  readonly status = 403;
  readonly code = "ORDERS_FORBIDDEN";
  constructor(message: string) {
    super(message);
    this.name = "OrdersForbiddenError";
  }
}

export class OrdersNotFoundError extends Error {
  readonly status = 404;
  readonly code = "ORDERS_NOT_FOUND";
  constructor(message: string) {
    super(message);
    this.name = "OrdersNotFoundError";
  }
}

export class OrdersConflictError extends Error {
  readonly status = 409;
  readonly code = "ORDERS_CONFLICT";
  readonly current: OperationalOrderRecord;
  constructor(message: string, current: OperationalOrderRecord) {
    super(message);
    this.name = "OrdersConflictError";
    this.current = current;
  }
}

export class OrdersUnavailableError extends Error {
  readonly status = 503;
  readonly code = "DATABASE_UNAVAILABLE";
  constructor(message = "Neon DATABASE_URL no configurada. Órdenes legales requieren persistencia compartida.") {
    super(message);
    this.name = "OrdersUnavailableError";
  }
}

export const PENDING_STATUSES: OrderStatus[] = [
  "BORRADOR",
  "PENDIENTE",
  "EN_PROCESO",
  "DEVUELTA_PARA_CORRECCION",
];

export const COMPLETE_STATUSES: OrderStatus[] = [
  "COMPLETA",
  "COMPLETA_CON_PENDIENTES",
  "ARCHIVADA",
];

export const OA_ETIQUETADO_LEGAL_TEXT =
  "Codificar en la hoja lote y vencimiento, como se realiza en el envase y firmar fecha del responsable." as const;
