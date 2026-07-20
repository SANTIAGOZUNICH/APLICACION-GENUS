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
import { MateriaPrimaStockView } from "@/features/os/operational/views/materia-prima-stock-view";
import { MateriaPrimaControlView } from "@/features/os/operational/views/materia-prima-control-view";
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
    case "ordenes-acondicionamiento":
      return (
        <OaListView
          sectorId={sectorId === "ENVASADO_PREMIUM" ? "ENVASADO_PREMIUM" : "ENVASADO_MASIVO"}
        />
      );
    case "ordenes":
      return (
        <TwinShell title="Órdenes">
          <div className="space-y-10">
            <OeListView readOnly embedded />
            <OaListView sectorId="ENVASADO_MASIVO" readOnly embedded title="Órdenes de Acondicionamiento — Masivo" />
            <OaListView sectorId="ENVASADO_PREMIUM" readOnly embedded title="Órdenes de Acondicionamiento — Premium" />
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
      return <MateriaPrimaStockView />;
    case "control-mp":
      return <MateriaPrimaControlView />;

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
      return <MateriaPrimaStockView />;

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
