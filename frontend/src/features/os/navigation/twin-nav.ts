import type { SidebarItemId } from "@/lib/role-engine/types";

/** Vistas navegables del Digital Twin F9.6. */
export type TwinView =
  | "mi-trabajo"
  | "plan-semanal"
  | "consulta"
  | "insumos"
  | "calidad"
  | "config"
  | "produccion"
  | "direccion"
  | "ordenes-elaboracion"
  | "ordenes-acondicionamiento"
  | "ordenes"
  | "historial"
  | "pendientes"
  | "aprobados"
  | "rechazados"
  | "stock"
  | "control-mp"
  | "asignar-trabajos"
  | "entregados"
  | "asignacion-lotes"
  | "ver-elaboracion"
  | "ver-envasado-masivo"
  | "ver-envasado-premium"
  | "ver-calidad"
  | "ver-materia-prima"
  | "work-detail"
  | "oa-detail"
  | "oe-detail"
  | "client-detail";

export interface TwinNavEntry {
  view: TwinView;
  workItemId?: string;
  oaRef?: string;
  oeRef?: string;
  clientName?: string;
  query?: string;
}

export const SIDEBAR_TO_TWIN_VIEW: Record<SidebarItemId, TwinView> = {
  mi_trabajo: "mi-trabajo",
  plan_semanal: "plan-semanal",
  consulta: "consulta",
  insumos: "insumos",
  calidad: "calidad",
  configuracion: "config",
  produccion: "produccion",
  direccion: "direccion",
  ordenes_elaboracion: "ordenes-elaboracion",
  ordenes_acondicionamiento: "ordenes-acondicionamiento",
  ordenes: "ordenes",
  historial: "historial",
  pendientes: "pendientes",
  aprobados: "aprobados",
  rechazados: "rechazados",
  stock: "stock",
  control_mp: "control-mp",
  asignar_trabajos: "asignar-trabajos",
  entregados: "entregados",
  asignacion_lotes: "asignacion-lotes",
  ver_elaboracion: "ver-elaboracion",
  ver_envasado_masivo: "ver-envasado-masivo",
  ver_envasado_premium: "ver-envasado-premium",
  ver_calidad: "ver-calidad",
  ver_materia_prima: "ver-materia-prima",
};

export function twinViewToSidebarId(view: TwinView): SidebarItemId | undefined {
  const map: Partial<Record<TwinView, SidebarItemId>> = {
    "mi-trabajo": "mi_trabajo",
    "plan-semanal": "plan_semanal",
    consulta: "consulta",
    insumos: "insumos",
    calidad: "calidad",
    config: "configuracion",
    produccion: "produccion",
    direccion: "direccion",
    "ordenes-elaboracion": "ordenes_elaboracion",
    "ordenes-acondicionamiento": "ordenes_acondicionamiento",
    ordenes: "ordenes",
    historial: "historial",
    pendientes: "pendientes",
    aprobados: "aprobados",
    rechazados: "rechazados",
    stock: "stock",
    "control-mp": "control_mp",
    "asignar-trabajos": "asignar_trabajos",
    entregados: "entregados",
    "asignacion-lotes": "asignacion_lotes",
    "ver-elaboracion": "ver_elaboracion",
    "ver-envasado-masivo": "ver_envasado_masivo",
    "ver-envasado-premium": "ver_envasado_premium",
    "ver-calidad": "ver_calidad",
    "ver-materia-prima": "ver_materia_prima",
  };
  return map[view];
}

export function isDetailView(view: TwinView): boolean {
  return (
    view === "work-detail" ||
    view === "oa-detail" ||
    view === "oe-detail" ||
    view === "client-detail"
  );
}

export function viewTitle(view: TwinView): string {
  const titles: Record<TwinView, string> = {
    "mi-trabajo": "Mi trabajo",
    "plan-semanal": "Plan semanal",
    consulta: "Consulta",
    insumos: "Insumos",
    calidad: "Calidad",
    config: "Configuración",
    produccion: "Control de planta",
    direccion: "Dirección",
    "ordenes-elaboracion": "Órdenes de Elaboración",
    "ordenes-acondicionamiento": "Órdenes de Acondicionamiento",
    ordenes: "Órdenes",
    historial: "Historial",
    pendientes: "Pendientes",
    aprobados: "Aprobados",
    rechazados: "Rechazados",
    stock: "Stock de Materias Primas",
    "control-mp": "Control de Materias Primas",
    "asignar-trabajos": "Asignar trabajos",
    entregados: "Entregados",
    "asignacion-lotes": "Asignación de lotes",
    "ver-elaboracion": "Elaboración",
    "ver-envasado-masivo": "Envasado Masivo",
    "ver-envasado-premium": "Envasado Premium",
    "ver-calidad": "Calidad",
    "ver-materia-prima": "Materias Primas",
    "work-detail": "Trabajo",
    "oa-detail": "Orden de Acondicionamiento",
    "oe-detail": "Orden de Elaboración",
    "client-detail": "Cliente",
  };
  return titles[view];
}
