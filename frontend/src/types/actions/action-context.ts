import type { EntityPageKind } from "@/types/entity-page";
import type { Status } from "@/types/ui/status";
import type { ActionId, RoleId } from "./action-id";

export type ActionSurface = "bandeja" | "workspace" | "entity-page";

/** Runtime context passed through the action pipeline. */
export interface ActionContext {
  actionId: ActionId;
  entityKind: EntityPageKind;
  entityId: string;
  status: Status;
  roleId: RoleId;
  surface: ActionSurface;
  userName: string;
}

export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
}

export interface ValidationCheckResult {
  valid: boolean;
  fieldErrors?: Record<string, string>;
  message?: string;
}

/** Collected step data keyed by step id. */
export type ActionFlowData = Record<string, Record<string, string>>;
