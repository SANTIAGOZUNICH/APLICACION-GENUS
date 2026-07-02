import type { WorkflowStageDefinition } from "@/lib/workflow-engine/types";

/** Valida y congela una definición de etapa. */
export function defineWorkflowStage(
  definition: WorkflowStageDefinition
): WorkflowStageDefinition {
  return Object.freeze({ ...definition });
}

/** Etapas anteriores efectivas desde el registry. */
export function resolvePreviousStages(definition: WorkflowStageDefinition) {
  return [...definition.previousStages];
}

/** Etapas siguientes efectivas desde el registry. */
export function resolveNextStages(definition: WorkflowStageDefinition) {
  return [...definition.nextStages];
}

/** Etapas que esta etapa habilita al completarse. */
export function resolveEnablesStages(definition: WorkflowStageDefinition) {
  return [...definition.unblocks];
}
