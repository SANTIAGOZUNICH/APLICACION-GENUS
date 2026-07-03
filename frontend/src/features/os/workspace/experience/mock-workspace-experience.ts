import type { SectorId } from "@/types/operational/sector";
import type { WorkspaceExperienceView } from "./types";

const PRODUCCION_EXPERIENCE: WorkspaceExperienceView = {
  sectorId: "PRODUCCION",
  heroCtaLabel: "Iniciar primera orden",
  workSectionTitle: "Mi trabajo",
  workItems: [
    {
      id: "p1",
      reference: "OE-2026-104",
      lot: "L-26045",
      product: "Shampoo Reparador 250 ml",
      client: "THELMA Y LOUISE",
      status: "active",
      priority: "today",
      meta: "Elaboración · 62% avance",
    },
    {
      id: "p2",
      reference: "OE-2026-108",
      lot: "L-26048",
      product: "Serum Vitamina C",
      client: "BAHIA EVANS",
      status: "ready",
      priority: "urgent",
      meta: "Lista para comenzar",
    },
    {
      id: "p3",
      reference: "OE-2026-112",
      product: "Body Splash Vainilla",
      client: "DISTRIBUIDORA NORTE",
      status: "waiting_quality",
      priority: "normal",
      meta: "En espera de liberación",
    },
    {
      id: "p4",
      reference: "OE-2026-115",
      lot: "L-26051",
      product: "Crema Facial Laude",
      client: "LAUDE",
      status: "ready",
      meta: "Programada · turno tarde",
    },
  ],
  attentionItems: [
    {
      id: "a1",
      kind: "blocked",
      title: "OE-2026-099 bloqueada",
      detail: "Envasado Masivo detenido — falta tapa flip-top 24 mm",
    },
    {
      id: "a2",
      kind: "missing_materials",
      title: "Faltan materiales",
      detail: "MP-4412 Ácido hialurónico · stock insuficiente para OE-2026-108",
    },
    {
      id: "a3",
      kind: "waiting_quality",
      title: "Esperando calidad",
      detail: "Lote L-26045 · Body Splash Vainilla pendiente de análisis microbiológico",
    },
  ],
  nextItems: [
    { id: "n1", label: "OE-2026-108 · Serum Vitamina C", hint: "Siguiente en cola" },
    { id: "n2", label: "OE-2026-115 · Crema Facial Laude", hint: "Turno tarde" },
    { id: "n3", label: "OA-2026-2205 · Envasado Masivo", hint: "Después de elaboración" },
  ],
  recentActivity: [
    { id: "r1", text: "OE-2026-101 cerrada · Shampoo Vitamin Shock", time: "11:40" },
    { id: "r2", text: "Consumo registrado · Lote L-26042", time: "10:15" },
    { id: "r3", text: "OE-2026-097 liberada por Calidad", time: "09:50" },
  ],
};

const CALIDAD_EXPERIENCE: WorkspaceExperienceView = {
  sectorId: "CALIDAD",
  heroCtaLabel: "Liberar primer lote",
  workSectionTitle: "Análisis pendientes",
  workItems: [
    {
      id: "c1",
      reference: "L-26045",
      lot: "L-26045",
      product: "Shampoo Reparador 250 ml",
      client: "THELMA Y LOUISE",
      status: "waiting_approval",
      priority: "urgent",
      meta: "Liberación pendiente",
    },
    {
      id: "c2",
      reference: "L-26048",
      lot: "L-26048",
      product: "Serum Vitamina C",
      client: "BAHIA EVANS",
      status: "active",
      priority: "today",
      meta: "Análisis fisicoquímico en curso",
    },
    {
      id: "c3",
      reference: "L-26051",
      lot: "L-26051",
      product: "Body Splash Vainilla",
      client: "DISTRIBUIDORA NORTE",
      status: "ready",
      meta: "Resultados listos para revisión",
    },
  ],
  attentionItems: [
    {
      id: "ca1",
      kind: "waiting_approval",
      title: "5 lotes esperando liberación",
      detail: "Prioridad: L-26045 Shampoo Reparador y L-26048 Serum Vitamina C",
    },
    {
      id: "ca2",
      kind: "blocked",
      title: "Desvío abierto",
      detail: "L-26039 · pH fuera de spec — requiere evaluación",
    },
    {
      id: "ca3",
      kind: "waiting_quality",
      title: "Control crítico",
      detail: "Microbiología L-26051 · plazo vence hoy 17:00",
    },
  ],
  nextItems: [
    { id: "cn1", label: "L-26045 · Liberación Shampoo Reparador", hint: "Urgente" },
    { id: "cn2", label: "L-26048 · Cierre análisis Serum", hint: "En curso" },
    { id: "cn3", label: "L-26051 · Revisión Body Splash", hint: "Resultados listos" },
  ],
  recentActivity: [
    { id: "cr1", text: "L-26042 liberado · Crema Facial Laude", time: "11:20" },
    { id: "cr2", text: "Desvío registrado · L-26039 pH", time: "10:05" },
    { id: "cr3", text: "Análisis completado · L-26040", time: "09:30" },
  ],
};

