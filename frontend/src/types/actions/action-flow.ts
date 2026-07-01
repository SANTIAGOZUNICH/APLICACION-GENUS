/** Field types supported inside a form step of an Action Flow. */
export type ActionFlowFieldType =
  | "text"
  | "number"
  | "select"
  | "textarea";

export interface ActionFlowFieldOption {
  value: string;
  label: string;
}

export interface ActionFlowField {
  id: string;
  label: string;
  type: ActionFlowFieldType;
  required?: boolean;
  placeholder?: string;
  description?: string;
  options?: readonly ActionFlowFieldOption[];
}

/** A form step — one type of step within an Action Flow. */
export interface ActionFlowFormStep {
  type: "form";
  id: string;
  title: string;
  description?: string;
  fields: readonly ActionFlowField[];
}

export interface ActionFlowReviewItem {
  label: string;
  value: string;
}

/** Review step — summarizes collected data before execution. */
export interface ActionFlowReviewStep {
  type: "review";
  id: string;
  title: string;
  description?: string;
}

/** Confirm step — irreversible actions require explicit confirmation. */
export interface ActionFlowConfirmStep {
  type: "confirm";
  id: string;
  title: string;
  description: string;
  confirmLabel?: string;
  variant?: "default" | "destructive";
}

export type ActionFlowStep =
  | ActionFlowFormStep
  | ActionFlowReviewStep
  | ActionFlowConfirmStep;

export type ActionRisk = "low" | "medium" | "irreversible";

/**
 * Action Flow — orchestrates Steps → Review → Execute → Result.
 * Forms are one step type among others.
 */
export interface ActionFlow {
  steps: readonly ActionFlowStep[];
}
