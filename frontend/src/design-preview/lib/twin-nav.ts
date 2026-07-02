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
    "work-detail": "Trabajo",
    "oa-detail": "Orden de Acondicionamiento",
    "oe-detail": "Orden de Elaboración",
    "client-detail": "Cliente",
  };
  return titles[view];
}