const DEPOSITO_EXPERIENCE: WorkspaceExperienceView = {
  sectorId: "DEPOSITO",
  heroCtaLabel: "Recibir primer ingreso",
  workSectionTitle: "Movimientos pendientes",
  workItems: [
    {
      id: "d1",
      reference: "ING-2026-088",
      product: "Ácido hialurónico · MP-4412",
      client: "Proveedor Química Sur",
      status: "ready",
      priority: "urgent",
      meta: "Ingreso · 120 kg",
    },
    {
      id: "d2",
      reference: "DES-2026-041",
      product: "Shampoo Reparador 250 ml",
      client: "Distribuidora Norte",
      status: "active",
      priority: "today",
      meta: "Picking · 14 bultos",
    },
    {
      id: "d3",
      reference: "DES-2026-042",
      product: "Body Splash Vainilla",
      client: "THELMA Y LOUISE",
      status: "ready",
      meta: "Despacho · 09:00 mañana",
    },
    {
      id: "d4",
      reference: "AJU-2026-003",
      product: "Tapas flip-top 24 mm",
      status: "blocked",
      meta: "Ajuste stock · diferencia inventario",
    },
  ],
  attentionItems: [
    {
      id: "da1",
      kind: "missing_materials",
      title: "MP bloquea producción",
      detail: "Ácido hialurónico pendiente de ingreso — afecta OE-2026-108",
    },
    {
      id: "da2",
      kind: "blocked",
      title: "Picking detenido",
      detail: "DES-2026-041 · falta etiqueta frontal en posición B2",
    },
    {
      id: "da3",
      kind: "waiting_approval",
      title: "Esperando aprobación",
      detail: "Ajuste AJU-2026-003 requiere firma de supervisor",
    },
  ],
  nextItems: [
    { id: "dn1", label: "ING-2026-088 · Recepción MP", hint: "Prioridad alta" },
    { id: "dn2", label: "DES-2026-041 · Completar picking", hint: "En curso" },
    { id: "dn3", label: "DES-2026-042 · Preparar despacho", hint: "Mañana temprano" },
  ],
  recentActivity: [
    { id: "dr1", text: "Despacho confirmado · Pedido #4482", time: "11:55" },
    { id: "dr2", text: "Ingreso parcial · Envases PET 250 ml", time: "10:30" },
    { id: "dr3", text: "Picking iniciado · DES-2026-041", time: "09:10" },
  ],
};

const DIRECCION_EXPERIENCE: WorkspaceExperienceView = {
  sectorId: "DIRECCION",
  heroCtaLabel: "Abrir Centro de Operaciones",
  workSectionTitle: "Prioridades operativas",
  workItems: [
    {
      id: "di1",
      reference: "Elaboración",
      product: "2 lotes con riesgo de atraso",
      status: "blocked",
      priority: "urgent",
      meta: "OE-2026-104 y OE-2026-108",
    },
    {
      id: "di2",
      reference: "Envasado Masivo",
      product: "Línea 2 detenida",
      status: "blocked",
      priority: "today",
      meta: "Falta insumo · tapa flip-top",
    },
    {
      id: "di3",
      reference: "Calidad",
      product: "5 liberaciones pendientes",
      status: "waiting_approval",
      meta: "Sin bloqueos críticos",
    },
  ],
  attentionItems: [
    {
      id: "dia1",
      kind: "blocked",
      title: "Sector crítico: Envasado Masivo",
      detail: "Línea 2 detenida hace 2 h — impacto en entrega THELMA Y LOUISE",
    },
    {
      id: "dia2",
      kind: "missing_materials",
      title: "Materia prima retrasada",
      detail: "Ácido hialurónico · ingreso programado hoy 14:00",
    },
    {
      id: "dia3",
      kind: "waiting_quality",
      title: "Calidad · cola de liberación",
      detail: "5 lotes — dentro de plazo, sin escalamiento",
    },
  ],
  nextItems: [
    { id: "din1", label: "Revisar bloqueo Envasado Masivo", hint: "Atención inmediata" },
    { id: "din2", label: "Plan semanal · entregas jueves", hint: "3 pedidos premium" },
    { id: "din3", label: "Sync con Producción · turno tarde", hint: "15:30" },
  ],
  recentActivity: [
    { id: "dir1", text: "Planta estable · 8 de 10 sectores en flujo", time: "12:00" },
    { id: "dir2", text: "Alerta resuelta · Depósito picking", time: "11:15" },
    { id: "dir3", text: "Liberación L-26042 confirmada", time: "10:45" },
  ],
};

