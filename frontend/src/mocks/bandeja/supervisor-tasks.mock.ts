/**
 * Mock cross-entity tasks for Supervisor persona — /docs/05, /docs/08, /docs/09
 * Not production data. urgencyScore is precalculated for display sorting.
 */

import { BandejaSectionId } from "@/types/bandeja/bandeja-section";
import {
  BandejaEntityType,
  type BandejaDayPulse,
  type BandejaTask,
} from "@/types/bandeja/bandeja-task";
import { Status } from "@/types/ui/status";

const noop = () => undefined;

export const supervisorDayPulse: BandejaDayPulse = {
  completed: 4,
  pending: 12,
};

export const supervisorBandejaTasks: BandejaTask[] = [
  // —— Problemas (highest urgency) ——
  {
    id: "prob-001",
    sectionId: BandejaSectionId.PROBLEMAS,
    urgencyScore: 980,
    payload: {
      entityType: BandejaEntityType.TASK,
      data: {
        entityId: "INC-2026-0041",
        title: "Desvío leve en consumo de MP — Ácido Hialurónico",
        status: Status.DESVIO_LEVE,
        metadata: [
          { id: "oe", label: "Orden", value: "OE-2026-0142" },
          { id: "reporto", label: "Reportó", value: "María G. · hace 2 h" },
        ],
        primaryAction: { label: "Resolver desvío", onClick: noop },
      },
    },
  },
  {
    id: "prob-002",
    sectionId: BandejaSectionId.PROBLEMAS,
    urgencyScore: 960,
    payload: {
      entityType: BandejaEntityType.LOTE,
      data: {
        itemName: "Vitamina E — Materia prima",
        loteNumber: "MP-2026-118",
        status: Status.POR_VENCER,
        tipoItem: "Materia prima",
        saldo: "8 kg",
        vencimiento: "08/07/2026",
        vencimientoProximo: true,
        primaryAction: { label: "Ver trazabilidad", onClick: noop },
      },
    },
  },
  {
    id: "prob-003",
    sectionId: BandejaSectionId.PROBLEMAS,
    urgencyScore: 940,
    payload: {
      entityType: BandejaEntityType.PEDIDO,
      data: {
        pedidoId: "PED-2026-1205",
        cliente: "Farmacia del Sol S.A.",
        status: Status.PARCIAL,
        compromiso: "05/07/2026",
        avanceDespacho: "3/5 renglones",
        compromisoPorVencer: true,
        primaryAction: { label: "Seguir despacho", onClick: noop },
      },
    },
  },

  // —— Ahora ——
  {
    id: "ahora-001",
    sectionId: BandejaSectionId.AHORA,
    urgencyScore: 920,
    payload: {
      entityType: BandejaEntityType.OE,
      data: {
        oeId: "OE-2026-0142",
        productName: "Crema Hidratante Granel",
        status: Status.EN_CURSO,
        loteGranel: "LG-2026-8842",
        batchSize: "500 kg",
        responsable: "María G.",
        progressPercent: 78,
        primaryAction: { label: "Continuar producción", onClick: noop },
      },
    },
  },
  {
    id: "ahora-002",
    sectionId: BandejaSectionId.AHORA,
    urgencyScore: 880,
    payload: {
      entityType: BandejaEntityType.OA,
      data: {
        oaId: "OA-2026-0089",
        skuName: "Crema Hidratante 50 ml",
        status: Status.EN_CURSO,
        lotePt: "PT-2026-4421",
        unidades: "12.000 u",
        responsable: "Carlos R.",
        progressPercent: 52,
        primaryAction: { label: "Registrar avance", onClick: noop },
      },
    },
  },

  // —— Esperando tu decisión ——
  {
    id: "dec-001",
    sectionId: BandejaSectionId.ESPERANDO_DECISION,
    urgencyScore: 860,
    payload: {
      entityType: BandejaEntityType.OE,
      data: {
        oeId: "OE-2026-0138",
        productName: "Serum Antioxidante Granel",
        status: Status.EN_CURSO,
        loteGranel: "LG-2026-8810",
        batchSize: "200 kg",
        responsable: "Lucas P.",
        progressPercent: 100,
        primaryAction: { label: "Cerrar OE", onClick: noop },
      },
    },
  },
  {
    id: "dec-002",
    sectionId: BandejaSectionId.ESPERANDO_DECISION,
    urgencyScore: 840,
    payload: {
      entityType: BandejaEntityType.OA,
      data: {
        oaId: "OA-2026-0085",
        skuName: "Serum Antioxidante 30 ml",
        status: Status.EN_CURSO,
        lotePt: "PT-2026-4410",
        unidades: "6.000 u",
        responsable: "Ana V.",
        progressPercent: 100,
        primaryAction: { label: "Cerrar OA", onClick: noop },
      },
    },
  },
  {
    id: "dec-003",
    sectionId: BandejaSectionId.ESPERANDO_DECISION,
    urgencyScore: 820,
    payload: {
      entityType: BandejaEntityType.LIBERACION,
      data: {
        loteNumber: "LG-2026-8795",
        ordenRef: "OE-2026-0135",
        status: Status.BORRADOR_EN_REVISION,
        evidencia: "Análisis microbiológico OK · pH en spec",
        diasCuarentena: 6,
        primaryAction: { label: "Revisar disposición", onClick: noop },
      },
    },
  },

  // —— En cola ——
  {
    id: "cola-001",
    sectionId: BandejaSectionId.EN_COLA,
    urgencyScore: 620,
    payload: {
      entityType: BandejaEntityType.OE,
      data: {
        oeId: "OE-2026-0145",
        productName: "Gel Limpiador Granel",
        status: Status.PLANIFICADA,
        loteGranel: "—",
        batchSize: "300 kg",
        responsable: "Sin asignar",
        progressPercent: 0,
        primaryAction: { label: "Iniciar elaboración", onClick: noop },
      },
    },
  },
  {
    id: "cola-002",
    sectionId: BandejaSectionId.EN_COLA,
    urgencyScore: 600,
    payload: {
      entityType: BandejaEntityType.OA,
      data: {
        oaId: "OA-2026-0092",
        skuName: "Gel Limpiador 200 ml",
        status: Status.PLANIFICADA,
        lotePt: "—",
        unidades: "8.000 u",
        responsable: "Sin asignar",
        progressPercent: 0,
        primaryAction: { label: "Iniciar acondicionamiento", onClick: noop },
      },
    },
  },
  {
    id: "cola-003",
    sectionId: BandejaSectionId.EN_COLA,
    urgencyScore: 580,
    payload: {
      entityType: BandejaEntityType.PEDIDO,
      data: {
        pedidoId: "PED-2026-1210",
        cliente: "Distribuidora Norte S.R.L.",
        status: Status.PENDIENTE,
        compromiso: "18/07/2026",
        avanceDespacho: "0/3 renglones",
        primaryAction: { label: "Planificar producción", onClick: noop },
      },
    },
  },

  // —— Esperando a otros ——
  {
    id: "otros-001",
    sectionId: BandejaSectionId.ESPERANDO_OTROS,
    urgencyScore: 400,
    payload: {
      entityType: BandejaEntityType.LIBERACION,
      data: {
        loteNumber: "LG-2026-8780",
        ordenRef: "OE-2026-0132",
        status: Status.CUARENTENA,
        evidencia: "En análisis microbiológico",
        diasCuarentena: 4,
        primaryAction: { label: "Ver estado", variant: "secondary", onClick: noop },
      },
    },
  },
  {
    id: "otros-002",
    sectionId: BandejaSectionId.ESPERANDO_OTROS,
    urgencyScore: 380,
    payload: {
      entityType: BandejaEntityType.LOTE,
      data: {
        itemName: "Crema Hidratante 50 ml — PT",
        loteNumber: "PT-2026-4398",
        status: Status.CUARENTENA,
        tipoItem: "Producto terminado",
        saldo: "4.200 u",
        vencimiento: "12/06/2027",
        primaryAction: { label: "Ver trazabilidad", variant: "secondary", onClick: noop },
      },
    },
  },
  {
    id: "otros-003",
    sectionId: BandejaSectionId.ESPERANDO_OTROS,
    urgencyScore: 360,
    payload: {
      entityType: BandejaEntityType.TASK,
      data: {
        entityId: "POSTA-0088",
        title: "Firma de liberación PT — pendiente Dirección Técnica",
        status: Status.PENDIENTE,
        metadata: [
          { id: "lote", label: "Lote", value: "PT-2026-4390" },
          { id: "rol", label: "Responsable", value: "Dirección Técnica" },
        ],
        primaryAction: {
          label: "Ver detalle",
          variant: "secondary",
          onClick: noop,
        },
      },
    },
  },

  // —— Finalizados ——
  {
    id: "fin-001",
    sectionId: BandejaSectionId.FINALIZADOS,
    urgencyScore: 100,
    payload: {
      entityType: BandejaEntityType.OE,
      data: {
        oeId: "OE-2026-0130",
        productName: "Protector Solar SPF50 Granel",
        status: Status.CERRADA,
        loteGranel: "LG-2026-8750",
        batchSize: "400 kg",
        responsable: "María G.",
        progressPercent: 100,
        primaryAction: { label: "Ver registro", variant: "tertiary", onClick: noop },
      },
    },
  },
  {
    id: "fin-002",
    sectionId: BandejaSectionId.FINALIZADOS,
    urgencyScore: 90,
    payload: {
      entityType: BandejaEntityType.PEDIDO,
      data: {
        pedidoId: "PED-2026-1198",
        cliente: "Cadena Farma Centro",
        status: Status.COMPLETO,
        compromiso: "28/06/2026",
        avanceDespacho: "2/2 renglones",
        primaryAction: { label: "Ver pedido", variant: "tertiary", onClick: noop },
      },
    },
  },
  {
    id: "fin-003",
    sectionId: BandejaSectionId.FINALIZADOS,
    urgencyScore: 80,
    payload: {
      entityType: BandejaEntityType.LOTE,
      data: {
        itemName: "Protector Solar SPF50 — PT",
        loteNumber: "PT-2026-4380",
        status: Status.LIBERADO,
        tipoItem: "Producto terminado",
        saldo: "0 u",
        primaryAction: { label: "Ver trazabilidad", variant: "tertiary", onClick: noop },
      },
    },
  },
  {
    id: "fin-004",
    sectionId: BandejaSectionId.FINALIZADOS,
    urgencyScore: 70,
    payload: {
      entityType: BandejaEntityType.OA,
      data: {
        oaId: "OA-2026-0080",
        skuName: "Protector Solar SPF50 60 ml",
        status: Status.CERRADA,
        lotePt: "PT-2026-4380",
        unidades: "10.000 u",
        responsable: "Carlos R.",
        progressPercent: 100,
        primaryAction: { label: "Ver registro", variant: "tertiary", onClick: noop },
      },
    },
  },
];

export {
  supervisorBandejaTasks as bandejaTasks,
  supervisorDayPulse as dayPulse,
};
