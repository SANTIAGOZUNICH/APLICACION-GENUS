import type { SectorId } from "@/types/operational/sector";
import type { WorkspaceExperienceV2 } from "./v2-types";
import { formatGreetingContext } from "./format-greeting-context";

function produccionExperience(firstName: string): WorkspaceExperienceV2 {
  return {
    sectorId: "PRODUCCION",
    mode: "operations",
    focus: {
      greetingContext: formatGreetingContext(firstName),
      reference: "OE-0142",
      workLine: "Shampoo Vitamin Shock — falta cargar consumo de MP",
      metaLine: "Lote base E26014 · 180 kg objetivo",
      ctaLabel: "Cargar consumo",
    },
    statusCounts: { blocked: 1, urgent: 4, inProgress: 2, pending: 6 },
    queues: [
      {
        id: "blocked",
        title: "Bloqueado",
        defaultOpen: true,
        items: [
          {
            id: "b1",
            reference: "OA-0311",
            product: "Crema Facial Laude",
            workLine: "Granel no liberado",
            metaLine: "Esperando disposición de Calidad · lote E26014",
            status: "blocked",
            ctaLabel: "Ver detalle",
          },
        ],
      },
      {
        id: "queued",
        title: "En cola",
        defaultOpen: true,
        items: [
          {
            id: "q1",
            reference: "OE-0143",
            product: "Gel de Ducha Wsabi",
            workLine: "Sin iniciar",
            status: "ready",
            ctaLabel: "Iniciar",
          },
          {
            id: "q2",
            reference: "OE-0144",
            product: "Bioesencia Body Oil",
            workLine: "Sin iniciar",
            status: "ready",
            ctaLabel: "Iniciar",
          },
        ],
      },
      {
        id: "waiting_others",
        title: "Esperando a otros",
        defaultOpen: true,
        items: [
          {
            id: "w1",
            reference: "OE-0140",
            product: "Shampoo Mermer",
            workLine: "Esperando análisis de Calidad",
            status: "waiting_quality",
          },
          {
            id: "w2",
            reference: "OE-0141",
            product: "All Beauty Serum",
            workLine: "Esperando liberación de DT",
            status: "waiting_approval",
          },
        ],
      },
    ],
    completedTodayCount: 6,
    completedTodayLabel: "Finalizados hoy",
  };
}

function calidadExperience(firstName: string): WorkspaceExperienceV2 {
  return {
    sectorId: "CALIDAD",
    mode: "quality_decision",
    focus: {
      greetingContext: formatGreetingContext(firstName),
      reference: "Lote E26014",
      workLine: "Granel — Crema Facial Laude",
      metaLine: "En cuarentena hace 2 días",
      ctaLabel: "Liberar",
      contextLinks: [
        { id: "ficha", label: "Ficha técnica" },
        { id: "mp", label: "Historial MP" },
        { id: "analisis", label: "Análisis prev" },
      ],
      decisions: [
        { id: "reject", label: "Rechazar" },
        { id: "release", label: "Liberar" },
      ],
      queueSectionLabel: "Cola de cuarentena · ordenada por antigüedad",
    },
    queues: [
      {
        id: "queued",
        title: "Cola de cuarentena",
        defaultOpen: true,
        items: [
          {
            id: "cq1",
            reference: "M26008",
            product: "Granel Gel Ducha Wsabi",
            workLine: "En cuarentena",
            status: "waiting_quality",
            ageLabel: "hace 4 días",
          },
          {
            id: "cq2",
            reference: "E26015",
            product: "Granel Shampoo Mermer",
            workLine: "En cuarentena",
            status: "waiting_quality",
            ageLabel: "hace 1 día",
          },
          {
            id: "cq3",
            reference: "E26016",
            product: "PT Bioesencia Body Oil",
            workLine: "En cuarentena",
            status: "waiting_quality",
            ageLabel: "hace 3 hs",
          },
        ],
      },
    ],
    completedTodayCount: 5,
    completedTodayLabel: "Liberados hoy",
  };
}

