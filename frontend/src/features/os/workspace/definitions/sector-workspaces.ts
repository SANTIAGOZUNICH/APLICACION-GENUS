import type { WorkspaceDefinition } from "../types";

const BASE_NAV = [
  { id: "mi-trabajo", label: "Mi trabajo", sidebarItemId: "mi_trabajo" as const },
  { id: "plan", label: "Plan semanal", sidebarItemId: "plan_semanal" as const },
  { id: "consulta", label: "Consulta", sidebarItemId: "consulta" as const },
];

export const PRODUCCION_WORKSPACE: WorkspaceDefinition = {
  sectorId: "PRODUCCION",
  subtitle: "Tenés 8 órdenes para trabajar hoy.",
  primaryNav: BASE_NAV,
  primaryActions: [
    { id: "start-elaboracion", label: "Iniciar elaboración", description: "Abrir la siguiente orden del día" },
    { id: "continue-order", label: "Continuar orden", description: "Retomar trabajo en curso" },
    { id: "register-consumption", label: "Registrar consumo", description: "Materiales e insumos usados" },
  ],
  widgets: [
    { id: "work", label: "Mi trabajo", hint: "8 órdenes activas", status: "En curso" },
    { id: "priorities", label: "Prioridades", hint: "3 urgentes hoy", status: "Atención" },
    { id: "daily", label: "Producción del día", hint: "Avance 62%", status: "Normal" },
  ],
};

export const CALIDAD_WORKSPACE: WorkspaceDefinition = {
  sectorId: "CALIDAD",
  subtitle: "Tenés 5 lotes esperando liberación.",
  primaryNav: [
    ...BASE_NAV,
    { id: "calidad", label: "Calidad", sidebarItemId: "calidad" as const },
  ],
  primaryActions: [
    { id: "release-lot", label: "Liberar lote", description: "Aprobar liberación pendiente" },
    { id: "view-analysis", label: "Ver análisis", description: "Resultados de laboratorio" },
    { id: "register-deviation", label: "Registrar desvío", description: "Documentar no conformidad" },
  ],
  widgets: [
    { id: "pending", label: "Lotes pendientes", hint: "5 en cola", status: "Pendiente" },
    { id: "results", label: "Resultados", hint: "2 listos", status: "Revisión" },
    { id: "blocked", label: "Bloqueados", hint: "1 alerta", status: "Atención" },
  ],
};

export const DEPOSITO_WORKSPACE: WorkspaceDefinition = {
  sectorId: "DEPOSITO",
  subtitle: "Hay 14 movimientos pendientes.",
  primaryNav: BASE_NAV,
  primaryActions: [
    { id: "receive", label: "Recibir materiales", description: "Ingreso de MP y PT" },
    { id: "dispatch", label: "Despachar", description: "Preparar salidas del día" },
    { id: "adjust-stock", label: "Ajustar stock", description: "Corrección de inventario" },
  ],
  widgets: [
    { id: "movements", label: "Movimientos", hint: "14 pendientes", status: "Activo" },
    { id: "receiving", label: "Recepciones", hint: "6 hoy", status: "En curso" },
    { id: "dispatch", label: "Despachos", hint: "8 programados", status: "Normal" },
  ],
};

export const DIRECCION_WORKSPACE: WorkspaceDefinition = {
  sectorId: "DIRECCION",
  subtitle: "La operación está funcionando normalmente.",
  primaryNav: [
    { id: "mi-trabajo", label: "Mi trabajo", sidebarItemId: "mi_trabajo" as const },
    { id: "produccion", label: "Centro de operaciones", sidebarItemId: "produccion" as const },
    { id: "plan", label: "Plan semanal", sidebarItemId: "plan_semanal" as const },
    { id: "consulta", label: "Consulta", sidebarItemId: "consulta" as const },
  ],
  primaryActions: [
    { id: "operations", label: "Centro de operaciones", description: "Estado general de planta" },
    { id: "kpis", label: "Ver KPIs", description: "Indicadores del día" },
    { id: "alerts", label: "Revisar alertas", description: "Eventos que requieren atención" },
  ],
  widgets: [
    { id: "operations", label: "Centro de Operaciones", hint: "Planta estable", status: "Normal" },
    { id: "kpis", label: "KPIs", hint: "Cumplimiento 94%", status: "En meta" },
    { id: "alerts", label: "Alertas", hint: "2 menores", status: "Bajo control" },
    { id: "plan", label: "Plan semanal", hint: "Semana 27", status: "Activo" },
  ],
};

export const ELABORACION_WORKSPACE: WorkspaceDefinition = {
  sectorId: "ELABORACION",
  subtitle: "Tenés 4 lotes en elaboración hoy.",
  primaryNav: BASE_NAV,
  primaryActions: [
    { id: "start-batch", label: "Iniciar lote", description: "Comenzar elaboración programada" },
    { id: "continue", label: "Continuar lote", description: "Retomar trabajo en curso" },
    { id: "register", label: "Registrar avance", description: "Actualizar estado del lote" },
  ],
  widgets: [
    { id: "work", label: "Mi trabajo", hint: "4 lotes", status: "En curso" },
    { id: "persona", label: "Por persona", hint: "Turno mañana", status: "Activo" },
    { id: "plan", label: "Plan del día", hint: "6 programados", status: "Normal" },
  ],
};

export const ENVASADO_MASIVO_WORKSPACE: WorkspaceDefinition = {
  sectorId: "ENVASADO_MASIVO",
  subtitle: "Hay 6 líneas con trabajo asignado hoy.",
  primaryNav: BASE_NAV,
  primaryActions: [
    { id: "open-oa", label: "Abrir OA", description: "Ver orden de acondicionamiento" },
    { id: "mark-done", label: "Marcar terminado", description: "Cerrar trabajo en línea" },
    { id: "report", label: "Reportar problema", description: "Bloqueo o desvío" },
  ],
  widgets: [
    { id: "lines", label: "Líneas activas", hint: "6 de 8", status: "En curso" },
    { id: "priority", label: "Prioridades", hint: "2 urgentes", status: "Atención" },
    { id: "plan", label: "Plan semanal", hint: "Semana actual", status: "Normal" },
  ],
};

export const ENVASADO_PREMIUM_WORKSPACE: WorkspaceDefinition = {
  sectorId: "ENVASADO_PREMIUM",
  subtitle: "Tenés 3 lotes premium en línea hoy.",
  primaryNav: BASE_NAV,
  primaryActions: [
    { id: "open-oa", label: "Abrir OA", description: "Orden premium activa" },
    { id: "mark-done", label: "Marcar terminado", description: "Cerrar lote premium" },
    { id: "report", label: "Reportar problema", description: "Incidencia en línea" },
  ],
  widgets: [
    { id: "premium", label: "Lotes premium", hint: "3 activos", status: "En curso" },
    { id: "quality", label: "Control visual", hint: "1 pendiente", status: "Revisión" },
    { id: "plan", label: "Plan semanal", hint: "Entregas premium", status: "Normal" },
  ],
};

export const SECTOR_WORKSPACE_DEFINITIONS = [
  PRODUCCION_WORKSPACE,
  CALIDAD_WORKSPACE,
  DEPOSITO_WORKSPACE,
  DIRECCION_WORKSPACE,
  ELABORACION_WORKSPACE,
  ENVASADO_MASIVO_WORKSPACE,
  ENVASADO_PREMIUM_WORKSPACE,
];
