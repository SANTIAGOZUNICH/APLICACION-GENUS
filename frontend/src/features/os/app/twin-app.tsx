"use client";

import { usePreviewContext, usePreviewSession } from "@/features/os/session/preview-context";
import { SECTOR_VIEW_REGISTRY } from "@/features/sectors/registry/sector-view-registry";
import { renderSectorHome } from "@/lib/role-engine";
import {
  ClientDetailView,
  OaDetailView,
  OeDetailView,
  WorkDetailView,
} from "@/features/entities/views/detail-views";
import {
  TwinCalidadNavView,
  TwinConfigView,
  TwinInsumosView,
} from "@/features/entities/views/stub-views";
import { WireframePlanSemanal } from "@/features/work/views/plan-semanal";
import { WireframeConsulta } from "@/features/work/views/consulta";
import { WireframeProduccion } from "@/features/sectors/wireframes/produccion";
import { WireframeDireccion } from "@/features/sectors/wireframes/direccion";
import { CalidadOperationalView } from "@/features/os/operational/views/calidad-operational-view";
import { OeListView } from "@/features/os/operational/views/oe-list-view";
import { OaListView } from "@/features/os/operational/views/oa-list-view";
import { HistorialView } from "@/features/os/operational/views/historial-view";
import { MeIngresosView } from "@/features/os/operational/views/me-ingresos-view";
import { MeSalidasView } from "@/features/os/operational/views/me-salidas-view";
import { MeAvisosView } from "@/features/os/operational/views/me-avisos-view";
import { SemanasProduccionView } from "@/features/os/operational/views/semanas-produccion-view";
import { MpHubView } from "@/features/os/operational/views/mp-hub-view";
import { AsignarTrabajosView } from "@/features/os/operational/views/asignar-trabajos-view";
import { AsignacionLotesView } from "@/features/os/operational/views/asignacion-lotes-view";
import { EntregadosView } from "@/features/os/operational/views/entregados-view";
import {
  ElaboracionOperationalView,
  EnvasadoOperationalView,
} from "@/features/os/operational/views/envasado-operational-view";
import { TwinShell } from "@/features/os/shell/twin-shell";

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

    case "ordenes-elaboracion":
      return <OeListView />;
    case "ordenes-acondicionamiento": {
      if (sectorId === "ENVASADO_MASIVO" || sectorId === "ENVASADO_PREMIUM") {
        return <OaListView sectorId={sectorId} />;
      }
      return <OaListView />;
    }
    case "ordenes":
      return (
        <TwinShell title="Órdenes">
          <div className="space-y-10">
            <OeListView embedded />
            <OaListView embedded title="Órdenes de Acondicionamiento" />
          </div>
        </TwinShell>
      );
    case "historial":
      return (
        <HistorialView
          sectors={
            sectorId === "PRODUCCION"
              ? ["ELABORACION", "ENVASADO_MASIVO", "ENVASADO_PREMIUM"]
              : sectorId === "MATERIA_PRIMA"
                ? ["ELABORACION"]
                : [sectorId]
          }
        />
      );
    case "pendientes":
      return <CalidadOperationalView initialTab="pendientes" />;
    case "aprobados":
      return <CalidadOperationalView initialTab="aprobados" />;
    case "rechazados":
      return <CalidadOperationalView initialTab="rechazados" />;

    case "stock":
      return <MpHubView key="Stock" initialTab="Stock" />;
    case "mp-ingresos":
      return <MpHubView key="Ingresos MP" initialTab="Ingresos MP" />;
    case "control-mp":
      return <MpHubView key="Control semanal" initialTab="Control semanal" />;
    case "mp-compras":
      return <MpHubView key="Compras MP" initialTab="Compras MP" />;

    case "ingresos-me":
      return <MeIngresosView />;
    case "salidas-me":
      return <MeSalidasView />;
    case "avisos-me":
      return <MeAvisosView />;
    case "semanas-produccion":
      return <SemanasProduccionView />;

    case "asignar-trabajos":
      return <AsignarTrabajosView />;
    case "entregados":
      return <EntregadosView />;
    case "asignacion-lotes":
      return <AsignacionLotesView />;
    case "ver-elaboracion":
      return <ElaboracionOperationalView />;
    case "ver-envasado-masivo":
      return <EnvasadoOperationalView sectorId="ENVASADO_MASIVO" />;
    case "ver-envasado-premium":
      return <EnvasadoOperationalView sectorId="ENVASADO_PREMIUM" />;
    case "ver-calidad":
      return <CalidadOperationalView />;
    case "ver-materia-prima":
      return <MpHubView initialTab="Stock" />;

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
