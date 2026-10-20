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
  userId?: string;
  email: string;
  sector: SectorId;
  displayName: string;
  sectorLabel?: string;
  jobTitle?: string;
  roleId?: string;
  roleLabel?: string;
};

export type OeMaterialRow = {
  id: string;
  materiaPrima: string;
  codigo: string;
  formulaPct: number | null;
  kgAPesar: number | null;
  /**
   * Diferencia (+/- kg) entre lo realmente utilizado y los kg teóricos a pesar. Se DERIVA de `kgReal`
   * (kgReal − kgAPesar, sumando los lotes adicionales de la misma MP); se conserva para el PDF/Excel y OE viejas.
   */
  ajuste: number | null;
  /** Observación del elaborador sobre la diferencia (opcional). */
  ajusteMotivo: string;
  ajusteAt: string | null;
  ajusteBy: string | null;
  lote: string;
  /**
   * CÓDIGO MP: código de la materia prima en Stock MP (el que se descuenta). Distinto de `codigo` (código de la
   * fórmula). Vacío hasta que se completa o se sugiere uno inequívoco del catálogo.
   */
  codigoMp: string;
  /**
   * KG REAL UTILIZADO, cargado por Elaboración. Es lo único que se descuenta del stock. Nunca se completa solo con
   * los kg teóricos: vacío (null) = todavía no informado.
   */
  kgReal: number | null;
  /**
   * Fila de LOTE ADICIONAL de la misma MP (cuando una MP se usa desde más de un lote): id de la fila de la fórmula.
   * Sin % ni kg a pesar propios; tiene su lote y sus kg reales.
   */
  parentRowId: string | null;
};

export type OeSheetKind = "tambor" | "olla" | "otro";
export type OeSheetStatus = "pendiente" | "en_elaboracion" | "elaborado" | "observado" | "aprobado";

/**
 * Hoja de elaboración dentro de UNA misma OE (un tambor, una olla u otra preparación). Misma fórmula que la OE
 * principal; sus propios kg, MP reales, lotes, responsable, incidencias e historial. Vive en form_data (sin
 * migración): las OE existentes no la tienen y siguen funcionando con la «hoja principal» de siempre.
 */
export type OeSheet = {
  /** Identificador interno único y permanente (nunca se reutiliza). */
  id: string;
  kind: OeSheetKind;
  /** Número/identificación libre («1», «A»). */
  number: string;
  name: string;
  kgPlanificados: number | null;
  kgElaborados: number | null;
  status: OeSheetStatus;
  operario: string;
  inicioAt: string;
  finAt: string;
  incidencias: string;
  observaciones: string;
  materials: OeMaterialRow[];
  createdAt: string;
  createdBy: string;
  history: Array<{ at: string; by: string; text: string }>;
};

export type OeProcedureStep = {
  id: string;
  text: string;
};

/**
 * Registro de una OE completada con datos secundarios pendientes (confirmación excepcional). El estado principal sigue
 * siendo COMPLETA; esto solo documenta qué faltaba, quién lo confirmó y qué se completó después.
 */
