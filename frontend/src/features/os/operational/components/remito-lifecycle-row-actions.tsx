"use client";

import { useMemo } from "react";
import type { LifecycleAction } from "@/lib/lifecycle";
import { remitoLifecycleActions } from "@/lib/lifecycle/adapters/common";
import type { RemitoRecord } from "@/lib/remitos/types";
import type { OrdersClientSession } from "@/lib/orders/orders-client";
import {
  deleteRemitoDraftApi,
  remitoActionApi,
} from "@/lib/remitos/remitos-client";
import type { LifecycleMenuItem } from "./lifecycle-actions-menu";
import { LifecycleRowActions } from "./lifecycle-row-actions";

function buildRemitoLifecycleMenuItems(r: Pick<RemitoRecord, "id" | "status">): LifecycleMenuItem[] {
  const decisions = remitoLifecycleActions(r);
  const items: LifecycleMenuItem[] = [];

  if (decisions.eliminar.allowed) {
    items.push({
      action: "eliminar",
      label: "Eliminar borrador",
      decision: decisions.eliminar,
    });
  }
  if (decisions.anular.allowed) {
    items.push({
      action: "anular",
      label: "Anular remito",
      decision: decisions.anular,
    });
  }
  if (decisions.archivar.allowed) {
    items.push({
      action: "archivar",
      label: "Archivar",
      decision: decisions.archivar,
    });
  }
  if (decisions.restaurar.allowed) {
    items.push({
      action: "restaurar",
      label: "Restaurar",
      decision: decisions.restaurar,
    });
  }

  return items;
}

type Props = {
  remito: RemitoRecord;
  session: OrdersClientSession;
  onOpen?: () => void;
  onChanged?: () => void;
  onError?: (message: string) => void;
  disabled?: boolean;
  /** Borrador sin versiones generadas — policy eliminar. */
  canDeleteDraft?: boolean;
};

export function RemitoLifecycleRowActions({
  remito,
  session,
  onOpen,
  onChanged,
  onError,
  disabled,
  canDeleteDraft = true,
}: Props) {
  const items = useMemo(() => {
    const all = buildRemitoLifecycleMenuItems(remito);
    if (canDeleteDraft) return all;
    return all.filter((i) => i.action !== "eliminar");
  }, [remito, canDeleteDraft]);

  const handleAction = async (action: LifecycleAction, reason: string) => {
    try {
      if (action === "eliminar") {
        await deleteRemitoDraftApi(session, remito.id);
        onChanged?.();
        return;
      }
      if (action === "anular") {
        await remitoActionApi(session, "annul", remito.id, { motivo: reason });
        onChanged?.();
        return;
      }
      if (action === "archivar") {
        await remitoActionApi(session, "archive", remito.id);
        onChanged?.();
        return;
      }
      if (action === "restaurar") {
        await remitoActionApi(session, "restore", remito.id);
        onChanged?.();
      }
    } catch (e) {
      onError?.(e instanceof Error ? e.message : "No se pudo completar la acción.");
      throw e;
    }
  };

  return (
    <LifecycleRowActions
      items={items}
      onAction={handleAction}
      onPrimary={onOpen}
      primaryLabel="Abrir"
      disabled={disabled}
      entityLabel={remito.displayName || remito.clientDisplay || remito.remitoNumber || remito.id}
      entityStatus={remito.status}
      className="justify-end"
    />
  );
}
