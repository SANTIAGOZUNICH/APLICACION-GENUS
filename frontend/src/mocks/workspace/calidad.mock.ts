import { BandejaEntityType } from "@/types/bandeja/bandeja-task";
import {
  labPeople,
  labProducts,
  labSectors,
  noop,
} from "@/mocks/workspace/lab-context";
import { entityMockHrefs } from "@/mocks/entity-pages/hrefs";
import type { WorkspaceTask } from "@/types/workspace/workspace-task";
import { Status } from "@/types/ui/status";

export const calidadTasks: WorkspaceTask[] = [
  {
    id: "cal-anal-001",
    sectionId: "para-analizar",
    urgencyScore: 920,
    payload: {
      entityType: BandejaEntityType.LOTE,
      data: {
        itemName: labProducts.granelBodySplash,
        loteNumber: "LG-2026-0842",
        status: Status.CUARENTENA,
        tipoItem: "Granel",
        saldo: "480 kg",
        vencimiento: "14/08/2027",
        primaryAction: { label: "Cargar análisis", onClick: noop },
        href: entityMockHrefs.lote,
      },
    },
  },
  {
    id: "cal-anal-002",
    sectionId: "para-analizar",
    urgencyScore: 890,
    payload: {
      entityType: BandejaEntityType.LOTE,
      data: {
        itemName: labProducts.cremaHidratante,
        loteNumber: "PT-2026-4418",
        status: Status.CUARENTENA,
        tipoItem: "Producto terminado",
        saldo: "9.600 u",
        vencimiento: "20/06/2027",
        primaryAction: { label: "Cargar análisis", onClick: noop },
      },
    },
  },
  {
    id: "cal-anal-003",
    sectionId: "para-analizar",
    urgencyScore: 860,
    payload: {
      entityType: BandejaEntityType.LIBERACION,
      data: {
        loteNumber: "LG-2026-0838",
        ordenRef: "OE-2026-0138",
        status: Status.CUARENTENA,
        evidencia: "Micro OK · pH 5.8 · aspecto conforme",
        diasCuarentena: 8,
        primaryAction: { label: "Preparar disposición", onClick: noop },
      },
    },
  },
  {
    id: "cal-prob-001",
    sectionId: "problemas",
    urgencyScore: 970,
    payload: {
      entityType: BandejaEntityType.LOTE,
      data: {
        itemName: "Ácido Hialurónico — MP",
        loteNumber: "MP-2026-0331",
        status: Status.FUERA_DE_TOLERANCIA,
        tipoItem: "Materia prima",
        saldo: "12 kg",
        primaryAction: { label: "Evaluar rechazo", onClick: noop },
      },
    },
  },
  {
    id: "cal-prob-002",
    sectionId: "problemas",
    urgencyScore: 940,
    payload: {
      entityType: BandejaEntityType.TASK,
      data: {
        entityId: "CAL-2026-0012",
        title: "Rechazo parcial — Shampoo Nutritivo PT",
        status: Status.RECHAZADO,
        metadata: [
          { id: "lote", label: "Lote", value: "PT-2026-4405" },
          { id: "sector", label: "Sector", value: labSectors.calidad },
          { id: "resp", label: "Analizó", value: labPeople.gabriel },
        ],
        primaryAction: { label: "Revisar evidencia", onClick: noop },
      },
    },
  },
  {
    id: "cal-firma-001",
    sectionId: "esperando-firma",
    urgencyScore: 820,
    payload: {
      entityType: BandejaEntityType.LIBERACION,
      data: {
        loteNumber: "LG-2026-0835",
        ordenRef: "OE-2026-0135",
        status: Status.BORRADOR_EN_REVISION,
        evidencia: "Análisis completo · especificación conforme",
        diasCuarentena: 11,
        primaryAction: { label: "Enviar a DT", onClick: noop },
      },
    },
  },
  {
    id: "cal-fin-001",
    sectionId: "finalizados",
    urgencyScore: 90,
    payload: {
      entityType: BandejaEntityType.LOTE,
      data: {
        itemName: labProducts.balsamoLabial,
        loteNumber: "PT-2026-4395",
        status: Status.LIBERADO,
        tipoItem: "Producto terminado",
        saldo: "24.000 u",
        primaryAction: { label: "Ver disposición", variant: "tertiary", onClick: noop },
      },
    },
  },
];
