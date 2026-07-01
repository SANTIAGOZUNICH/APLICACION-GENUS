"use client";

import { useCallback, useState } from "react";
import { getActionDefinition } from "@/config/actions/registry";
import {
  showActionResultToast,
  useToast,
} from "@/components/patterns/feedback/toast-provider";
import { useOperationsStore } from "@/lib/operations/operations-store";
import type {
  ActionFlowData,
  ActionId,
  ActionResult,
} from "@/types/actions";
import type { EntityPageKind } from "@/types/entity-page";
import type { Status } from "@/types/ui/status";

export interface UseActionParams {
  actionId: ActionId;
  entityKind: EntityPageKind;
  entityId: string;
  status: Status;
  surface: "bandeja" | "workspace" | "entity-page";
}

export function useActionRunner() {
  const { executeAction } = useOperationsStore();
  const { showToast } = useToast();

  const runAction = useCallback(
    async (
      params: UseActionParams,
      flowData: ActionFlowData
    ): Promise<ActionResult> => {
      const result = await executeAction(params.actionId, {
        entityKind: params.entityKind,
        entityId: params.entityId,
        status: params.status,
        surface: params.surface,
        flowData,
      });
      showActionResultToast(showToast, result);
      return result;
    },
    [executeAction, showToast]
  );

  return { runAction };
}

export function useActionFlow(params: UseActionParams | null) {
  const definition = params ? getActionDefinition(params.actionId) : undefined;
  const [stepIndex, setStepIndex] = useState(0);
  const [flowData, setFlowData] = useState<ActionFlowData>({});
  const { runAction } = useActionRunner();

  const reset = useCallback(() => {
    setStepIndex(0);
    setFlowData({});
  }, []);

  const updateStepData = useCallback(
    (stepId: string, fieldId: string, value: string) => {
      setFlowData((prev) => ({
        ...prev,
        [stepId]: { ...prev[stepId], [fieldId]: value },
      }));
    },
    []
  );

  const advance = useCallback(() => {
    setStepIndex((i) => i + 1);
  }, []);

  const back = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);

  const execute = useCallback(async (): Promise<ActionResult | null> => {
    if (!params) return null;
    const result = await runAction(params, flowData);
    if (result.ok) reset();
    return result;
  }, [params, runAction, flowData, reset]);

  return {
    definition,
    stepIndex,
    flowData,
    reset,
    updateStepData,
    advance,
    back,
    execute,
    setStepIndex,
  };
}
