export type PlanningWeekStatus = "DRAFT" | "PUBLISHED";

export type PlanningSector =
  | "ELABORACION"
  | "ENVASADO_MASIVO"
  | "ENVASADO_PREMIUM";

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
  client: string;
  product: string;
  plannedQuantity: string;
  unit: string;
  sector: PlanningSector;
  line: string | null;
  branchOwner: string | null;
  priority: PlanningPriority;
  notes: string | null;
  status: PlanningWorkItemStatus;
  publishedAt: string | null;
  createdBy: string;
  source: "native" | "import_sheets";
  originRef: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
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
  client: string;
  product: string;
  plannedQuantity: string;
  unit?: string;
  sector: PlanningSector;
  line?: string | null;
  branchOwner?: string | null;
  priority?: PlanningPriority;
  notes?: string | null;
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
