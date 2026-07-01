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

export const produccionTasks: WorkspaceTask[] = [
  {
    id: "prod-dec-001",
    sectionId: "esperando-decision",
    urgencyScore: 910,
    payload: {
      entityType: BandejaEntityType.OE,
      data: {
        oeId: "OE-2026-0142",
        productName: labProducts.granelBodySplash,
        status: Status.EN_CURSO,
        loteGranel: "LG-2026-0842",
        batchSize: "480 kg",
        responsable: labPeople.cristian,
        progressPercent: 100,
        primaryAction: { label: "Cerrar OE", onClick: noop },
        href: entityMockHrefs.oe,
      },
    },
  },
  {
    id: "prod-dec-002",
    sectionId: "esperando-decision",
    urgencyScore: 880,
    payload: {
      entityType: BandejaEntityType.OA,
      data: {
        oaId: "OA-2026-0089",
        skuName: labProducts.bodySplashVerbena,
        status: Status.EN_CURSO,
        lotePt: "PT-2026-4421",
        unidades: "14.400 u",
        responsable: labPeople.joaquin,
        progressPercent: 100,
        primaryAction: { label: "Cerrar OA", onClick: noop },
        href: entityMockHrefs.oa,
      },
    },
  },
  {
    id: "prod-prob-001",
    sectionId: "problemas",
    urgencyScore: 960,
    payload: {
      entityType: BandejaEntityType.TASK,
      data: {
        entityId: "INC-2026-0033",
        title: "Desvío leve en consumo — Vitamina E",
        status: Status.DESVIO_LEVE,
        metadata: [
          { id: "oe", label: "Orden", value: "OE-2026-0138" },
          { id: "sector", label: "Sector", value: labSectors.elaboracion },
          { id: "reporto", label: "Reportó", value: labPeople.natalia },
        ],
        primaryAction: { label: "Resolver desvío", onClick: noop },
      },
    },
  },
  {
    id: "prod-prob-002",
    sectionId: "problemas",
    urgencyScore: 930,
    payload: {
      entityType: BandejaEntityType.OE,
      data: {
        oeId: "OE-2026-0135",
        productName: labProducts.granelCrema,
        status: Status.BLOQUEADO,
        loteGranel: "LG-2026-0835",
        batchSize: "520 kg",
        responsable: labPeople.santino,
        progressPercent: 34,
        primaryAction: { label: "Derivar a Calidad", onClick: noop },
      },
    },
  },
  {
    id: "prod-curso-001",
    sectionId: "en-curso",
    urgencyScore: 720,
    payload: {
      entityType: BandejaEntityType.OE,
      data: {
        oeId: "OE-2026-0145",
        productName: labProducts.granelCrema,
        status: Status.EN_CURSO,
        loteGranel: "LG-2026-0845",
        batchSize: "500 kg",
        responsable: labPeople.cristian,
        progressPercent: 68,
        primaryAction: { label: "Continuar elaboración", onClick: noop },
      },
    },
  },
  {
    id: "prod-curso-002",
    sectionId: "en-curso",
    urgencyScore: 690,
    payload: {
      entityType: BandejaEntityType.OA,
      data: {
        oaId: "OA-2026-0092",
        skuName: labProducts.cremaHidratante,
        status: Status.EN_CURSO,
        lotePt: "PT-2026-4430",
        unidades: "10.800 u",
        responsable: labPeople.nicolas,
        progressPercent: 41,
        primaryAction: { label: "Registrar avance", onClick: noop },
      },
    },
  },
  {
    id: "prod-curso-003",
    sectionId: "en-curso",
    urgencyScore: 660,
    payload: {
      entityType: BandejaEntityType.OA,
      data: {
        oaId: "OA-2026-0094",
        skuName: labProducts.serumAntioxidante,
        status: Status.EN_CURSO,
        lotePt: "PT-2026-4435",
        unidades: "6.000 u",
        responsable: labPeople.joaquin,
        progressPercent: 55,
        primaryAction: { label: "Registrar avance", onClick: noop },
      },
    },
  },
  {
    id: "prod-otros-001",
    sectionId: "esperando-otros",
    urgencyScore: 400,
    payload: {
      entityType: BandejaEntityType.LOTE,
      data: {
        itemName: labProducts.granelBodySplash,
        loteNumber: "LG-2026-0842",
        status: Status.CUARENTENA,
        tipoItem: "Granel",
        saldo: "480 kg",
        primaryAction: { label: "Ver en Calidad", variant: "secondary", onClick: noop },
        href: entityMockHrefs.lote,
      },
    },
  },
  {
    id: "prod-fin-001",
    sectionId: "finalizados",
    urgencyScore: 100,
    payload: {
      entityType: BandejaEntityType.OE,
      data: {
        oeId: "OE-2026-0130",
        productName: labProducts.granelCrema,
        status: Status.CERRADA,
        loteGranel: "LG-2026-0830",
        batchSize: "500 kg",
        responsable: labPeople.cristian,
        progressPercent: 100,
        primaryAction: { label: "Ver registro", variant: "tertiary", onClick: noop },
      },
    },
  },
];
