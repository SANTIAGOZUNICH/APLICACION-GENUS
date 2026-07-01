import type {
  ActionFlowData,
  ActionFlowReviewItem,
  ActionFlowStep,
} from "@/types/actions";
import type { ActionDefinition } from "@/types/actions";

export function buildReviewItems(
  definition: ActionDefinition,
  flowData: ActionFlowData
): ActionFlowReviewItem[] {
  const items: ActionFlowReviewItem[] = [
    { label: "Acción", value: definition.label },
    { label: "Qué cambia", value: definition.effectSummary },
    { label: "Riesgo", value: definition.riskDescription },
  ];

  for (const step of definition.flow.steps) {
    if (step.type !== "form") continue;
    const data = flowData[step.id] ?? {};
    for (const field of step.fields) {
      const raw = data[field.id];
      if (!raw) continue;
      const label =
        field.type === "select"
          ? field.options?.find((o) => o.value === raw)?.label ?? raw
          : raw;
      items.push({ label: field.label, value: label });
    }
  }

  return items;
}

export function getVisibleSteps(steps: readonly ActionFlowStep[]): ActionFlowStep[] {
  return [...steps];
}

export function isLastStep(
  steps: readonly ActionFlowStep[],
  index: number
): boolean {
  return index >= steps.length - 1;
}

/** Steps before confirm/review that collect data must be filled. */
export function canAdvanceStep(
  step: ActionFlowStep,
  flowData: ActionFlowData
): boolean {
  if (step.type !== "form") return true;
  const data = flowData[step.id] ?? {};
  return step.fields
    .filter((f) => f.required)
    .every((f) => Boolean(data[f.id]?.trim()));
}
