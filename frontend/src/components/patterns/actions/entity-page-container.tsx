"use client";

import { useMemo, useState } from "react";
import { EntityPageView } from "@/components/patterns/entity-page/entity-page-view";
import { ActionFlowDialog } from "@/components/patterns/actions/action-flow-dialog";
import type { UseActionParams } from "@/components/patterns/actions/use-action";
import { useOperationsStore } from "@/lib/operations/operations-store";
import { entityPageKey } from "@/types/actions";
import type { EntityPageKind } from "@/types/entity-page";
import type { EntityCardAction } from "@/types/ui/entity-card";

interface EntityPageContainerProps {
  kind: EntityPageKind;
  entityId: string;
  backHref?: string;
}

function wrapHeaderAction(
  action: EntityCardAction | undefined,
  params: Omit<UseActionParams, "actionId">,
  openFlow: (p: UseActionParams) => void
): EntityCardAction | undefined {
  if (!action?.actionId) return action;
  return {
    ...action,
    onClick: () =>
      openFlow({
        ...params,
        actionId: action.actionId!,
      }),
  };
}

/** Client container — reads live state from OperationsStore. */
export function EntityPageContainer({
  kind,
  entityId,
  backHref,
}: EntityPageContainerProps) {
  const { state } = useOperationsStore();
  const [flowParams, setFlowParams] = useState<UseActionParams | null>(null);
  const [flowOpen, setFlowOpen] = useState(false);

  const baseModel = state.entityPages[entityPageKey(kind, entityId)];

  const model = useMemo(() => {
    if (!baseModel) return undefined;

    const baseParams = {
      entityKind: kind,
      entityId,
      status: baseModel.status,
      surface: "entity-page" as const,
    };

    const openFlow = (p: UseActionParams) => {
      setFlowParams(p);
      setFlowOpen(true);
    };

    return {
      ...baseModel,
      primaryAction: wrapHeaderAction(
        baseModel.primaryAction,
        baseParams,
        openFlow
      ),
      secondaryActions: baseModel.secondaryActions
        ?.map((action) => wrapHeaderAction(action, baseParams, openFlow))
        .filter((a): a is EntityCardAction => Boolean(a)),
    };
  }, [baseModel, kind, entityId]);

  if (!model) {
    return null;
  }

  return (
    <>
      <EntityPageView model={model} backHref={backHref} />
      <ActionFlowDialog
        open={flowOpen}
        onOpenChange={setFlowOpen}
        params={flowParams}
      />
    </>
  );
}
