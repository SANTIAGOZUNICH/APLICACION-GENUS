"use client";

import { usePreviewContext, usePreviewSession } from "@/design-preview/lib/preview-context";
import { SECTOR_VIEW_REGISTRY } from "@/design-preview/sector-view-registry";
import { renderSectorHome } from "@/lib/role-engine";
import {
  ClientDetailView,
  OaDetailView,
  OeDetailView,
  WorkDetailView,
} from "@/design-preview/views/detail-views";
import {
  TwinCalidadNavView,
  TwinConfigView,
  TwinInsumosView,
} from "@/design-preview/views/stub-views";
import { WireframePlanSemanal } from "@/design-preview/wireframes/plan-semanal";
import { WireframeConsulta } from "@/design-preview/wireframes/consulta";
import { WireframeProduccion } from "@/design-preview/wireframes/produccion";
import { WireframeDireccion } from "@/design-preview/wireframes/direccion";

/** Router del Digital Twin — navegación entre Home, utilidades y detalle. */
export function TwinRouter() {
  const { currentNav } = usePreviewContext();
  const { sectorId } = usePreviewSession();

  switch (currentNav.view) {
    case "mi-trabajo":
      return renderSectorHome(sectorId, SECTOR_VIEW_REGISTRY);
    case "plan-semanal":
      return <WireframePlanSemanal />;
    case "consulta":
      return <WireframeConsulta key={currentNav.query ?? "consulta"} initialQuery={currentNav.query} />;
    case "insumos":
      return <TwinInsumosView />;
    case "calidad":
      return <TwinCalidadNavView />;
    case "config":
      return <TwinConfigView />;
    case "produccion":
      return <WireframeProduccion />;
    case "direccion":
      return <WireframeDireccion />;
    case "work-detail":
      return <WorkDetailView />;
    case "oa-detail":
      return <OaDetailView />;
    case "oe-detail":
      return <OeDetailView />;
    case "client-detail":
      return <ClientDetailView />;
    default:
      return renderSectorHome(sectorId, SECTOR_VIEW_REGISTRY);
  }
}
