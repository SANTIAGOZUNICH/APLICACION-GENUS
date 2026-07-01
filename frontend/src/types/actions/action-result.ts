import type { ActionFlow, ActionRisk } from "./action-flow";
import type { ActionId, RoleId } from "./action-id";
import type { EntityPageKind } from "@/types/entity-page";
import type { Status } from "@/types/ui/status";

export type FeedbackTone = "ok" | "attention" | "problem" | "info";

export interface ActionFeedback {
  tone: FeedbackTone;
  title: string;
  description?: string;
}

/** Outcome returned by pure handlers — UI decides how to render. */
export interface ActionSuccessResult {
  ok: true;
  feedback: ActionFeedback;
  /** Human-readable posta summary for toast or inline message. */
  postaSummary?: string;
}

export interface ActionFailureResult {
  ok: false;
  code: "permission" | "validation" | "handler";
  feedback: ActionFeedback;
  fieldErrors?: Record<string, string>;
}

export type ActionResult = ActionSuccessResult | ActionFailureResult;

/** Registry entry — declarative action definition. */
export interface ActionDefinition {
  id: ActionId;
  label: string;
  description: string;
  risk: ActionRisk;
  entityKinds: readonly EntityPageKind[];
  allowedStatuses: readonly Status[];
  allowedRoles: readonly RoleId[];
  flow: ActionFlow;
  /** What changes after execution — shown in review/confirm. */
  effectSummary: string;
  /** Risk description for the user. */
  riskDescription: string;
}

export type ActionHandler = (
  state: import("./operations-state").OperationsState,
  context: import("./action-context").ActionContext,
  flowData: import("./action-context").ActionFlowData
) => {
  result: ActionResult;
  nextState?: import("./operations-state").OperationsState;
};

export type PermissionChecker = (
  definition: ActionDefinition,
  context: import("./action-context").ActionContext
) => import("./action-context").PermissionCheckResult;

export type ValidationChecker = (
  definition: ActionDefinition,
  context: import("./action-context").ActionContext,
  state: import("./operations-state").OperationsState,
  flowData: import("./action-context").ActionFlowData
) => import("./action-context").ValidationCheckResult;
