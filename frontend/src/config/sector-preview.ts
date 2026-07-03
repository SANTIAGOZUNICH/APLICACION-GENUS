import type { SectorId } from "@/types/operational/sector";

export interface SectorPreviewProfile {
  mission: string;
  allowedActions: string[];
  deniedActions: string[];
  expectedSources: Array<{
    key: "semanas_2026" | "pedidos_2026" | "asignacion_lotes_2026";
    label: string;
    mapperStatus: "f8_1" | "f8_2_pending";
  }>;
}

/** F8.1 preview — sector capabilities for functional validation (doc 22 §7). */
export const SECTOR_PREVIEW_PROFILES: Partial<Record<SectorId, SectorPreviewProfile>> = {
  ELABORACION: {
    mission: "Ejecutar elaboraciones planificadas; producir granel conforme OE.",
    allowedActions: [
      "Crear OE",
      "Editar OE",
      "Cerrar OE",
      "Marcar avance WorkItem",
      "Registrar observaciones",
    ],
    deniedActions: [
      "Liberar lote",
      "Crear OA",
      "Firmar liberación",
      "Modificar PEDIDOS comerciales",
      "Replanificar SEMANAS global",
    ],
    expectedSources: [
      { key: "semanas_2026", label: "SEMANAS 2026 · Elaboración", mapperStatus: "f8_1" },
      { key: "pedidos_2026", label: "PEDIDOS 2026 (refs)", mapperStatus: "f8_2_pending" },
      { key: "asignacion_lotes_2026", label: "ASIGNACION DE LOTES 2026", mapperStatus: "f8_2_pending" },
    ],
  },
  ENVASADO_MASIVO: {
    mission: "Acondicionar PT línea consumo masivo según plan semanal.",
    allowedActions: [
      "Crear OA",
      "Editar OA",
      "Completar OA",
      "Registrar unidades / avance",
      "Registrar observaciones",
      "Marcar bloqueos",
    ],
    deniedActions: [
      "Liberar lote",
      "Cerrar OE",
      "Ver línea Premium",
      "Firmar RL",
    ],
    expectedSources: [
      { key: "semanas_2026", label: "SEMANAS 2026 · Acondicionamiento Masivo", mapperStatus: "f8_1" },
      { key: "asignacion_lotes_2026", label: "ASIGNACION DE LOTES 2026 (granel liberado)", mapperStatus: "f8_2_pending" },
    ],
  },
  ENVASADO_PREMIUM: {
    mission: "Acondicionar PT línea productos premium.",
    allowedActions: [
      "Crear OA",
      "Editar OA",
      "Completar OA",
      "Registrar unidades / avance",
      "Registrar observaciones",
      "Marcar bloqueos",
    ],
    deniedActions: [
      "Liberar lote",
      "Cerrar OE",
      "Ver línea Masivo",
      "Firmar RL",
    ],
    expectedSources: [
      { key: "semanas_2026", label: "SEMANAS 2026 · Acondicionamiento Premium", mapperStatus: "f8_1" },
      { key: "asignacion_lotes_2026", label: "ASIGNACION DE LOTES 2026 (granel liberado)", mapperStatus: "f8_2_pending" },
    ],
  },
  CALIDAD: {
    mission: "Analizar, documentar resultados y preparar liberaciones.",
    allowedActions: [
      "Crear análisis",
      "Editar análisis",
      "Completar resultados",
      "Preparar liberación",
      "Bloquear lote",
    ],
    deniedActions: [
      "Firmar liberación legal (DT)",
      "Cerrar OE/OA en planta",
      "Despachar",
    ],
    expectedSources: [
      { key: "asignacion_lotes_2026", label: "ASIGNACION DE LOTES 2026", mapperStatus: "f8_2_pending" },
      { key: "semanas_2026", label: "SEMANAS 2026 (no es fuente principal Calidad)", mapperStatus: "f8_1" },
    ],
  },
  PRODUCCION: {
    mission: "Orquestar plan, sectores, prioridades y excepciones.",
    allowedActions: [
      "Replanificar SEMANAS",
      "Mover trabajos",
      "Cambiar prioridades",
      "Crear OE / OA excepcional",
      "Reasignar líneas",
      "Visualizar carga de trabajo",
      "Aprobar cambios",
    ],
    deniedActions: ["Firmar liberación legal (DT)"],
    expectedSources: [
      { key: "semanas_2026", label: "SEMANAS 2026 (plan operativo)", mapperStatus: "f8_1" },
      { key: "pedidos_2026", label: "PEDIDOS 2026", mapperStatus: "f8_2_pending" },
      { key: "asignacion_lotes_2026", label: "ASIGNACION DE LOTES 2026", mapperStatus: "f8_2_pending" },
    ],
  },
};

export const PREVIEW_SECTOR_QUICK_LINKS: SectorId[] = [
  "ELABORACION",
  "ENVASADO_MASIVO",
  "ENVASADO_PREMIUM",
  "CALIDAD",
  "PRODUCCION",
];
