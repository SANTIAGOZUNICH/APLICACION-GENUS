import { createElement, type ReactElement } from "react";
import {
  resolveSidebarItems,
  resolveVisiblePanels,
} from "@/lib/role-engine/sector-definition";
import { assertSectorDefinition, getAllSectorDefinitions } from "@/lib/role-engine/sector-registry";
import type {
  ResolvedSectorHome,
  SectorDefinition,
  SectorViewRegistry,
} from "@/lib/role-engine/types";
import type { SectorId } from "@/types/operational/sector";

/** Resuelve la Home de un sector desde su definición — sin lógica en React. */
export function resolveSectorHome(sectorId: SectorId): ResolvedSectorHome {
  const definition = assertSectorDefinition(sectorId);

  return {
    sector: sectorId,
    definition,
    layout: definition.homeLayout,
    panels: resolveVisiblePanels(definition),
    quickActions: [...definition.quickActions],
    visibleEntities: [...definition.visibleEntities],
    workItemSources: [...definition.workItemSources],
    allowedActions: [...definition.allowedActions],
    sidebarItems: resolveSidebarItems(definition),
    creamyContext: definition.creamyContext,
    emptyState: definition.emptyState,
    homeViewKey: definition.homeViewKey,
    dataMode: definition.dataMode,
  };
}

/** Lista todos los sectores registrados con su Home resuelta. */
export function resolveAllSectorHomes(): ResolvedSectorHome[] {
  return getAllSectorDefinitions().map((definition) => resolveSectorHome(definition.id));
}

/** Verifica si un panel está habilitado para el sector. */
export function sectorHasPanel(sectorId: SectorId, panelId: ResolvedSectorHome["panels"][number]) {
  const home = resolveSectorHome(sectorId);
  return home.panels.includes(panelId);
}

/** Verifica si una acción rápida está permitida para el sector. */
export function sectorHasQuickAction(
  sectorId: SectorId,
  actionId: ResolvedSectorHome["quickActions"][number]
) {
  const home = resolveSectorHome(sectorId);
  return home.quickActions.includes(actionId);
}

/**
 * Renderiza la Home del sector usando el registro de vistas.
 * Punto de entrada único — el engine decide layout, paneles y componente.
 */
export function renderSectorHome(
  sectorId: SectorId,
  viewRegistry: SectorViewRegistry
): ReactElement | null {
  const home = resolveSectorHome(sectorId);
  const ViewComponent = viewRegistry[home.homeViewKey];

  if (!ViewComponent) {
    const Placeholder = viewRegistry["sector-placeholder-home"];
    if (!Placeholder) return null;
    return createElement(Placeholder);
  }

  return createElement(ViewComponent);
}

export type { SectorDefinition, ResolvedSectorHome, SectorViewRegistry };
