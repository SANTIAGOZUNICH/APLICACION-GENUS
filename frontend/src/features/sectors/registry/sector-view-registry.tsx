"use client";

import type { ComponentType } from "react";
import type { SectorId } from "@/types/operational/sector";
import type { SectorViewKey, SectorViewRegistry } from "@/lib/role-engine";
import { resolveSectorHome } from "@/lib/role-engine";
import { DynamicWorkspaceHome } from "@/features/os/workspace/components/dynamic-workspace-home";
import { SectorHomePlaceholder } from "../components/sector-home-placeholder";

function createPlaceholderView(sectorId: SectorId): ComponentType {
  return function SectorPlaceholderView() {
    const home = resolveSectorHome(sectorId);
    return <SectorHomePlaceholder home={home} />;
  };
}

/** Registro de vistas Home — workspace dinámico vía PR 5.1. */
export const SECTOR_VIEW_REGISTRY: SectorViewRegistry = {
  "envasado-masivo-home": DynamicWorkspaceHome,
  "envasado-premium-home": DynamicWorkspaceHome,
  "elaboracion-home": DynamicWorkspaceHome,
  "calidad-home": DynamicWorkspaceHome,
  "deposito-home": DynamicWorkspaceHome,
  "produccion-home": DynamicWorkspaceHome,
  "direccion-home": DynamicWorkspaceHome,
  "codificado-home": createPlaceholderView("CODIFICADO"),
  "materia-prima-home": DynamicWorkspaceHome,
  "comercial-home": createPlaceholderView("COMERCIAL"),
  "sector-placeholder-home": createPlaceholderView("CODIFICADO"),
};

/** Pantallas del preview que resuelven Home vía Role Engine. */
export const PREVIEW_SCREEN_TO_SECTOR: Partial<Record<string, SectorId>> = {
  "envasado-masivo": "ENVASADO_MASIVO",
  "envasado-premium": "ENVASADO_PREMIUM",
  elaboracion: "ELABORACION",
  calidad: "CALIDAD",
  deposito: "DEPOSITO",
  produccion: "PRODUCCION",
  direccion: "DIRECCION",
};

export function isRoleEngineScreen(screenId: string): screenId is keyof typeof PREVIEW_SCREEN_TO_SECTOR {
  return screenId in PREVIEW_SCREEN_TO_SECTOR;
}

export function sectorIdForPreviewScreen(screenId: string): SectorId | undefined {
  return PREVIEW_SCREEN_TO_SECTOR[screenId];
}

export function viewKeyForSector(sectorId: SectorId): SectorViewKey {
  return resolveSectorHome(sectorId).homeViewKey;
}
