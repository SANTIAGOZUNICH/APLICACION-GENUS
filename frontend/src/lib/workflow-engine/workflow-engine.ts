import {
  resolveEnablesStages,
  resolveNextStages,
  resolvePreviousStages,
} from "@/lib/workflow-engine/workflow-definition";
import {
  assertWorkflowStageDefinition,
  getAllWorkflowStageDefinitions,
  getWorkflowStageDefinition,
  WORKFLOW_REGISTRY,
} from "@/lib/workflow-engine/workflow-registry";
import type {
  BlockedWorkItemSummary,
  ResolvedWorkflow,
  StageLoadSummary,
  WaitingWorkItemSummary,
  WorkflowAnalysis,
  WorkflowBottleneck,
  WorkflowCopilotContext,
  WorkflowEntityType,
  WorkflowStageDefinition,
  WorkflowStageId,
} from "@/lib/workflow-engine/types";
import type { WorkItem } from "@/types/operational/work-item";
import type { OriginStage } from "@/types/operational/work-item";
import type { SectorId } from "@/types/operational/sector";

// ---------------------------------------------------------------------------
// Mapeo WorkItem → etapa de flujo (reutiliza WorkItems existentes, no los modifica)
// ---------------------------------------------------------------------------

const SECTOR_TO_STAGE: Partial<Record<SectorId, WorkflowStageId>> = {
  COMERCIAL: "COMERCIAL",
  ELABORACION: "ELABORACION",
  ENVASADO_MASIVO: "ENVASADO_MASIVO",
  ENVASADO_PREMIUM: "ENVASADO_PREMIUM",
  CODIFICADO: "CODIFICADO",
  CALIDAD: "CALIDAD",
  DEPOSITO: "DEPOSITO",
  DIRECCION: "DIRECCION",
  PRODUCCION: "PLANIFICACION",
};

const ORIGIN_STAGE_TO_WORKFLOW: Partial<Record<OriginStage, WorkflowStageId>> = {
  DESARROLLO: "DESARROLLO",
  PLANIFICACION: "PLANIFICACION",
  ELABORACION: "ELABORACION",
  ACONDICIONAMIENTO: "ENVASADO_MASIVO",
  CODIFICADO: "CODIFICADO",
  CALIDAD: "CALIDAD",
  DESPACHO: "DEPOSITO",
};

/** Resuelve la etapa de flujo para un WorkItem sin mutarlo. */
export function resolveWorkflowStageId(item: WorkItem): WorkflowStageId {
  const bySector = SECTOR_TO_STAGE[item.sector];
  if (bySector) {
    if (item.sector === "ENVASADO_PREMIUM") return "ENVASADO_PREMIUM";
    if (item.sector === "ENVASADO_MASIVO") return "ENVASADO_MASIVO";
    return bySector;
  }

  const byOrigin = ORIGIN_STAGE_TO_WORKFLOW[item.originStage];
  if (byOrigin) {
    if (byOrigin === "ENVASADO_MASIVO" && item.sector === "ENVASADO_PREMIUM") {
      return "ENVASADO_PREMIUM";
    }
    return byOrigin;
  }

  return "PLANIFICACION";
}

function extractReferencedEntities(item: WorkItem): Partial<Record<WorkflowEntityType, string | null>> {
  return {
    pedido: item.pedidoRef,
    oe: item.oeRef,
    oa: item.oaRef,
    lote: item.loteRef,
    plan_semanal: item.weekLabel ?? item.sourceSheet,
  };
}

function itemExplicitBlockReasons(item: WorkItem): string[] {
  const reasons: string[] = [];

  if (item.status === "bloqueado") {
    reasons.push("WorkItem marcado como bloqueado.");
  }
  if (item.blockedBy?.length) {
    reasons.push(...item.blockedBy.map((b) => `Bloqueado por: ${b}`));
  }
  if (item.dependsOn?.length) {
    reasons.push(...item.dependsOn.map((d) => `Depende de: ${d}`));
  }

  return reasons;
}

