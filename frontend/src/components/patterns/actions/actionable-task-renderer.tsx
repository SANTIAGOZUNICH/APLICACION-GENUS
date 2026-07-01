"use client";

import { useMemo, useState } from "react";
import { BandejaTaskRenderer } from "@/components/patterns/bandeja/bandeja-task-renderer";
import { ActionFlowDialog } from "@/components/patterns/actions/action-flow-dialog";
import type { UseActionParams } from "@/components/patterns/actions/use-action";
import {
  BandejaEntityType,
  type BandejaTaskPayload,
} from "@/types/bandeja/bandeja-task";
import { EntityPageKinds, type EntityPageKind } from "@/types/entity-page";
import type { EntityCardAction } from "@/types/ui/entity-card";
import type { EntityCardVariant } from "@/types/ui/entity-card";
import type { Status } from "@/types/ui/status";

function extractEntityMeta(payload: BandejaTaskPayload): {
  kind: EntityPageKind;
  entityId: string;
  status: Status;
} | null {
  switch (payload.entityType) {
    case BandejaEntityType.OE:
      return {
        kind: EntityPageKinds.OE,
        entityId: payload.data.oeId,
        status: payload.data.status,
      };
    case BandejaEntityType.OA:
      return {
        kind: EntityPageKinds.OA,
        entityId: payload.data.oaId,
        status: payload.data.status,
      };
    case BandejaEntityType.LOTE:
      return {
        kind: EntityPageKinds.LOTE,
        entityId: payload.data.loteNumber,
        status: payload.data.status,
      };
    case BandejaEntityType.PEDIDO:
      return {
        kind: EntityPageKinds.PEDIDO,
        entityId: payload.data.pedidoId,
        status: payload.data.status,
      };
    case BandejaEntityType.LIBERACION:
      return {
        kind: EntityPageKinds.LIBERACION,
        entityId: payload.data.loteNumber,
        status: payload.data.status,
      };
    default:
      return null;
  }
}

function wrapAction(
  action: EntityCardAction | undefined,
  meta: ReturnType<typeof extractEntityMeta>,
  surface: UseActionParams["surface"],
  openFlow: (params: UseActionParams) => void
): EntityCardAction | undefined {
  if (!action || !meta || !action.actionId) return action;

  return {
    ...action,
    onClick: () => {
      openFlow({
        actionId: action.actionId!,
        entityKind: meta.kind,
        entityId: meta.entityId,
        status: meta.status,
        surface,
      });
    },
  };
}

function wrapPayload(
  payload: BandejaTaskPayload,
  surface: UseActionParams["surface"],
  openFlow: (params: UseActionParams) => void
): BandejaTaskPayload {
  const meta = extractEntityMeta(payload);
  if (!meta) return payload;

  switch (payload.entityType) {
    case BandejaEntityType.OE:
      return {
        ...payload,
        data: {
          ...payload.data,
          primaryAction: wrapAction(
            payload.data.primaryAction,
            meta,
            surface,
            openFlow
          ),
        },
      };
    case BandejaEntityType.OA:
      return {
        ...payload,
        data: {
          ...payload.data,
          primaryAction: wrapAction(
            payload.data.primaryAction,
            meta,
            surface,
            openFlow
          ),
        },
      };
    case BandejaEntityType.LOTE:
      return {
        ...payload,
        data: {
          ...payload.data,
          primaryAction: wrapAction(
            payload.data.primaryAction,
            meta,
            surface,
            openFlow
          ),
        },
      };
    case BandejaEntityType.PEDIDO:
      return {
        ...payload,
        data: {
          ...payload.data,
          primaryAction: wrapAction(
            payload.data.primaryAction,
            meta,
            surface,
            openFlow
          ),
        },
      };
    case BandejaEntityType.LIBERACION:
      return {
        ...payload,
        data: {
          ...payload.data,
          primaryAction: wrapAction(
            payload.data.primaryAction,
            meta,
            surface,
            openFlow
          ),
        },
      };
    default:
      return payload;
  }
}

export interface ActionableTaskRendererProps {
  payload: BandejaTaskPayload;
  variant?: EntityCardVariant;
  surface?: UseActionParams["surface"];
}

/** E6 layer — wires actionId on cards to Action Flow without modifying E3 renderer. */
export function ActionableTaskRenderer({
  payload,
  variant = "default",
  surface = "bandeja",
}: ActionableTaskRendererProps) {
  const [flowParams, setFlowParams] = useState<UseActionParams | null>(null);
  const [flowOpen, setFlowOpen] = useState(false);

  const openFlow = (params: UseActionParams) => {
    setFlowParams(params);
    setFlowOpen(true);
  };

  const wrapped = useMemo(
    () => wrapPayload(payload, surface, openFlow),
    [payload, surface]
  );

  return (
    <>
      <BandejaTaskRenderer payload={wrapped} variant={variant} />
      <ActionFlowDialog
        open={flowOpen}
        onOpenChange={setFlowOpen}
        params={flowParams}
      />
    </>
  );
}
