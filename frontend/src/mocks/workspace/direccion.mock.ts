import { BandejaEntityType } from "@/types/bandeja/bandeja-task";
import {
  labClients,
  labPeople,
  labProducts,
  labSectors,
  noop,
} from "@/mocks/workspace/lab-context";
import type {
  WorkspacePanoramaMetric,
  WorkspaceTask,
} from "@/types/workspace/workspace-task";
import { Status } from "@/types/ui/status";

export const direccionPanorama: WorkspacePanoramaMetric[] = [
  {
    id: "oe-curso",
    label: "OE en curso",
    value: "4",
    hint: "Elaboración activa",
    tone: "attention",
  },
  {
    id: "cuarentena",
    label: "Lotes en cuarentena",
    value: "7",
    hint: "Esperando Calidad",
    tone: "attention",
  },
  {
    id: "pedidos-riesgo",
    label: "Pedidos en riesgo",
    value: "2",
    hint: "Compromiso ≤ 7 días",
    tone: "problem",
  },
  {
    id: "liberados-hoy",
    label: "Liberados hoy",
    value: "3",
    hint: "PT + Granel",
    tone: "ok",
  },
];

export const direccionTasks: WorkspaceTask[] = [
  {
    id: "dir-exc-001",
    sectionId: "excepciones",
    urgencyScore: 980,
    payload: {
      entityType: BandejaEntityType.TASK,
      data: {
        entityId: "EXC-2026-0009",
        title: "Quiebre de stock — Envase premium 50 ml",
        status: Status.CRITICO,
        metadata: [
          { id: "impacto", label: "Impacto", value: "OA-2026-0092 detenida" },
          { id: "sector", label: "Sector", value: labSectors.envasadoPremium },
        ],
        primaryAction: { label: "Profundizar", onClick: noop },
      },
    },
  },
  {
    id: "dir-exc-002",
    sectionId: "excepciones",
    urgencyScore: 950,
    payload: {
      entityType: BandejaEntityType.PEDIDO,
      data: {
        pedidoId: "PED-2026-1195",
        cliente: labClients.farmaciaOnce,
        status: Status.PARCIAL,
        compromiso: "01/07/2026",
        avanceDespacho: "1/3 renglones",
        compromisoPorVencer: true,
        primaryAction: { label: "Escalar", onClick: noop },
      },
    },
  },
  {
    id: "dir-exc-003",
    sectionId: "excepciones",
    urgencyScore: 920,
    payload: {
      entityType: BandejaEntityType.LOTE,
      data: {
        itemName: labProducts.shampooNutritivo,
        loteNumber: "PT-2026-4405",
        status: Status.RECHAZADO,
        tipoItem: "Producto terminado",
        saldo: "0 u",
        primaryAction: { label: "Revisar rechazo", onClick: noop },
      },
    },
  },
  {
    id: "dir-exc-004",
    sectionId: "excepciones",
    urgencyScore: 880,
    payload: {
      entityType: BandejaEntityType.TASK,
      data: {
        entityId: "EXC-2026-0011",
        title: "Retraso cadena — Body Splash TYL",
        status: Status.POR_VENCER,
        metadata: [
          { id: "pedido", label: "Pedido", value: "PED-2026-1205" },
          { id: "resp", label: "Seguimiento", value: labPeople.santiago },
        ],
        primaryAction: { label: "Coordinar", onClick: noop },
      },
    },
  },
];
