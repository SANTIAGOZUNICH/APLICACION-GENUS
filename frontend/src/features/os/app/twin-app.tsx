"use client";

import { usePreviewContext, usePreviewSession } from "@/features/os/session/preview-context";
import { historialSectorsForActor } from "@/features/os/navigation/twin-nav";
import { SECTOR_VIEW_REGISTRY } from "@/features/sectors/registry/sector-view-registry";
import { renderSectorHome } from "@/lib/role-engine";
import {
  ClientDetailView,
  OaDetailView,
  OeDetailView,
  WorkDetailView,
} from "@/features/entities/views/detail-views";
import {
  TwinConfigView,
  TwinInsumosView,
} from "@/features/entities/views/stub-views";
import { WireframePlanSemanal } from "@/features/work/views/plan-semanal";
import { WireframeConsulta } from "@/features/work/views/consulta";
import { WireframeProduccion } from "@/features/sectors/wireframes/produccion";
import { WireframeDireccion } from "@/features/sectors/wireframes/direccion";
import { PendientesDefinirView } from "@/features/os/operational/views/pendientes-definir-view";
import { OeListView } from "@/features/os/operational/views/oe-list-view";
import { OaListView } from "@/features/os/operational/views/oa-list-view";
import { HistorialView } from "@/features/os/operational/views/historial-view";
import { MeIngresosView } from "@/features/os/operational/views/me-ingresos-view";
import { MeSalidasView } from "@/features/os/operational/views/me-salidas-view";
import { MeInventarioView } from "@/features/os/operational/views/me-inventario-view";
import { DepositoGranelesView } from "@/features/os/operational/views/deposito-graneles-view";
import { MeAvisosView } from "@/features/os/operational/views/me-avisos-view";
import { InternalAvisosView } from "@/features/os/operational/views/internal-avisos-view";
import { SemanasProduccionView } from "@/features/os/operational/views/semanas-produccion-view";
import {
  SharedWeeklyPlanViewForCodificado,
  SharedWeeklyPlanViewForMateriaPrima,
} from "@/features/os/operational/views/shared-weekly-plan-view";
import { MpHubView } from "@/features/os/operational/views/mp-hub-view";
import { SemanasSectorView } from "@/features/os/operational/views/semanas-sector-view";
import { AsignacionLotesView } from "@/features/os/operational/views/asignacion-lotes-view";
import { PortalClientesView } from "@/features/os/operational/views/portal-clientes-view";
import { ControlFacturacionView } from "@/features/os/operational/views/control-facturacion-view";
import { EntregadosView } from "@/features/os/operational/views/entregados-view";
import { EntregasView } from "@/features/os/operational/views/entregas-view";
import { RemitosView } from "@/features/os/operational/views/remitos-view";
import { ProductionPedidosView } from "@/features/os/operational/views/production-pedidos-view";
import { ProcedimientosView } from "@/features/os/operational/views/procedimientos-view";
import { MetricasView } from "@/features/os/operational/views/metricas-view";
import {
  ElaboracionOperationalView,
  EnvasadoOperationalView,
} from "@/features/os/operational/views/envasado-operational-view";
import { CodificadoOperationalView } from "@/features/os/operational/views/codificado-operational-view";
import { ExpedicionView } from "@/features/os/operational/views/expedicion-view";
import { DashboardView } from "@/features/os/operational/views/dashboard-view";
import { TwinShell } from "@/features/os/shell/twin-shell";

/** Router del Digital Twin — navegación entre Home, utilidades y detalle. */
export function TwinRouter() {
  const { currentNav } = usePreviewContext();
  const { sectorId } = usePreviewSession();

  switch (currentNav.view) {
    case "mi-trabajo":
      return renderSectorHome(sectorId, SECTOR_VIEW_REGISTRY);
    case "plan-semanal":
      // Administración no tiene plan semanal: cualquier enlace/redirect viejo aterriza en su Control de facturación.
      if (sectorId === "ADMINISTRACION") return <ControlFacturacionView key="control" initialTab="control" />;
      if (sectorId === "CODIFICADO") return <SharedWeeklyPlanViewForCodificado />;
      if (sectorId === "MATERIA_PRIMA") return <SharedWeeklyPlanViewForMateriaPrima />;
      return <WireframePlanSemanal />;
    case "consulta":
      return <WireframeConsulta key={currentNav.query ?? "consulta"} initialQuery={currentNav.query} />;
    case "insumos":
      return <TwinInsumosView />;
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
      return <HistorialView sectors={historialSectorsForActor(sectorId)} />;
    case "pendientes":
      // Circuito sin Calidad: «Pendientes de definir» (trabajos terminados sin destino) — Producción/Dirección.
      return <PendientesDefinirView />;

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
    case "inventario-me":
      return <MeInventarioView />;
    case "deposito-graneles":
      return <DepositoGranelesView />;
    case "avisos":
      return <InternalAvisosView />;
    case "avisos-me":
      return <MeAvisosView />;
    case "semanas-produccion":
      return <SemanasProduccionView />;

    case "semanas-planilla":
      // Pestaña general «Semanas» retirada: enlaces viejos vuelven al inicio del sector.
      return renderSectorHome(sectorId, SECTOR_VIEW_REGISTRY);
    case "semanas-sector":
      return <SemanasSectorView />;
    case "entregas":
      return <EntregasView />;
    case "entregados":
      return <EntregadosView />;
    case "asignacion-lotes":
      return <AsignacionLotesView />;
    case "control-facturacion":
      return <ControlFacturacionView key="control" initialTab="control" />;
    case "portal-clientes":
      return <PortalClientesView />;
    case "remitos":
      return <RemitosView />;
    case "pedidos":
      return <ProductionPedidosView />;
    case "procedimientos":
      return <ProcedimientosView />;
    case "metricas":
      return <MetricasView />;
    case "expedicion":
      return <ExpedicionView />;
    case "dashboard":
      // Administración: su tablero es el de facturación (sin importes), no el de producción.
      return sectorId === "ADMINISTRACION" ? <ControlFacturacionView key="resumen" initialTab="resumen" /> : <DashboardView />;
    case "ver-elaboracion":
      return <ElaboracionOperationalView />;
    case "ver-envasado-masivo":
      return <EnvasadoOperationalView sectorId="ENVASADO_MASIVO" />;
    case "ver-envasado-premium":
      return <EnvasadoOperationalView sectorId="ENVASADO_PREMIUM" />;
    case "ver-codificado":
      return <CodificadoOperationalView />;
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
