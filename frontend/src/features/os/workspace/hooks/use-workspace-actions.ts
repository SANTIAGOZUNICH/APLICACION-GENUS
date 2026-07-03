"use client";

import { useCallback } from "react";
import { usePreviewContext } from "@/features/os/session/preview-context";
import type { WorkspaceAction } from "../types";
import { resolveHeroCtaActionId } from "../lib/workspace-action-handlers";
import type { ResolvedWorkspace } from "../types";

export function useWorkspaceActions(workspace: ResolvedWorkspace) {
  const { navigateSidebar, openConsulta, openCreamy, setCreamyTeaser } = usePreviewContext();

  const handleAction = useCallback(
    (action: WorkspaceAction) => {
      if (action.id === "consult" || action.id === "view-analysis") {
        openConsulta("");
        return;
      }
      if (action.id === "operations" || action.id === "kpis" || action.id === "alerts") {
        navigateSidebar("produccion");
        return;
      }
      if (action.id === "plan" || action.id.includes("plan")) {
        navigateSidebar("plan_semanal");
        return;
      }

      setCreamyTeaser({
        headline: action.label,
        hint: action.description ?? "Acción simulada — datos reales en fases posteriores.",
      });
      openCreamy();
    },
    [navigateSidebar, openConsulta, openCreamy, setCreamyTeaser]
  );

  const handleHeroCta = useCallback(() => {
    const actionId = resolveHeroCtaActionId(workspace.context.sectorId);
    const action = workspace.definition.primaryActions.find((a) => a.id === actionId);
    if (action) {
      handleAction(action);
      return;
    }
    const fallback = workspace.definition.primaryActions[0];
    if (fallback) handleAction(fallback);
  }, [workspace, handleAction]);

  const handleWorkSelect = useCallback(
    (reference: string, product: string) => {
      setCreamyTeaser({
        headline: reference,
        hint: `${product} — detalle simulado. Datos reales en fases posteriores.`,
      });
      openCreamy();
    },
    [openCreamy, setCreamyTeaser]
  );

  const handleAttentionSelect = useCallback(
    (title: string, detail: string) => {
      setCreamyTeaser({
        headline: title,
        hint: detail,
      });
      openCreamy();
    },
    [openCreamy, setCreamyTeaser]
  );

  return { handleAction, handleHeroCta, handleWorkSelect, handleAttentionSelect };
}
