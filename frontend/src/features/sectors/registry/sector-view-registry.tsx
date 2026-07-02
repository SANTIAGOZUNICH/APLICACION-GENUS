"use client";

import type { ComponentType } from "react";
import type { SectorId } from "@/types/operational/sector";
import type { SectorViewKey, SectorViewRegistry } from "@/lib/role-engine";
import { resolveSectorHome } from "@/lib/role-engine";
import { SectorHomePlaceholder } from "../components/sector-home-placeholder";
import { WireframeCalidad } from "../wireframes/calidad";
import { WireframeDeposito } from "../wireframes/deposito";
import { WireframeDireccion } from "../wireframes/direccion";
import { WireframeElaboracion } from "../wireframes/elaboracion";
import { WireframeEnvasadoMasivo } from "../wireframes/envasado-masivo";
import { WireframeEnvasadoPremium } from "../wireframes/envasado-premium";
import { WireframeProduccion } from "../wireframes/produccion";

function createPlaceholderView(sectorId: SectorId): ComponentType {
  return function SectorPlaceholderView() {
    const home = resolveSectorHome(sectorId);
    return <SectorHomePlaceholder home={home} />;
  };
}

/** Registro de vistas Home — único lugar que mapea viewKey → componente React. */
export const SECTOR_VIEW_REGISTRY: SectorViewRegistry = {
  "envasado-masivo-home": WireframeEnvasadoMasivo,
  "envasado-premium-home": WireframeEnvasadoPremium,
  "elaboracion-home": WireframeElaboracion,
  "calidad-home": WireframeCalidad,
  "deposito-home": WireframeDeposito,
  "produccion-home": WireframeProduccion,
  "direccion-home": WireframeDireccion,
  "codificado-home": createPlaceholderView("CODIFICADO"),
  "materia-prima-home": createPlaceholderView("MATERIA_PRIMA"),
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