export type OeCompletionRecord = {
  pendingAtCompletion: string[];
  confirmedBy: string;
  confirmedAt: string;
  resolved: Array<{ field: string; by: string; at: string }>;
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
  /** Hojas de elaboración (tambores/ollas) de esta OE. Opcional: OE viejas no la tienen. */
  sheets?: OeSheet[];
  /** Solo si se completó con datos secundarios pendientes. */
  completion?: OeCompletionRecord;
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
  /**
   * Observación opcional al completar/entregar (solo Elaboración).
   * Vive en form_data JSON — no altera el PDF legal ni observaciones de OA.
   */
  deliveryObservation: string | null;
  deliveryObservationBy: string | null;
  deliveryObservationAt: string | null;
  /**
   * Preparación automática desde el trabajo asignado (fórmula, lote de fabricación, lotes MP y pendientes).
   * Opcional: OE viejas no lo tienen. Ver lib/orders/oe-auto-prep-rules.ts.
   */
  autoPrep?: OeAutoPrep;
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

export type OeAutoPrepFormulaStatus =
  | "ok"
  | "not_found"
  | "ambiguous"
  | "conflict"
  | "incomplete"
  | "error"
  | "missing_input"
  /** La OE ya tenía materias primas cargadas a mano: no se reemplazaron. */
  | "manual_content";

export type OeAutoPrep = {
  version: 1;
  preparedAt: string;
  preparedBy: string;
  reason: string;
  workItemId: string;
  workItemVersion: number | null;
  formula: {
    status: OeAutoPrepFormulaStatus;
    message: string;
    source?: "CACHE_NEON" | "DRIVE";
    formulaProductId?: string;
    formulaVersionId?: string;
    versionHash?: string;
    displayClient?: string;
    displayProduct?: string;
    driveFileId?: string;
    driveModifiedTime?: string | null;
    sourceSheet?: string;
    /** Huella de las materias primas cargadas por la preparación (detecta ediciones a mano después). */
    fingerprint?: string;
    /** Cliente||producto normalizados para los que se cargó la fórmula. */
    identity?: string;
  };
  lotFabricacion: { value: string; status: "ok" | "pendiente" };
  quantity: { kg: number | null; planned: string; unit: string; status: "ok" | "pendiente" };
  /** Lista legible de lo que falta, para el elaborador y Producción. */
  pendientes: string[];
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
  /** UUID interno del material ME (opcional). */
  materialId: string | null;
  cliente: string;
  unidad: string;
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
  /** Snapshot del banco privado (OE): no cambia si la maestra se actualiza. */
  formulaProductId: string | null;
  formulaVersionId: string | null;
  formulaVersionHash: string | null;
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
  /** Borrado (tombstone) — nunca DELETE físico. Ver deleteOa() en orders-service.ts. */
  deletedAt: string | null;
  deletedBy: string | null;
  deleteReason: string | null;
};

/**
 * Relaciones activas de una OA con otras entidades — usado por deleteOa()
 * para bloquear el borrado si dejaría trazabilidad rota. Ninguna de estas
 * relaciones es FK real en el schema (soft-references por id/orderNumber),
 * así que se resuelven con una consulta explícita, no con el ORM.
 */
export type OaReferenceSummary = {
  activeWorkItemCount: number;
  activeDeliveryCount: number;
  hasQualityDecision: boolean;
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
  /** Emails con eliminación definitiva (no restaurable). */
  deletedBy: string[];
  /** Destinatarios individuales (emails). null/ausente = todo el sector. */
  targetEmails?: string[] | null;
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
  /** Por defecto las OA/OE eliminadas (deletedAt) se excluyen. */
  includeDeleted?: boolean;
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
  /** Snapshot de fórmula maestra aplicado a esta OE (estable). */
  formulaProductId?: string | null;
  formulaVersionId?: string | null;
  formulaVersionHash?: string | null;
};

export class OrdersValidationError extends Error {
  readonly status = 400;
  readonly code: string = "ORDERS_VALIDATION";
  constructor(message: string, code?: string) {
    super(message);
    this.name = "OrdersValidationError";
    if (code) this.code = code;
  }
}

/** Datos de consumo de MP incompletos al entregar una OE: se informa cada fila a corregir; no se descuenta nada. */
export class MpConsumptionIncompleteError extends OrdersValidationError {
  readonly issues: Array<{ rowId: string; rowNumber: number; materiaPrima: string; field: string; message: string }>;
  constructor(issues: MpConsumptionIncompleteError["issues"]) {
    super(
      `No se puede entregar: faltan datos para descontar materias primas. ${issues.map((i) => i.message).join(" ")}`,
      "MP_CONSUMO_INCOMPLETO"
    );
    this.name = "MpConsumptionIncompleteError";
    this.issues = issues;
  }
}

/**
 * Stock de MP insuficiente al entregar una OE: no se entrega ni se descuenta nada. Solo Producción o Dirección pueden
 * autorizar la entrega dejando el stock en negativo, con motivo (queda auditado).
 */
export class MpStockShortageError extends OrdersValidationError {
  readonly shortages: Array<{ codigo: string; lote: string; disponible: number; requerido: number; faltante: number; tipo: "lote" | "codigo" }>;
  readonly canAuthorize: boolean;
  constructor(message: string, shortages: MpStockShortageError["shortages"], canAuthorize: boolean) {
    super(message, "MP_STOCK_SHORTAGE");
    this.name = "MpStockShortageError";
    this.shortages = shortages;
    this.canAuthorize = canAuthorize;
  }
}

/** Stock ME insuficiente al entregar OA — requiere confirmación + motivo. */
export class MeStockShortageError extends OrdersValidationError {
  readonly shortages: Array<{
    codigo: string;
    material: string;
    materialId: string | null;
    stockDisponible: number;
    cantidadSolicitada: number;
    diferencia: number;
  }>;
  constructor(
    message: string,
    shortages: MeStockShortageError["shortages"]
  ) {
    super(message, "ME_STOCK_SHORTAGE");
    this.name = "MeStockShortageError";
    this.shortages = shortages;
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
