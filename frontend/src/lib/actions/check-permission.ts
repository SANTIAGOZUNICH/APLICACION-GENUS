import type {
  ActionContext,
  ActionDefinition,
  PermissionCheckResult,
} from "@/types/actions";

/** Mock permission checker — will be replaced by RBAC adapter. */
export function checkActionPermission(
  definition: ActionDefinition,
  context: ActionContext
): PermissionCheckResult {
  if (!definition.allowedRoles.includes(context.roleId)) {
    return {
      allowed: false,
      reason: `Tu rol no puede ejecutar "${definition.label}".`,
    };
  }

  if (!definition.allowedStatuses.includes(context.status)) {
    return {
      allowed: false,
      reason: `Esta acción no está disponible en el estado actual.`,
    };
  }

  if (!definition.entityKinds.includes(context.entityKind)) {
    return {
      allowed: false,
      reason: "Esta acción no aplica a esta entidad.",
    };
  }

  return { allowed: true };
}