function upstreamIncompleteReasons(
  item: WorkItem,
  allItems: WorkItem[],
  definition: WorkflowStageDefinition
): string[] {
  const reasons: string[] = [];
  const stageId = definition.id;

  for (const prevStageId of definition.previousStages) {
    const prevDef = getWorkflowStageDefinition(prevStageId);
    if (!prevDef) continue;

    const relatedPrev = allItems.filter((candidate) => {
      if (candidate.id === item.id) return false;
      const candidateStage = resolveWorkflowStageId(candidate);
      if (candidateStage !== prevStageId) return false;
      return sharesProductContext(item, candidate);
    });

    if (relatedPrev.length === 0) continue;

    const incomplete = relatedPrev.filter((p) => p.status !== "completo");
    if (incomplete.length > 0) {
      const label = prevDef.title;
      reasons.push(
        `${label} todavía no terminó (${incomplete.length} trabajo(s) pendiente(s)).`
      );
    }
  }

  if (stageId === "ENVASADO_MASIVO" || stageId === "ENVASADO_PREMIUM" || stageId === "CODIFICADO") {
    if (!item.oaRef) {
      reasons.push("OA no creada todavía.");
    }
  }

  if (stageId === "ELABORACION" && !item.oeRef) {
    reasons.push("OE no vinculada todavía.");
  }

  if (stageId === "CALIDAD" && !item.loteRef) {
    reasons.push("Lote no asignado todavía.");
  }

  return reasons;
}

function sharesProductContext(a: WorkItem, b: WorkItem): boolean {
  if (a.pedidoRef && b.pedidoRef && a.pedidoRef === b.pedidoRef) return true;
  if (a.oeRef && b.oeRef && a.oeRef === b.oeRef) return true;
  if (a.oaRef && b.oaRef && a.oaRef === b.oaRef) return true;
  if (a.loteRef && b.loteRef && a.loteRef === b.loteRef) return true;
  if (a.client && b.client && a.product && b.product) {
    return (
      a.client.toLowerCase() === b.client.toLowerCase() &&
      a.product.toLowerCase() === b.product.toLowerCase()
    );
  }
  return false;
}

// ---------------------------------------------------------------------------
// API pública — resolución por WorkItem
// ---------------------------------------------------------------------------

/** Resuelve el flujo operativo completo para un WorkItem. */
export function resolveWorkflow(item: WorkItem, allItems: WorkItem[] = []): ResolvedWorkflow {
  const stage = resolveWorkflowStageId(item);
  const definition = assertWorkflowStageDefinition(stage);
  const blockingReasons = [
    ...itemExplicitBlockReasons(item),
    ...upstreamIncompleteReasons(item, allItems, definition),
  ];

  const uniqueReasons = [...new Set(blockingReasons)];

  return {
    workItemId: item.id,
    stage,
    definition,
    previousStages: resolvePreviousStages(definition),
    nextStages: resolveNextStages(definition),
    isBlocked: uniqueReasons.length > 0 || item.status === "bloqueado",
    blockingReasons: uniqueReasons,
    enablesStages: resolveEnablesStages(definition),
    referencedEntities: extractReferencedEntities(item),
  };
}

/** Etapas siguientes en el flujo para este WorkItem. */
export function resolveNextStage(item: WorkItem): WorkflowStageId[] {
  return resolveWorkflow(item).nextStages;
}

/** Etapas anteriores en el flujo para este WorkItem. */
export function resolvePreviousStage(item: WorkItem): WorkflowStageId[] {
  return resolveWorkflow(item).previousStages;
}

/** ¿El WorkItem está bloqueado según estado + flujo? */
export function isBlocked(item: WorkItem, allItems: WorkItem[] = []): boolean {
  return resolveWorkflow(item, allItems).isBlocked;
}

/** Razones estructuradas de bloqueo. */
export function getBlockingReason(item: WorkItem, allItems: WorkItem[] = []): string[] {
  return resolveWorkflow(item, allItems).blockingReasons;
}

/** Etapas que se habilitan al completar este WorkItem. */
export function getEnabledStages(item: WorkItem): WorkflowStageId[] {
  return resolveWorkflow(item).enablesStages;
}

// ---------------------------------------------------------------------------
// Análisis de planta — Producción / Creamy (sin UI)
// ---------------------------------------------------------------------------

