import { defineSector } from "@/lib/role-engine/sector-definition";
import type { SectorDefinition } from "@/lib/role-engine/types";
import type { SectorId } from "@/types/operational/sector";

const BASE_SIDEBAR = [
  "mi_trabajo",
  "plan_semanal",
  "consulta",
  "insumos",
  "calidad",
  "configuracion",
] as const;

export const SECTOR_DEFINITIONS: SectorDefinition[] = [
  defineSector({
    id: "ENVASADO_MASIVO",
    title: "Envasado Masivo",
    description: "Acondicionar PT línea consumo masivo según plan semanal.",
    homeLayout: "packaging_lines",
    visiblePanels: [
      "header_greeting",
      "date_navigator",
      "summary_strip",
      "line_work_cards",
      "week_plan",
      "context_panel",
    ],
    quickActions: ["open_oa", "create_oa", "mark_done", "report_problem"],
    visibleEntities: ["work_item", "oa", "pedido", "plan_semanal"],
    workItemSources: ["semanas_2026"],
    allowedActions: [
      "Crear OA",
      "Abrir OA",
      "Entregar a Calidad",
      "Reportar problema",
      "Registrar avance",
    ],
    sidebarItems: ["mi_trabajo", "ordenes_acondicionamiento", "historial"],
    creamyContext: {
      role: "Copiloto de envasado masivo",
      topics: ["prioridades", "OA", "bloqueos", "insumos", "entregas"],
      defaultHint:
        "Sin trabajo asignado. Puedo ayudarte a revisar el plan semanal o consultar un pedido.",
      baseSuggestions: ["Ver plan semanal", "Consultar pedido", "Revisar bloqueos"],
    },
    emptyState: {
      title: "Sin trabajo asignado",
      message: "No hay trabajos para este día en SEMANAS 2026.",
    },
    homeViewKey: "envasado-masivo-home",
    dataMode: "work_items",
  }),

  defineSector({
    id: "ENVASADO_PREMIUM",
    title: "Envasado Premium",
    description: "Acondicionar PT línea productos premium — aislado de Masivo.",
    homeLayout: "packaging_lines",
    visiblePanels: [
      "header_greeting",
      "date_navigator",
      "summary_strip",
      "line_work_cards",
      "week_plan",
      "context_panel",
    ],
    quickActions: ["open_oa", "create_oa", "mark_done", "report_problem"],
    visibleEntities: ["work_item", "oa", "pedido", "plan_semanal"],
    workItemSources: ["semanas_2026"],
    allowedActions: [
      "Crear OA",
      "Abrir OA",
      "Entregar a Calidad",
      "Reportar problema",
    ],
    sidebarItems: ["mi_trabajo", "ordenes_acondicionamiento", "historial"],
    creamyContext: {
      role: "Copiloto de envasado premium",
      topics: ["prioridades", "OA", "lotes premium", "insumos", "entregas"],
      defaultHint: "Revisemos el plan premium de la semana o consultemos un pedido.",
      baseSuggestions: ["Ver plan semanal", "Consultar pedido", "Ver línea premium"],
    },
    emptyState: {
      title: "Sin trabajo premium",
      message: "No hay trabajos premium asignados para este día.",
    },
    homeViewKey: "envasado-premium-home",
    dataMode: "work_items",
  }),

  defineSector({
    id: "ELABORACION",
    title: "Elaboración",
    description: "Ejecutar elaboraciones planificadas; producir granel conforme OE.",
    homeLayout: "work_blocks",
    visiblePanels: ["header_greeting", "summary_strip", "work_block_list", "context_panel"],
    quickActions: ["open_oe", "create_oe", "mark_started", "mark_finished", "report_problem"],
    visibleEntities: ["work_item", "oe", "lote", "plan_semanal"],
    workItemSources: ["semanas_2026"],
    allowedActions: [
      "Abrir OE",
      "Crear OE",
      "Marcar iniciada",
      "Marcar terminada",
      "Observaciones",
    ],
    sidebarItems: ["mi_trabajo", "ordenes_elaboracion", "historial"],
    creamyContext: {
      role: "Copiloto de elaboración",
      topics: ["OE", "kg", "responsable", "lotes", "prioridades"],
      defaultHint: "¿Qué elaboración arrancamos hoy? Puedo guiarte con la OE.",
      baseSuggestions: ["Abrir OE", "Ver kg del día", "Consultar lote"],
    },
    emptyState: {
      title: "Sin elaboraciones",
      message: "No hay elaboraciones planificadas para hoy.",
    },
    homeViewKey: "elaboracion-home",
    dataMode: "work_items",
  }),

  defineSector({
    id: "CODIFICADO",
    title: "Codificado",
    description: "Gestionar codificación y trazabilidad de producto terminado.",
    homeLayout: "encoding_queue",
    visiblePanels: ["header_greeting", "summary_strip", "work_block_list", "context_panel"],
    quickActions: ["mark_done", "report_problem", "consult_entity"],
    visibleEntities: ["work_item", "oa", "lote", "pedido"],
    workItemSources: ["semanas_2026"],
    allowedActions: ["Marcar codificado", "Reportar problema", "Consultar lote"],
    sidebarItems: [...BASE_SIDEBAR],
    creamyContext: {
      role: "Copiloto de codificado",
      topics: ["cola de codificación", "lotes", "OA", "prioridades"],
      defaultHint: "Sector en preparación. Creamy ayudará con la cola de codificación.",
      baseSuggestions: ["Ver cola", "Consultar lote", "Ver OA"],
    },
    emptyState: {
      title: "Sector en preparación",
      message: "La Home de Codificado se migrará al Role Engine próximamente.",
    },
    homeViewKey: "codificado-home",
    dataMode: "placeholder",
  }),

  defineSector({
    id: "CALIDAD",
    title: "Calidad",
    description: "Mesa de laboratorio — lotes pendientes, resultados y liberaciones.",
    homeLayout: "lab_bench",
    visiblePanels: ["header_greeting", "summary_strip", "quality_bench", "context_panel"],
    quickActions: ["approve_lot", "reject_lot", "register_result", "consult_entity"],
    visibleEntities: ["lote", "liberacion", "oe", "oa", "pedido"],
    workItemSources: ["asignacion_lotes_2026"],
    allowedActions: [
      "Registrar resultado",
      "Aprobar lote",
      "Rechazar lote",
      "Solicitar liberación",
    ],
    sidebarItems: ["pendientes", "aprobados", "rechazados"],
    creamyContext: {
      role: "Copiloto de calidad",
      topics: ["lotes", "liberaciones", "análisis", "microbiología", "bloqueos"],
      defaultHint: "¿Qué lote analizamos primero? Puedo ayudarte con resultados y liberaciones.",
      baseSuggestions: ["Ver pendientes", "Consultar lote", "Ver liberaciones"],
    },
    emptyState: {
      title: "Sin lotes pendientes",
      message: "No hay análisis pendientes en la mesa de laboratorio.",
    },
    homeViewKey: "calidad-home",
    dataMode: "mock",
  }),

  defineSector({
    id: "DEPOSITO",
    title: "Depósito",
    description: "Preparar insumos por pedido — envases, tapas, etiquetas, cajas.",
    homeLayout: "prep_checklist",
    visiblePanels: ["header_greeting", "summary_strip", "insumo_checklist", "context_panel"],
    quickActions: ["prepare_insumos", "report_problem", "consult_entity"],
    visibleEntities: ["pedido", "insumo", "oa", "work_item"],
    workItemSources: ["semanas_2026"],
    allowedActions: [
      "Registrar preparados",
      "Reportar faltante",
      "Consultar pedido",
    ],
    sidebarItems: [...BASE_SIDEBAR],
    creamyContext: {
      role: "Copiloto de depósito",
      topics: ["insumos", "faltantes", "pedidos", "preparación"],
      defaultHint: "¿Qué pedido preparamos? Revisemos envases, tapas y etiquetas.",
      baseSuggestions: ["Ver pedidos", "Reportar faltante", "Consultar insumos"],
    },
    emptyState: {
      title: "Sin pedidos a preparar",
      message: "No hay insumos pendientes de preparación.",
    },
    homeViewKey: "deposito-home",
    dataMode: "mock",
  }),

  defineSector({
    id: "MATERIA_PRIMA",
    title: "Materias Primas",
    description: "Stock de materias primas y control de preparación para Elaboración.",
    homeLayout: "supply_prep",
    visiblePanels: ["header_greeting", "summary_strip", "work_block_list", "context_panel"],
    quickActions: ["prepare_insumos", "report_problem", "consult_entity"],
    visibleEntities: ["insumo", "oe", "lote", "pedido"],
    workItemSources: ["semanas_2026"],
    allowedActions: ["Registrar entrega MP", "Reportar faltante", "Consultar OE"],
    sidebarItems: ["stock", "control_mp", "historial"],
    creamyContext: {
      role: "Copiloto de materia prima",
      topics: ["stock MP", "faltantes", "OE", "proveedores"],
      defaultHint: "¿Qué materia prima necesitás? Puedo ayudarte con el stock y la preparación.",
      baseSuggestions: ["Ver faltantes", "Consultar OE", "Ver stock"],
    },
    emptyState: {
      title: "Sin materias primas cargadas",
      message: "Todavía no se cargó stock de materias primas.",
    },
    homeViewKey: "materia-prima-home",
    dataMode: "work_items",
  }),

  defineSector({
    id: "COMERCIAL",
    title: "Comercial",
    description: "Seguimiento comercial de pedidos, entregas y compromisos con clientes.",
    homeLayout: "commercial_pipeline",
    visiblePanels: ["header_greeting", "summary_strip", "work_block_list", "context_panel"],
    quickActions: ["consult_entity", "view_plan", "report_problem"],
    visibleEntities: ["pedido", "oa", "oe", "plan_semanal"],
    workItemSources: ["pedidos_2026"],
    allowedActions: ["Consultar pedido", "Ver entregas", "Ver plan semanal"],
    sidebarItems: ["mi_trabajo", "consulta", "plan_semanal", "configuracion"],
    creamyContext: {
      role: "Copiloto comercial",
      topics: ["pedidos", "entregas", "clientes", "compromisos"],
      defaultHint: "Sector en preparación. Creamy ayudará con pedidos y entregas.",
      baseSuggestions: ["Consultar pedido", "Ver entregas", "Ver clientes"],
    },
    emptyState: {
      title: "Sector en preparación",
      message: "La Home comercial se migrará al Role Engine próximamente.",
    },
    homeViewKey: "comercial-home",
    dataMode: "placeholder",
  }),

  defineSector({
    id: "PRODUCCION",
    title: "Producción",
    description: "Centro de control — cuellos de botella, carga y planificación.",
    homeLayout: "control_tower",
    visiblePanels: [
      "header_greeting",
      "summary_strip",
      "load_bars",
      "problem_feed",
      "week_plan",
      "context_panel",
    ],
    quickActions: ["resolve_blocker", "view_plan", "consult_entity"],
    visibleEntities: ["work_item", "oe", "oa", "lote", "pedido", "plan_semanal"],
    workItemSources: ["semanas_2026", "pedidos_2026", "asignacion_lotes_2026"],
    allowedActions: [
      "Ver carga por sector",
      "Resolver bloqueo",
      "Ver plan semanal",
      "Priorizar trabajo",
      "Asignar trabajo",
      "Reasignar trabajo",
    ],
    sidebarItems: [
      "mi_trabajo",
      "asignar_trabajos",
      "ver_elaboracion",
      "ver_envasado_masivo",
      "ver_envasado_premium",
      "ver_calidad",
      "ver_materia_prima",
      "ordenes",
      "historial",
    ],
    sidebarLabelOverrides: { mi_trabajo: "Panel general" },
    creamyContext: {
      role: "Copiloto de producción",
      topics: [
        "cuellos de botella",
        "prioridades",
        "carga de trabajo",
        "planificación",
        "bloqueos",
      ],
      defaultHint:
        "¿Qué sector necesita atención ahora? Revisemos cuellos de botella y prioridades.",
      baseSuggestions: ["Ver bloqueos", "Ver carga", "Ver plan semanal"],
    },
    emptyState: {
      title: "Sin señales activas",
      message: "No hay problemas operativos detectados en este momento.",
    },
    homeViewKey: "produccion-home",
    dataMode: "mock",
  }),

  defineSector({
    id: "DIRECCION",
    title: "Dirección",
    description: "Panorama ejecutivo — estado general sin operación directa.",
    homeLayout: "executive_signals",
    visiblePanels: ["header_greeting", "executive_signals", "context_panel"],
    quickActions: ["view_plan", "consult_entity"],
    visibleEntities: ["pedido", "plan_semanal", "lote"],
    workItemSources: ["semanas_2026", "pedidos_2026"],
    allowedActions: ["Ver panorama", "Consultar pedido", "Ver alertas"],
    sidebarItems: ["mi_trabajo", "consulta", "plan_semanal", "configuracion"],
    restrictedSidebarItems: ["direccion"],
    creamyContext: {
      role: "Copiloto ejecutivo",
      topics: ["KPIs", "entregas", "riesgos", "alertas", "panorama"],
      defaultHint: "Panorama general del laboratorio. ¿Qué área revisamos?",
      baseSuggestions: ["Ver alertas", "Ver entregas", "Ver producción"],
    },
    emptyState: {
      title: "Sin señales",
      message: "No hay alertas ejecutivas en este momento.",
    },
    homeViewKey: "direccion-home",
    dataMode: "mock",
  }),
];

export const SECTOR_REGISTRY: ReadonlyMap<SectorId, SectorDefinition> = new Map(
  SECTOR_DEFINITIONS.map((definition) => [definition.id, definition])
);

export function getSectorDefinition(sectorId: SectorId): SectorDefinition | undefined {
  return SECTOR_REGISTRY.get(sectorId);
}

export function getAllSectorDefinitions(): SectorDefinition[] {
  return [...SECTOR_DEFINITIONS];
}

export function assertSectorDefinition(sectorId: SectorId): SectorDefinition {
  const definition = getSectorDefinition(sectorId);
  if (!definition) {
    throw new Error(`Sector no registrado en Role Engine: ${sectorId}`);
  }
  return definition;
}
