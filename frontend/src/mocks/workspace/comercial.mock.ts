import { BandejaEntityType } from "@/types/bandeja/bandeja-task";
import {
  labClients,
  labPeople,
  labProducts,
  noop,
} from "@/mocks/workspace/lab-context";
import type { WorkspaceTask } from "@/types/workspace/workspace-task";
import { Status } from "@/types/ui/status";

export const comercialTasks: WorkspaceTask[] = [
  {
    id: "com-seg-001",
    sectionId: "necesita-seguimiento",
    urgencyScore: 940,
    payload: {
      entityType: BandejaEntityType.PEDIDO,
      data: {
        pedidoId: "PED-2026-1218",
        cliente: labClients.heburn,
        status: Status.PARCIAL,
        compromiso: "06/07/2026",
        avanceDespacho: "1/4 renglones",
        compromisoPorVencer: true,
        primaryAction: { label: "Apurar producción", onClick: noop },
      },
    },
  },
  {
    id: "com-seg-002",
    sectionId: "necesita-seguimiento",
    urgencyScore: 910,
    payload: {
      entityType: BandejaEntityType.PEDIDO,
      data: {
        pedidoId: "PED-2026-1212",
        cliente: labClients.bl,
        status: Status.PENDIENTE,
        compromiso: "10/07/2026",
        avanceDespacho: "0/2 renglones",
        primaryAction: { label: "Seguir pedido", onClick: noop },
      },
    },
  },
  {
    id: "com-prod-001",
    sectionId: "en-produccion",
    urgencyScore: 700,
    payload: {
      entityType: BandejaEntityType.PEDIDO,
      data: {
        pedidoId: "PED-2026-1205",
        cliente: labClients.tyl,
        status: Status.PARCIAL,
        compromiso: "08/07/2026",
        avanceDespacho: "4/6 renglones",
        primaryAction: { label: "Ver avance", onClick: noop },
      },
    },
  },
  {
    id: "com-prod-002",
    sectionId: "en-produccion",
    urgencyScore: 680,
    payload: {
      entityType: BandejaEntityType.OA,
      data: {
        oaId: "OA-2026-0096",
        skuName: labProducts.pomadaBarba,
        status: Status.EN_CURSO,
        lotePt: "PT-2026-4440",
        unidades: "5.000 u",
        responsable: labPeople.nicolas,
        progressPercent: 62,
        primaryAction: { label: "Ver en Producción", variant: "secondary", onClick: noop },
      },
    },
  },
  {
    id: "com-listo-001",
    sectionId: "listos-despachar",
    urgencyScore: 750,
    payload: {
      entityType: BandejaEntityType.PEDIDO,
      data: {
        pedidoId: "PED-2026-1201",
        cliente: labClients.niza,
        status: Status.PARCIAL,
        compromiso: "12/07/2026",
        avanceDespacho: "2/2 renglones PT listo",
        primaryAction: { label: "Coordinar despacho", onClick: noop },
      },
    },
  },
  {
    id: "com-prob-001",
    sectionId: "problemas",
    urgencyScore: 960,
    payload: {
      entityType: BandejaEntityType.PEDIDO,
      data: {
        pedidoId: "PED-2026-1195",
        cliente: labClients.farmaciaOnce,
        status: Status.PARCIAL,
        compromiso: "01/07/2026",
        avanceDespacho: "1/3 renglones",
        compromisoPorVencer: true,
        primaryAction: { label: "Escalar retraso", onClick: noop },
      },
    },
  },
  {
    id: "com-cerr-001",
    sectionId: "cerrados",
    urgencyScore: 70,
    payload: {
      entityType: BandejaEntityType.PEDIDO,
      data: {
        pedidoId: "PED-2026-1188",
        cliente: labClients.tcl,
        status: Status.COMPLETO,
        compromiso: "27/06/2026",
        avanceDespacho: "5/5 renglones",
        primaryAction: { label: "Ver pedido", variant: "tertiary", onClick: noop },
      },
    },
  },
];
