import { getActionDefinition, ALL_ACTION_DEFINITIONS } from "@/config/actions/registry";
import { checkActionPermission } from "@/lib/actions/check-permission";
import { getActionHandler } from "@/lib/actions/handlers";
import { validateAction } from "@/lib/actions/validate-action";
import type {
  ActionContext,
  ActionFlowData,
  ActionResult,
  OperationsState,
} from "@/types/actions";

export interface PipelineResult {
  result: ActionResult;
  nextState?: OperationsState;
}

/**
 * Action pipeline: Permission → Validation → Handler → Result
 * Feedback and Posta are derived from ActionResult by the UI layer.
 */
export function runActionPipeline(
  state: OperationsState,
  context: ActionContext,
  flowData: ActionFlowData
): PipelineResult {
  const definition = getActionDefinition(context.actionId);
  if (!definition) {
    return {
      result: {
        ok: false,
        code: "handler",
        feedback: {
          tone: "problem",
          title: "Acción no encontrada",
          description: context.actionId,
        },
      },
    };
  }

  const permission = checkActionPermission(definition, context);
  if (!permission.allowed) {
    return {
      result: {
        ok: false,
        code: "permission",
        feedback: {
          tone: "problem",
          title: "Acción no permitida",
          description: permission.reason,
        },
      },
    };
  }

  const validation = validateAction(definition, context, state, flowData);
  if (!validation.valid) {
    return {
      result: {
        ok: false,
        code: "validation",
        feedback: {
          tone: "problem",
          title: "Revisá los datos",
          description: validation.message,
        },
        fieldErrors: validation.fieldErrors,
      },
    };
  }

  const handler = getActionHandler(context.actionId);
  if (!handler) {
    return {
      result: {
        ok: false,
        code: "handler",
        feedback: {
          tone: "problem",
          title: "Handler no implementado",
        },
      },
    };
  }

  const { result, nextState } = handler(state, context, flowData);
  return { result, nextState };
}

export function resolveActionsForEntity(
  entityKind: import("@/types/entity-page").EntityPageKind,
  status: import("@/types/ui/status").Status,
  roleId: import("@/types/actions").RoleId
) {
  return ALL_ACTION_DEFINITIONS.filter(
    (def) =>
      def.entityKinds.includes(entityKind) &&
      def.allowedStatuses.includes(status) &&
      def.allowedRoles.includes(roleId)
  );
}