function depositoExperience(firstName: string): WorkspaceExperienceV2 {
  return {
    sectorId: "DEPOSITO",
    mode: "warehouse",
    focus: {
      greetingContext: formatGreetingContext(firstName),
      reference: "ING-2026-088",
      workLine: "Ácido hialurónico — recepción pendiente de confirmación",
      metaLine: "120 kg · Proveedor Química Sur",
      ctaLabel: "Recibir materiales",
    },
    statusCounts: { blocked: 1, urgent: 3, inProgress: 4, pending: 6 },
    queues: [
      {
        id: "queued",
        title: "Picking",
        defaultOpen: true,
        items: [
          {
            id: "d1",
            reference: "DES-2026-041",
            product: "Shampoo Reparador 250 ml",
            workLine: "14 bultos · Distribuidora Norte",
            status: "active",
            ctaLabel: "Preparar despacho",
          },
        ],
      },
      {
        id: "waiting_others",
        title: "Esperando aprobación",
        defaultOpen: true,
        items: [
          {
            id: "d2",
            reference: "AJU-2026-003",
            product: "Tapas flip-top 24 mm",
            workLine: "Ajuste stock · diferencia inventario",
            status: "waiting_approval",
          },
        ],
      },
    ],
    completedTodayCount: 4,
    completedTodayLabel: "Despachos confirmados hoy",
  };
}

function direccionExperience(firstName: string): WorkspaceExperienceV2 {
  return {
    sectorId: "DIRECCION",
    mode: "direction_panorama",
    focus: {
      greetingContext: formatGreetingContext(firstName),
      reference: "",
      workLine: "",
      ctaLabel: "Centro de Operaciones",
      calmState: {
        title: "No hay excepciones activas hoy.",
        subtitle: "Todo avanza dentro de lo esperado.",
      },
    },
    panorama: {
      calm: true,
      calmTitle: "No hay excepciones activas hoy.",
      calmSubtitle: "Todo avanza dentro de lo esperado.",
      metrics: [
        { value: "8", label: "OE activas" },
        { value: "5", label: "en cuarentena" },
        { value: "2", label: "pedidos en riesgo" },
        { value: "97%", label: "on-time este mes" },
      ],
    },
    queues: [],
    recentActivity: [
      { id: "dr1", text: "Planta estable · 8 de 10 sectores en flujo", time: "12:00" },
      { id: "dr2", text: "Liberación L-26042 confirmada", time: "10:45" },
    ],
  };
}

function defaultOperationsExperience(
  sectorId: SectorId,
  firstName: string
): WorkspaceExperienceV2 {
  return {
    sectorId,
    mode: "operations",
    focus: {
      greetingContext: formatGreetingContext(firstName),
      reference: "OE-2026-100",
      workLine: "Sin tareas pendientes por ahora",
      metaLine: "Las próximas órdenes se preparan automáticamente cuando estén listas.",
      ctaLabel: "Empezar trabajo",
      calmState: {
        title: "Sin tareas pendientes por ahora",
        subtitle: "Las próximas órdenes se preparan automáticamente cuando estén listas.",
      },
    },
    queues: [],
  };
}

const BUILDERS: Partial<Record<SectorId, (firstName: string) => WorkspaceExperienceV2>> = {
  PRODUCCION: produccionExperience,
  CALIDAD: calidadExperience,
  DEPOSITO: depositoExperience,
  DIRECCION: direccionExperience,
};

export function getWorkspaceExperienceV2(
  sectorId: SectorId,
  firstName: string
): WorkspaceExperienceV2 {
  const builder = BUILDERS[sectorId];
  return builder ? builder(firstName) : defaultOperationsExperience(sectorId, firstName);
}

export function listExperienceV2Sectors(): SectorId[] {
  return Object.keys(BUILDERS) as SectorId[];
}
