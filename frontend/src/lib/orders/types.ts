/** Tipos de dominio para órdenes OE/OA nativas (persistencia Neon). */

import type { SectorId } from "@/types/operational/sector";

export type OrderDocType = "OE" | "OA";

export type OrderStatus =
  | "BORRADOR"
  | "PENDIENTE"
  | "EN_PROCESO"
  | "COMPLETA"
  | "DEVUELTA_PARA_CORRECCION"
  | "ANULADA"
  | "ARCHIVADA";

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
  ajuste: string;
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
    operarios: string;
  };
  rendimientos: {
    produccionTeoricaUnidades: number | null;
    contenidoTeorico: string;
    fecha: string;
    cantidadUnidades: number | null;
    rendimientoA: number | null;
    rangoTeorico: "95-101%";
  };
  observaciones: string;
  controlesPeso: {
    limiteTexto: "Limite inferior/ superior: +/- 5 %";
    fecha: string;
    inicio: string;
    medio: string;
    final: string;
  };
  /** Texto legal fijo — no editable en órdenes comunes. */
  etiquetadoCodificadoLegalText: "Codificar en la hoja lote y vencimiento, como se realiza en el envase y firmar fecha del responsable.";
  etiquetadoCodificado: {
    notas: string;
    fechaResponsable: string;
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
  previousVersionId: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
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
  assignedSector: SectorId;
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
  templateId: string;
  product?: string;
  client?: string;
  code?: string;
  lot?: string;
  assignedSector: SectorId;
  formOverrides?: Partial<OrderContent>;
  linkedWorkItemId?: string | null;
};

export type ListOrdersFilters = {
  type?: OrderDocType;
  tab?: "pendientes" | "completas" | "all";
  search?: string;
  status?: OrderStatus;
  assignedSector?: SectorId;
  product?: string;
  client?: string;
  year?: number;
  month?: number;
  dateFrom?: string;
  dateTo?: string;
  sort?:
    | "fecha_desc"
    | "fecha_asc"
    | "producto"
    | "numero"
    | "entrega_desc";
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
  "ARCHIVADA",
];

export const OA_ETIQUETADO_LEGAL_TEXT =
  "Codificar en la hoja lote y vencimiento, como se realiza en el envase y firmar fecha del responsable." as const;
