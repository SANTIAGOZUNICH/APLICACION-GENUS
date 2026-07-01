import { BandejaEntityType } from "@/types/bandeja/bandeja-task";
import {
  labPeople,
  labProducts,
  labSectors,
  noop,
} from "@/mocks/workspace/lab-context";
import type { WorkspaceTask } from "@/types/workspace/workspace-task";
import { Status } from "@/types/ui/status";

export const dtTasks: WorkspaceTask[] = [
  {
    id: "dt-firma-001",
    sectionId: "esperando-firma",
    urgencyScore: 960,
    payload: {
      entityType: BandejaEntityType.LIBERACION,
      data: {
        loteNumber: "LG-2026-0835",
        ordenRef: "OE-2026-0135",
        status: Status.BORRADOR_EN_REVISION,
        evidencia: "Análisis completo · registro de lote conforme",
        diasCuarentena: 11,
        primaryAction: { label: "Firmar liberación", onClick: noop },
      },
    },
  },
  {
    id: "dt-firma-002",
    sectionId: "esperando-firma",
    urgencyScore: 930,
    payload: {
      entityType: BandejaEntityType.LIBERACION,
      data: {
        loteNumber: "PT-2026-4418",
        ordenRef: "OA-2026-0088",
        status: Status.BORRADOR_EN_REVISION,
        evidencia: "Micro OK · envasado conforme · trazabilidad ME",
        diasCuarentena: 9,
        primaryAction: { label: "Firmar liberación", onClick: noop },
      },
    },
  },
  {
    id: "dt-firma-003",
    sectionId: "esperando-firma",
    urgencyScore: 900,
    payload: {
      entityType: BandejaEntityType.LIBERACION,
      data: {
        loteNumber: "LG-2026-0830",
        ordenRef: "OE-2026-0130",
        status: Status.BORRADOR_EN_REVISION,
        evidencia: "Granel Crema · especificación vigente",
        diasCuarentena: 7,
        primaryAction: { label: "Firmar liberación", onClick: noop },
      },
    },
  },
  {
    id: "dt-prob-001",
    sectionId: "problemas",
    urgencyScore: 970,
    payload: {
      entityType: BandejaEntityType.LOTE,
      data: {
        itemName: labProducts.shampooNutritivo,
        loteNumber: "PT-2026-4405",
        status: Status.RECHAZADO,
        tipoItem: "Producto terminado",
        saldo: "0 u",
        primaryAction: { label: "Decidir disposición", onClick: noop },
      },
    },
  },
  {
    id: "dt-prob-002",
    sectionId: "problemas",
    urgencyScore: 940,
    payload: {
      entityType: BandejaEntityType.TASK,
      data: {
        entityId: "DT-2026-0004",
        title: "Segregación — OE cerrada por mismo responsable",
        status: Status.BLOQUEADO,
        metadata: [
          { id: "oe", label: "Orden", value: "OE-2026-0128" },
          { id: "sector", label: "Sector", value: labSectors.desarrollo },
          { id: "resp", label: "Farm.", value: labPeople.francisco },
        ],
        primaryAction: { label: "Reasignar firma", onClick: noop },
      },
    },
  },
  {
    id: "dt-fin-001",
    sectionId: "finalizados",
    urgencyScore: 85,
    payload: {
      entityType: BandejaEntityType.LIBERACION,
      data: {
        loteNumber: "PT-2026-4395",
        ordenRef: "OA-2026-0082",
        status: Status.LIBERADO,
        evidencia: "Firmado hoy · bálsamo labial",
        diasCuarentena: 0,
        primaryAction: { label: "Ver registro", variant: "tertiary", onClick: noop },
      },
    },
  },
];