const ELABORACION_EXPERIENCE: WorkspaceExperienceView = {
  sectorId: "ELABORACION",
  heroCtaLabel: "Iniciar primer lote",
  workSectionTitle: "Lotes del día",
  workItems: [
    {
      id: "e1",
      reference: "OE-2026-104",
      lot: "L-26045",
      product: "Shampoo Reparador 250 ml",
      client: "THELMA Y LOUISE",
      status: "active",
      priority: "today",
      meta: "Cristian · 800 kg",
    },
    {
      id: "e2",
      reference: "OE-2026-108",
      lot: "L-26048",
      product: "Serum Vitamina C",
      client: "BAHIA EVANS",
      status: "ready",
      meta: "Nicolás · programado",
    },
  ],
  attentionItems: [
    {
      id: "ea1",
      kind: "missing_materials",
      title: "MP pendiente",
      detail: "Ácido hialurónico para OE-2026-108",
    },
  ],
  nextItems: [
    { id: "en1", label: "OE-2026-108 · Serum Vitamina C", hint: "Después del lote actual" },
  ],
  recentActivity: [
    { id: "er1", text: "Lote L-26042 cerrado", time: "11:00" },
  ],
};

const ENVASADO_MASIVO_EXPERIENCE: WorkspaceExperienceView = {
  sectorId: "ENVASADO_MASIVO",
  heroCtaLabel: "Abrir primera OA",
  workSectionTitle: "Líneas activas",
  workItems: [
    {
      id: "em1",
      reference: "OA-2026-2205",
      product: "Shampoo Reparador 250 ml",
      client: "THELMA Y LOUISE",
      status: "active",
      priority: "urgent",
      meta: "Línea 2 · 45% avance",
    },
    {
      id: "em2",
      reference: "OA-2026-2208",
      product: "Body Splash Vainilla",
      status: "ready",
      meta: "Línea 1 · pendiente",
    },
  ],
  attentionItems: [
    {
      id: "ema1",
      kind: "blocked",
      title: "Línea 2 detenida",
      detail: "Falta tapa flip-top 24 mm",
    },
  ],
  nextItems: [{ id: "emn1", label: "OA-2026-2208 · Línea 1", hint: "Siguiente" }],
  recentActivity: [{ id: "emr1", text: "OA-2026-2201 completada", time: "10:20" }],
};

const ENVASADO_PREMIUM_EXPERIENCE: WorkspaceExperienceView = {
  sectorId: "ENVASADO_PREMIUM",
  heroCtaLabel: "Abrir lote premium",
  workSectionTitle: "Lotes premium",
  workItems: [
    {
      id: "ep1",
      reference: "OA-2026-3301",
      product: "Serum Vitamina C",
      client: "BAHIA EVANS",
      status: "active",
      priority: "today",
      meta: "Línea premium · control visual",
    },
  ],
  attentionItems: [],
  nextItems: [],
  recentActivity: [{ id: "epr1", text: "OA-2026-3298 liberada", time: "09:00" }],
};

const EXPERIENCE_BY_SECTOR: Partial<Record<SectorId, WorkspaceExperienceView>> = {
  PRODUCCION: PRODUCCION_EXPERIENCE,
  CALIDAD: CALIDAD_EXPERIENCE,
  DEPOSITO: DEPOSITO_EXPERIENCE,
  DIRECCION: DIRECCION_EXPERIENCE,
  ELABORACION: ELABORACION_EXPERIENCE,
  ENVASADO_MASIVO: ENVASADO_MASIVO_EXPERIENCE,
  ENVASADO_PREMIUM: ENVASADO_PREMIUM_EXPERIENCE,
};

function createFallbackExperience(sectorId: SectorId): WorkspaceExperienceView {
  return {
    sectorId,
    heroCtaLabel: "Empezar trabajo",
    workSectionTitle: "Mi trabajo",
    workItems: [
      {
        id: "fallback-1",
        reference: "OE-2026-100",
        product: "Shampoo Reparador 250 ml",
        status: "ready",
        meta: "Tarea programada",
      },
    ],
    attentionItems: [],
    nextItems: [{ id: "fallback-n1", label: "Revisar plan del día", hint: "Plan semanal" }],
    recentActivity: [{ id: "fallback-r1", text: "Sesión iniciada", time: "Ahora" }],
  };
}

export function getWorkspaceExperience(sectorId: SectorId): WorkspaceExperienceView {
  return EXPERIENCE_BY_SECTOR[sectorId] ?? createFallbackExperience(sectorId);
}

export function listExperienceSectors(): SectorId[] {
  return Object.keys(EXPERIENCE_BY_SECTOR) as SectorId[];
}
