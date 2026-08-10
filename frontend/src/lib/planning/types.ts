export type PlanningWeekStatus = "DRAFT" | "PUBLISHED";

export type PlanningSector =
  | "ELABORACION"
  | "ENVASADO_MASIVO"
  | "ENVASADO_PREMIUM"
  | "CODIFICADO";

export type PlanningWorkItemStatus =
  | "BORRADOR"
  | "PLANIFICADO"
  | "PUBLICADO"
  | "ESPERANDO_MATERIALES"
  | "LISTO_PARA_INICIAR"
  | "EN_PROCESO"
  | "BLOQUEADO"
  | "TERMINADO_SECTOR"
  | "PENDIENTE_CALIDAD"
  | "RECHAZADO_CALIDAD"
  | "APROBADO_CALIDAD"
  | "LIBERADO"
  | "CANCELADO";

export type PlanningPriority =
  | "URGENTE"
  | "HOY"
  | "ESTA_SEMANA"
  | "NORMAL"
  | "BAJA";

export type BranchOwner = "Cristian" | "Nicolás";

export type EnvasadoLine = "Línea 1" | "Línea 2" | "Línea 3" | "Línea 4";

export interface PlanningActor {
  email: string;
  sector: string;
  displayName: string;
}

export interface PlanningWeekRecord {
  id: string;
  weekStart: string;
  label: string;
  status: PlanningWeekStatus;
  publishedAt: string | null;
  createdBy: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlanningWorkItemRecord {
  id: string;
  planningWeekId: string;
  plannedDate: string;
  /** Fin inclusive del rango de aparición (null = solo plannedDate). */
  plannedDateTo?: string | null;
  client: string;
  product: string;
  plannedQuantity: string;
  unit: string;
  sector: PlanningSector;
  line: string | null;
  branchOwner: string | null;
  priority: PlanningPriority;
  /** Observaciones libres — NO guardar lote/VTO aquí. */
  notes: string | null;
  packagingLote?: string | null;
  packagingVto?: string | null;
  packagingTotalUnits?: number | null;
  packingGroups?: unknown;
  /** Cierre físico de acondicionamiento (0024). */
  sampleUnits?: number | null;
  deliverableUnits?: number | null;
  packagingClosedAt?: string | null;
  packagingClosedBy?: string | null;
  orderId?: string | null;
  orderNumber?: string | null;
  deliveryDate?: string | null;
  status: PlanningWorkItemStatus;
  publishedAt: string | null;
  createdBy: string;
  source: "native" | "import_sheets";
  originRef: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  /** Flujo Codificado durable (0014/0021). */
  viaCodificado?: boolean;
  sentToCodificadoAt?: string | null;
  sentToCodificadoBy?: string | null;
  codificadoOriginSector?: string | null;
  deliveredFromCodificadoAt?: string | null;
  deliveredFromCodificadoBy?: string | null;
  codificadoObservation?: string | null;
  bulkRemainderKg?: number | null;
  bulkRemainderObservation?: string | null;
  bulkRemainderId?: string | null;
  homeLine?: string | null;
  homeBranchOwner?: string | null;
  codificadoRevision?: number;
  codificadoCancelledAt?: string | null;
  productionPedidoId?: string | null;
  /** Avance operativo durable (0023) — reemplaza overlay en memoria. */
  operationalStatus?: string;
  finishedQty?: string | null;
  operationalObservation?: string | null;
  packingMismatchObservation?: string | null;
  progressUpdatedAt?: string | null;
  progressUpdatedBy?: string | null;
  completedAt?: string | null;
  completedBy?: string | null;
  operationalCancelledAt?: string | null;
  operationalCancelledBy?: string | null;
  operationalCancelReason?: string | null;
  qualityStatus?: string;
  qualityDecidedAt?: string | null;
  qualityDecidedBy?: string | null;
  qualityDecidedBySector?: string | null;
  qualityObservation?: string | null;
  qualityChangeReason?: string | null;
}

export interface OperationalEventRecord {
  id: string;
  workItemId: string | null;
  planningWeekId: string | null;
  type: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorEmail: string;
  actorSector: string;
  note: string | null;
  createdAt: string;
}

export interface CreateWeekInput {
  weekStart: string;
  label?: string;
}

export interface CreateWorkItemInput {
  plannedDate: string;
  /** Fin inclusive opcional del rango de aparición. */
  plannedDateTo?: string | null;
  client: string;
  product: string;
  plannedQuantity: string;
  unit?: string;
  sector: PlanningSector;
  line?: string | null;
  branchOwner?: string | null;
  priority?: PlanningPriority;
  notes?: string | null;
  originRef?: string | null;
}

export interface PatchWorkItemInput {
  version: number;
  plannedDate?: string;
  client?: string;
  product?: string;
  plannedQuantity?: string;
  unit?: string;
  sector?: PlanningSector;
  line?: string | null;
  branchOwner?: string | null;
  priority?: PlanningPriority;
  notes?: string | null;
}

export class PlanningConflictError extends Error {
  readonly code = "VERSION_CONFLICT";
  readonly status = 409;
  constructor(
    message: string,
    public readonly current: PlanningWeekRecord | PlanningWorkItemRecord
  ) {
    super(message);
    this.name = "PlanningConflictError";
  }
}

export class PlanningValidationError extends Error {
  readonly code = "VALIDATION_ERROR";
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "PlanningValidationError";
  }
}

export class PlanningNotFoundError extends Error {
  readonly code = "NOT_FOUND";
  readonly status = 404;
  constructor(message: string) {
    super(message);
    this.name = "PlanningNotFoundError";
  }
}

export class PlanningForbiddenError extends Error {
  readonly code = "FORBIDDEN";
  readonly status = 403;
  constructor(message: string) {
    super(message);
    this.name = "PlanningForbiddenError";
  }
}

/** OA existente con datos incompatibles — UI puede forzar vínculo (solo rellena vacíos). */
export class PlanningOaCompatibilityError extends Error {
  readonly code = "OA_DATA_MISMATCH";
  readonly status = 409;
  constructor(
    message: string,
    public readonly details: {
      orderNumber: string;
      orderId: string;
      mismatches: Array<{ field: string; existing: string; incoming: string }>;
      canForce: true;
    }
  ) {
    super(message);
    this.name = "PlanningOaCompatibilityError";
  }
}
