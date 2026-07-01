import type { EntityActivityLogEntry, EntityPageModel } from "@/types/entity-page";
import type {
  ActionContext,
  ActionFlowData,
  ActionResult,
  OperationsState,
} from "@/types/actions";
import { entityPageKey } from "@/types/actions";
import { CROSS_LINK } from "@/mocks/entity-pages/cross-link";

export function cloneState(state: OperationsState): OperationsState {
  return structuredClone(state);
}

export function updateEntityPage(
  state: OperationsState,
  model: EntityPageModel
): OperationsState {
  const next = cloneState(state);
  next.entityPages[entityPageKey(model.kind, model.entityId)] = model;
  return next;
}

export function appendActivity(
  model: EntityPageModel,
  entry: Omit<EntityActivityLogEntry, "id">
): EntityPageModel {
  const id = `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    ...model,
    activityLog: [{ id, ...entry }, ...model.activityLog],
  };
}

export function nowLabel(): string {
  const d = new Date();
  return `Hoy ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

export function success(
  nextState: OperationsState,
  feedback: ActionResult & { ok: true } extends never
    ? never
    : Extract<ActionResult, { ok: true }>["feedback"],
  postaSummary?: string
): { result: ActionResult; nextState: OperationsState } {
  return {
    result: { ok: true, feedback, postaSummary },
    nextState,
  };
}

export function failure(
  code: "permission" | "validation" | "handler",
  title: string,
  description?: string,
  fieldErrors?: Record<string, string>
): { result: ActionResult; nextState?: OperationsState } {
  return {
    result: {
      ok: false,
      code,
      feedback: { tone: "problem", title, description },
      fieldErrors,
    },
  };
}

export function getFormData(
  flowData: ActionFlowData,
  stepId: string
): Record<string, string> {
  return flowData[stepId] ?? {};
}

export function bumpDayPulse(state: OperationsState): OperationsState {
  const next = cloneState(state);
  next.dayPulse = {
    completed: next.dayPulse.completed + 1,
    pending: Math.max(0, next.dayPulse.pending - 1),
  };
  return next;
}

export { CROSS_LINK };

export type HandlerOutput = {
  result: ActionResult;
  nextState?: OperationsState;
};

export type PureHandler = (
  state: OperationsState,
  context: ActionContext,
  flowData: ActionFlowData
) => HandlerOutput;