export function getBlockedWorkItems(items: WorkItem[]): BlockedWorkItemSummary[] {
  return items
    .filter((item) => isBlocked(item, items))
    .map((item) => {
      const stage = resolveWorkflowStageId(item);
      return {
        workItemId: item.id,
        stage,
        client: item.client,
        product: item.product,
        reasons: getBlockingReason(item, items),
      };
    });
}

export function getWaitingWorkItems(items: WorkItem[]): WaitingWorkItemSummary[] {
  return items
    .map((item) => {
      const workflow = resolveWorkflow(item, items);
      if (!workflow.isBlocked) return null;

      const waitingFor = workflow.definition.previousStages.filter((prevId) =>
        workflow.blockingReasons.some((r) =>
          r.toLowerCase().includes(getWorkflowStageDefinition(prevId)?.title.toLowerCase() ?? prevId)
        )
      );

      if (waitingFor.length === 0 && workflow.blockingReasons.length > 0) {
        return {
          workItemId: item.id,
          stage: workflow.stage,
          waitingFor: workflow.previousStages,
          client: item.client,
          product: item.product,
        };
      }

      if (waitingFor.length === 0) return null;

      return {
        workItemId: item.id,
        stage: workflow.stage,
        waitingFor,
        client: item.client,
        product: item.product,
      };
    })
    .filter((entry): entry is WaitingWorkItemSummary => entry !== null);
}

export function getStageLoad(items: WorkItem[]): StageLoadSummary[] {
  return getAllWorkflowStageDefinitions().map((definition) => {
    const stageItems = items.filter((item) => resolveWorkflowStageId(item) === definition.id);

    return {
      stage: definition.id,
      title: definition.title,
      total: stageItems.length,
      pendientes: stageItems.filter((i) => i.status === "pendiente").length,
      enCurso: stageItems.filter((i) => i.status === "en_curso").length,
      bloqueados: stageItems.filter((i) => isBlocked(i, items)).length,
      completos: stageItems.filter((i) => i.status === "completo").length,
    };
  });
}

export function getBottleneckStage(items: WorkItem[]): WorkflowBottleneck | null {
  const load = getStageLoad(items);
  const blocked = getBlockedWorkItems(items);
  const waiting = getWaitingWorkItems(items);

  let best: WorkflowBottleneck | null = null;

  for (const summary of load) {
    if (summary.total === 0) continue;

    const blockedCount = blocked.filter((b) => b.stage === summary.stage).length;
    const waitingCount = waiting.filter((w) => w.stage === summary.stage).length;
    const loadScore = summary.bloqueados * 3 + summary.enCurso * 2 + summary.pendientes;

    if (!best || loadScore > best.loadScore) {
      best = {
        stage: summary.stage,
        title: summary.title,
        blockedCount,
        waitingCount,
        loadScore,
        reason:
          blockedCount > 0
            ? `${summary.title} concentra ${blockedCount} bloqueo(s) activo(s).`
            : `${summary.title} tiene mayor carga operativa (${summary.total} trabajo(s)).`,
      };
    }
  }

  return best;
}

export function analyzeWorkflow(items: WorkItem[]): WorkflowAnalysis {
  return {
    scannedAt: new Date().toISOString(),
    totalItems: items.length,
    blocked: getBlockedWorkItems(items),
    waiting: getWaitingWorkItems(items),
    stageLoad: getStageLoad(items),
    bottleneck: getBottleneckStage(items),
  };
}

// ---------------------------------------------------------------------------
// Contexto Creamy — preparado, sin IA
// ---------------------------------------------------------------------------

export function buildWhyBlockedContext(
  item: WorkItem,
  allItems: WorkItem[] = []
): WorkflowCopilotContext {
  const workflow = resolveWorkflow(item, allItems);
  const reasons = workflow.blockingReasons;

  if (reasons.length === 0) {
    return {
      questionType: "why_blocked",
      headline: "Sin bloqueos detectados",
      explanation: "Este trabajo puede avanzar según el flujo operativo actual.",
      relatedStages: workflow.previousStages,
      suggestedFollowUps: ["¿Qué sigue después?", "¿Quién espera mi sector?"],
    };
  }

  const primary = reasons[0];
  const prevTitles = workflow.previousStages
    .map((id) => getWorkflowStageDefinition(id)?.title)
    .filter(Boolean)
    .join(", ");

  return {
    questionType: "why_blocked",
    headline: "Trabajo bloqueado",
    explanation: prevTitles
      ? `${primary} Etapas anteriores: ${prevTitles}.`
      : primary,
    relatedStages: workflow.previousStages,
    suggestedFollowUps: [
      "Ver estado etapa anterior",
      "Consultar dependencias",
      "Reportar faltante",
    ],
  };
}

