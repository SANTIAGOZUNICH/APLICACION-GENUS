import { BandejaEntityType } from "@/types/bandeja/bandeja-task";
import {
  labClients,
  labPeople,
  labProducts,
  labSectors,
  noop,
} from "@/mocks/workspace/lab-context";
import type { WorkspaceTask } from "@/types/workspace/workspace-task";
import { Status } from "@/types/ui/status";

export const depositoTasks: WorkspaceTask[] = [
  {
    id: "dep-mov-001",
    sectionId: "para-mover",
    urgencyScore: 930,
    payload: {
      entityType: BandejaEntityType.PEDIDO,
      data: {
        pedidoId: "PED-2026-1205",
        cliente: labClients.tyl,
        status: Status.PARCIAL,
        compromiso: "08/07/2026",
        avanceDespacho: "4/6 renglones",
        compromisoPorVencer: true,
        primaryAction: { label: "Despachar", onClick: noop },
      },
    },
  },
  {
    id: "dep-mov-002",
    sectionId: "para-mover",
    urgencyScore: 900,
    payload: {
      entityType: BandejaEntityType.LOTE,
      data: {
        itemName: labProducts.bodySplashVerbena,
        loteNumber: "PT-2026-4421",
        status: Status.LIBERADO,
        tipoItem: "Producto terminado",
        saldo: "8.200 u",
        primaryAction: { label: "Despachar contra pedido", onClick: noop },
      },
    },
  },
  {
    id: "dep-mov-003",
    sectionId: "para-mover",
    urgencyScore: 870,
    payload: {
      entityType: BandejaEntityType.TASK,
      data: {
        entityId: "REC-2026-0044",
        title: "Recepción MP — Glicerina USP",
        status: Status.PENDIENTE,
        metadata: [
          { id: "remito", label: "Remito", value: "REM-88421" },
          { id: "sector", label: "Sector", value: labSectors.depositoMp },
          { id: "resp", label: "Responsable", value: labPeople.alberto },
        ],
        primaryAction: { label: "Recepcionar", onClick: noop },
      },
    },
  },
  {
    id: "dep-prob-001",
    sectionId: "problemas",
    urgencyScore: 950,
    payload: {
      entityType: BandejaEntityType.LOTE,
      data: {
        itemName: "Vitamina E — MP",
        loteNumber: "MP-2026-0118",
        status: Status.POR_VENCER,
        tipoItem: "Materia prima",
        saldo: "6 kg",
        vencimiento: "12/07/2026",
        vencimientoProximo: true,
        primaryAction: { label: "Ver saldo", onClick: noop },
      },
    },
  },
  {
    id: "dep-prob-002",
    sectionId: "problemas",
    urgencyScore: 920,
    payload: {
      entityType: BandejaEntityType.TASK,
      data: {
        entityId: "STK-2026-0007",
        title: "Stock crítico — Envase 50 ml premium",
        status: Status.CRITICO,
        metadata: [
          { id: "saldo", label: "Saldo", value: "420 u" },
          { id: "sector", label: "Sector", value: labSectors.depositoMp },
        ],
        primaryAction: { label: "Generar pedido compra", onClick: noop },
      },
    },
  },
  {
    id: "dep-otros-001",
    sectionId: "esperando-otros",
    urgencyScore: 380,
    payload: {
      entityType: BandejaEntityType.LOTE,
      data: {
        itemName: "Glicerina USP — MP",
        loteNumber: "MP-2026-0440",
        status: Status.CUARENTENA,
        tipoItem: "Materia prima",
        saldo: "200 kg",
        primaryAction: { label: "Ver en Calidad", variant: "secondary", onClick: noop },
      },
    },
  },
  {
    id: "dep-fin-001",
    sectionId: "finalizados",
    urgencyScore: 80,
    payload: {
      entityType: BandejaEntityType.PEDIDO,
      data: {
        pedidoId: "PED-2026-1190",
        cliente: labClients.epica,
        status: Status.COMPLETO,
        compromiso: "28/06/2026",
        avanceDespacho: "3/3 renglones",
        primaryAction: { label: "Ver remito", variant: "tertiary", onClick: noop },
      },
    },
  },
];
