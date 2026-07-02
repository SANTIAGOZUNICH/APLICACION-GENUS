export type PreviewScreenId =
  | "architecture"
  | "envasado-masivo"
  | "envasado-premium"
  | "elaboracion"
  | "calidad"
  | "deposito"
  | "produccion"
  | "direccion"
  | "plan-semanal"
  | "consulta";

export interface PreviewScreenMeta {
  id: PreviewScreenId;
  label: string;
  sector?: string;
  description: string;
  viewType: "lista" | "mesa" | "checklist" | "control" | "ejecutivo" | "calendario" | "spotlight" | "doc";
}

export const PREVIEW_SCREENS: PreviewScreenMeta[] = [
  {
    id: "architecture",
    label: "Arquitectura",
    description: "Capas, patrones y tokens del rediseño F9.",
    viewType: "doc",
  },
  {
    id: "envasado-masivo",
    label: "Envasado Masivo",
    sector: "ENVASADO_MASIVO",
    description: "Órdenes de trabajo por línea — sin KPIs.",
    viewType: "lista",
  },
  {
    id: "envasado-premium",
    label: "Envasado Premium",
    sector: "ENVASADO_PREMIUM",
    description: "Igual que Masivo — jamás mezcla líneas.",
    viewType: "lista",
  },
  {
    id: "elaboracion",
    label: "Elaboración",
    sector: "ELABORACION",
    description: "Trabajos del día con OE y kg.",
    viewType: "lista",
  },
  {
    id: "calidad",
    label: "Calidad",
    sector: "CALIDAD",
    description: "Mesa de laboratorio — lotes y liberaciones.",
    viewType: "mesa",
  },
  {
    id: "deposito",
    label: "Depósito",
    sector: "DEPOSITO",
    description: "Checklist de preparación de insumos por pedido.",
    viewType: "checklist",
  },
  {
    id: "produccion",
    label: "Producción",
    sector: "PRODUCCION",
    description: "Centro de control — barras de carga y problemas.",
    viewType: "control",
  },
  {
    id: "direccion",
    label: "Dirección",
    sector: "DIRECCION",
    description: "Panorama ejecutivo — sin acciones operativas.",
    viewType: "ejecutivo",
  },
  {
    id: "plan-semanal",
    label: "Plan semanal",
    description: "Columnas L–V inspiradas en SEMANAS 2026.",
    viewType: "calendario",
  },
  {
    id: "consulta",
    label: "Consulta",
    description: "Buscador global tipo Spotlight.",
    viewType: "spotlight",
  },
];

export const OS_NAV_ITEMS = [
  { id: "mi-trabajo", label: "Mi trabajo", icon: "briefcase" as const },
  { id: "plan-semanal", label: "Plan semanal", icon: "calendar" as const },
  { id: "consulta", label: "Consulta", icon: "search" as const },
  { id: "insumos", label: "Insumos", icon: "package" as const },
  { id: "calidad", label: "Calidad", icon: "shield" as const },
  { id: "config", label: "Configuración", icon: "settings" as const },
];

export const OS_NAV_RESTRICTED = [
  { id: "produccion", label: "Producción", icon: "factory" as const },
  { id: "direccion", label: "Dirección", icon: "layout" as const },
];