export function buildWhatHappensNextContext(item: WorkItem): WorkflowCopilotContext {
  const workflow = resolveWorkflow(item);
  const nextTitles = workflow.nextStages
    .map((id) => getWorkflowStageDefinition(id)?.title ?? id)
    .join(", ");

  const enables = workflow.enablesStages
    .map((id) => getWorkflowStageDefinition(id)?.title ?? id)
    .join(", ");

  return {
    questionType: "what_happens_next",
    headline: "Al completar este trabajo",
    explanation: nextTitles
      ? `Se habilitará: ${enables || nextTitles}. Condiciones: ${workflow.definition.completesWhen.join(" · ") || "cierre operativo"}.`
      : "Este trabajo cierra la cadena operativa para este producto.",
    relatedStages: workflow.nextStages,
    suggestedFollowUps: ["Ver quién recibe el trabajo", "Ver plan semanal"],
  };
}

export function buildWhoIsWaitingContext(
  item: WorkItem,
  allItems: WorkItem[] = []
): WorkflowCopilotContext {
  const workflow = resolveWorkflow(item);
  const downstream = workflow.enablesStages;

  const waitingItems = allItems.filter((candidate) => {
    const candidateStage = resolveWorkflowStageId(candidate);
    return (
      downstream.includes(candidateStage) &&
      sharesProductContext(item, candidate) &&
      candidate.status !== "completo"
    );
  });

  const waitingTitles = downstream
    .map((id) => getWorkflowStageDefinition(id)?.title ?? id)
    .join(", ");

  return {
    questionType: "who_is_waiting",
    headline:
      waitingItems.length > 0
        ? `${waitingItems.length} trabajo(s) esperando`
        : "Sin sectores esperando activamente",
    explanation:
      waitingItems.length > 0
        ? `${waitingTitles} depende(n) de que este trabajo avance.`
        : `Al completar, habilitás: ${waitingTitles || "etapas downstream"}.`,
    relatedStages: downstream,
    suggestedFollowUps: ["Ver bloqueos downstream", "Ver carga por sector"],
  };
}

export function buildBottleneckContext(items: WorkItem[]): WorkflowCopilotContext {
  const bottleneck = getBottleneckStage(items);

  if (!bottleneck) {
    return {
      questionType: "bottleneck",
      headline: "Sin cuello de botella detectado",
      explanation: "No hay carga operativa significativa en ninguna etapa.",
      relatedStages: [],
      suggestedFollowUps: ["Ver plan del día", "Ver trabajos bloqueados"],
    };
  }

  return {
    questionType: "bottleneck",
    headline: `Cuello de botella: ${bottleneck.title}`,
    explanation: bottleneck.reason,
    relatedStages: [bottleneck.stage],
    suggestedFollowUps: [
      "Ver trabajos bloqueados",
      "Ver quién espera",
      "Ver carga por etapa",
    ],
  };
}

/** Punto de entrada Creamy — selecciona contexto según tipo de pregunta. */
export function buildWorkflowCopilotContext(
  questionType: WorkflowCopilotContext["questionType"],
  item: WorkItem | null,
  allItems: WorkItem[] = []
): WorkflowCopilotContext {
  switch (questionType) {
    case "why_blocked":
      return item ? buildWhyBlockedContext(item, allItems) : buildBottleneckContext(allItems);
    case "what_happens_next":
      return item ? buildWhatHappensNextContext(item) : buildBottleneckContext(allItems);
    case "who_is_waiting":
      return item ? buildWhoIsWaitingContext(item, allItems) : buildBottleneckContext(allItems);
    case "bottleneck":
      return buildBottleneckContext(allItems);
    default:
      return buildBottleneckContext(allItems);
  }
}

export type { WorkflowStageDefinition, WorkflowStageId };
export { WORKFLOW_REGISTRY, getAllWorkflowStageDefinitions, getWorkflowStageDefinition };
