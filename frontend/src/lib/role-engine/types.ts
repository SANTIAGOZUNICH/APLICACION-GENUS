import type { ComponentType } from "react";
import type { SectorId } from "@/types/operational/sector";

/** Layout principal de la Home del sector — determina composición visual. */
export const HOME_LAYOUTS = [
  "packaging_lines",
  "work_blocks",
  "lab_bench",
  "prep_checklist",
  "control_tower",
  "executive_signals",
  "encoding_queue",
  "supply_prep",
  "commercial_pipeline",
  "placeholder",
] as const;

export type HomeLayoutId = (typeof HOME_LAYOUTS)[number];

/** Paneles disponibles en la Home — el engine decide cuáles renderizar. */
export const PANEL_IDS = [
  "header_greeting",
  "date_navigator",
  "summary_strip",
  "line_work_cards",
  "work_block_list",
  "week_plan",
  "context_panel",
  "quality_bench",
  "insumo_checklist",
  "load_bars",
  "problem_feed",
  "executive_signals",
] as const;

export type PanelId = (typeof PANEL_IDS)[number];

/** Acciones rápidas visibles en bloques de trabajo. */
export const QUICK_ACTION_IDS = [
  "open_oa",
  "create_oa",
  "mark_done",
  "report_problem",
  "open_oe",
  "create_oe",
  "mark_started",
  "mark_finished",
  "approve_lot",
  "reject_lot",
  "register_result",
  "prepare_insumos",
  "resolve_blocker",
  "view_plan",
  "consult_entity",
] as const;

export type QuickActionId = (typeof QUICK_ACTION_IDS)[number];

/** Entidades visibles para el sector (navegación / consulta). */
export const VISIBLE_ENTITY_IDS = [
  "work_item",
  "oe",
  "oa",
  "lote",
  "pedido",
  "liberacion",
  "insumo",
  "plan_semanal",
] as const;

export type VisibleEntityId = (typeof VISIBLE_ENTITY_IDS)[number];

/** Fuentes de WorkItems que consume el sector. */
export const WORK_ITEM_SOURCE_KEYS = [
  "semanas_2026",
  "pedidos_2026",
  "asignacion_lotes_2026",
] as const;

export type WorkItemSourceKey = (typeof WORK_ITEM_SOURCE_KEYS)[number];

/** Ítems de sidebar operativa del sector. */
export const SIDEBAR_ITEM_IDS = [
  "mi_trabajo",
  "plan_semanal",
  "consulta",
  "insumos",
  "calidad",
  "configuracion",
  "produccion",
  "direccion",
  "ordenes_elaboracion",
  "ordenes_acondicionamiento",
  "ordenes",
  "historial",
  "pendientes",
  "aprobados",
  "rechazados",
  "stock",
  "control_mp",
  "mp_ingresos",
  "mp_compras",
  "ingresos_me",
  "salidas_me",
  "inventario_me",
  "avisos_me",
  "semanas_produccion",
  "asignar_trabajos",
  "entregados",
  "asignacion_lotes",
  "ver_elaboracion",
  "ver_envasado_masivo",
  "ver_envasado_premium",
  "ver_calidad",
  "ver_materia_prima",
] as const;

export type SidebarItemId = (typeof SIDEBAR_ITEM_IDS)[number];

/** Clave del componente Home — resuelta por registro de vistas (preview / app futura). */
export type SectorViewKey =
  | "envasado-masivo-home"
  | "envasado-premium-home"
  | "elaboracion-home"
  | "calidad-home"
  | "deposito-home"
  | "produccion-home"
  | "direccion-home"
  | "codificado-home"
  | "materia-prima-home"
  | "comercial-home"
  | "sector-placeholder-home";

export interface CreamyContextDefinition {
  /** Rol del copiloto para este sector — no chatbot genérico. */
  role: string;
  /** Temas en los que Creamy puede asistir. */
  topics: string[];
  /** Hint por defecto cuando no hay trabajo activo. */
  defaultHint: string;
  /** Sugerencias base (chips) antes de contexto dinámico. */
  baseSuggestions: string[];
}

export interface SectorEmptyState {
  title: string;
  message: string;
}

/** Definición declarativa de un sector — única fuente de verdad para la Home. */
export interface SectorDefinition {
  id: SectorId;
  title: string;
  description: string;
  homeLayout: HomeLayoutId;
  visiblePanels: PanelId[];
  quickActions: QuickActionId[];
  visibleEntities: VisibleEntityId[];
  workItemSources: WorkItemSourceKey[];
  allowedActions: string[];
  sidebarItems: SidebarItemId[];
  restrictedSidebarItems?: SidebarItemId[];
  /** Override de label de sidebar por ítem — para reusar un id con copy distinto por sector. */
  sidebarLabelOverrides?: Partial<Record<SidebarItemId, string>>;
  creamyContext: CreamyContextDefinition;
  emptyState: SectorEmptyState;
  /** Clave del componente Home en el registro de vistas. */
  homeViewKey: SectorViewKey;
  /** Modo de datos actual del sector en preview. */
  dataMode: "work_items" | "mock" | "placeholder";
}

export interface ResolvedSectorHome {
  sector: SectorId;
  definition: SectorDefinition;
  layout: HomeLayoutId;
  panels: PanelId[];
  quickActions: QuickActionId[];
  visibleEntities: VisibleEntityId[];
  workItemSources: WorkItemSourceKey[];
  allowedActions: string[];
  sidebarItems: SidebarItemId[];
  sidebarLabelOverrides: Partial<Record<SidebarItemId, string>>;
  creamyContext: CreamyContextDefinition;
  emptyState: SectorEmptyState;
  homeViewKey: SectorViewKey;
  dataMode: SectorDefinition["dataMode"];
}

export type SectorViewRegistry = Record<SectorViewKey, ComponentType | undefined>;
