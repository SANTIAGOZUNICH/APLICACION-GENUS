import type { OriginStage } from "@/types/operational/work-item";
import type { SectorId } from "@/types/operational/sector";

/** Etapas del flujo operativo Genus — conocimiento de planta, no UI. */
export const WORKFLOW_STAGE_IDS = [
  "DESARROLLO",
  "COMERCIAL",
  "PLANIFICACION",
  "ELABORACION",
  "ENVASADO_MASIVO",
  "ENVASADO_PREMIUM",
  "CODIFICADO",
  "CALIDAD",
  "DEPOSITO",
  "DIRECCION",
] as const;

export type WorkflowStageId = (typeof WORKFLOW_STAGE_IDS)[number];

/** Entidades que circulan entre etapas. */
export const WORKFLOW_ENTITY_TYPES = [
  "pedido",
  "plan_semanal",
  "muestra",
  "oe",
  "granel",
  "oa",
  "lote",
  "liberacion",
  "insumo",
  "entrega",
] as const;

export type WorkflowEntityType = (typeof WORKFLOW_ENTITY_TYPES)[number];

/** Definición declarativa de una etapa del flujo de planta. */
export interface WorkflowStageDefinition {
  id: WorkflowStageId;
  title: string;
  description: string;
  /** Etapas que preceden a esta en el flujo principal. */
  previousStages: WorkflowStageId[];
  /** Etapas que siguen cuando esta etapa completa. */
  nextStages: WorkflowStageId[];
  /** Requisitos humanos-legibles para iniciar trabajo en esta etapa. */
  dependsOn: string[];
  /** Entidades / artefactos que esta etapa crea o actualiza. */
  generates: string[];
  /** Condiciones de cierre de la etapa para el ítem. */
  completesWhen: string[];
  /** Etapas downstream bloqueadas mientras esta etapa no cierra. */
  blocks: WorkflowStageId[];
  /** Etapas habilitadas al completar esta etapa. */
  unblocks: WorkflowStageId[];
  /** Tipos de entidad producidos. */
  producedEntities: WorkflowEntityType[];
  /** Sectores operativos equivalentes (si aplica). */
  sectorIds?: SectorId[];
  /** originStage del mapper SEMANAS asociado (si aplica). */
  originStages?: OriginStage[];
}

/** Estado resuelto del flujo para un WorkItem concreto. */
export interface ResolvedWorkflow {
  workItemId: string;
  stage: WorkflowStageId;
  definition: WorkflowStageDefinition;
  previousStages: WorkflowStageId[];
  nextStages: WorkflowStageId[];
  isBlocked: boolean;
  blockingReasons: string[];
  /** Etapas que este ítem habilitará al completarse. */
  enablesStages: WorkflowStageId[];
  /** Entidades referenciadas detectadas en el WorkItem. */
  referencedEntities: Partial<Record<WorkflowEntityType, string | null>>;
}

/** Resumen de carga por etapa — para Producción / Creamy. */
export interface StageLoadSummary {
  stage: WorkflowStageId;
  title: string;
  total: number;
  pendientes: number;
  enCurso: number;
  bloqueados: number;
  completos: number;
}

/** Ítem bloqueado con razones estructuradas. */
export interface BlockedWorkItemSummary {
  workItemId: string;
  stage: WorkflowStageId;
  client: string | null;
  product: string | null;
  reasons: string[];
}

/** Ítem esperando otra etapa. */
export interface WaitingWorkItemSummary {
  workItemId: string;
  stage: WorkflowStageId;
  waitingFor: WorkflowStageId[];
  client: string | null;
  product: string | null;
}

/** Cuello de botella detectado. */
export interface WorkflowBottleneck {
  stage: WorkflowStageId;
  title: string;
  blockedCount: number;
  waitingCount: number;
  loadScore: number;
  reason: string;
}

/** Contexto preparado para Creamy — sin IA, solo conocimiento operativo. */
export interface WorkflowCopilotContext {
  questionType:
    | "why_blocked"
    | "what_happens_next"
    | "who_is_waiting"
    | "bottleneck"
    | "general";
  headline: string;
  explanation: string;
  relatedStages: WorkflowStageId[];
  suggestedFollowUps: string[];
}

export interface WorkflowAnalysis {
  scannedAt: string;
  totalItems: number;
  blocked: BlockedWorkItemSummary[];
  waiting: WaitingWorkItemSummary[];
  stageLoad: StageLoadSummary[];
  bottleneck: WorkflowBottleneck | null;
}
