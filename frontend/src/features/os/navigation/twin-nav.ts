import type { SidebarItemId } from "@/lib/role-engine/types";
import type { SectorId } from "@/types/operational/sector";
import { PRODUCTION_MANAGED_SECTORS } from "@/lib/operational/production-managed-sectors";

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
  | "mp-ingresos"
  | "mp-compras"
  | "ingresos-me"
  | "salidas-me"
  | "inventario-me"
  | "deposito-graneles"
  | "avisos"
  | "avisos-me"
  | "semanas-produccion"
  | "entregados"
  | "asignacion-lotes"
  | "ver-elaboracion"
  | "ver-envasado-masivo"
  | "ver-envasado-premium"
  | "ver-codificado"
  | "ver-calidad"
  | "ver-materia-prima"
  | "remitos"
  | "pedidos"
  | "procedimientos"
  | "metricas"
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
  mp_ingresos: "mp-ingresos",
  mp_compras: "mp-compras",
  ingresos_me: "ingresos-me",
  salidas_me: "salidas-me",
  inventario_me: "inventario-me",
  deposito_graneles: "deposito-graneles",
  avisos: "avisos",
  avisos_me: "avisos-me",
  semanas_produccion: "semanas-produccion",
  entregados: "entregados",
  asignacion_lotes: "asignacion-lotes",
  ver_elaboracion: "ver-elaboracion",
  ver_envasado_masivo: "ver-envasado-masivo",
  ver_envasado_premium: "ver-envasado-premium",
  ver_codificado: "ver-codificado",
  ver_calidad: "ver-calidad",
  ver_materia_prima: "ver-materia-prima",
  remitos: "remitos",
  pedidos: "pedidos",
  procedimientos: "procedimientos",
  metricas: "metricas",
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
    "mp-ingresos": "mp_ingresos",
    "mp-compras": "mp_compras",
    "ingresos-me": "ingresos_me",
    "salidas-me": "salidas_me",
    "inventario-me": "inventario_me",
    "deposito-graneles": "deposito_graneles",
    avisos: "avisos",
    "avisos-me": "avisos_me",
    "semanas-produccion": "semanas_produccion",
    entregados: "entregados",
    "asignacion-lotes": "asignacion_lotes",
    "ver-elaboracion": "ver_elaboracion",
    "ver-envasado-masivo": "ver_envasado_masivo",
    "ver-envasado-premium": "ver_envasado_premium",
    "ver-codificado": "ver_codificado",
    "ver-calidad": "ver_calidad",
    "ver-materia-prima": "ver_materia_prima",
    remitos: "remitos",
    pedidos: "pedidos",
    procedimientos: "procedimientos",
    metricas: "metricas",
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
    stock: "Stock",
    "control-mp": "Control semanal",
    "mp-ingresos": "Ingresos MP",
    "mp-compras": "Compras MP",
    "ingresos-me": "Ingresos ME",
    "salidas-me": "Salidas ME",
    "inventario-me": "Inventario ME",
    "deposito-graneles": "Depósito Graneles",
    avisos: "Avisos",
    "avisos-me": "Avisos ME",
    "semanas-produccion": "Plan semanal",
    entregados: "Entregados",
    "asignacion-lotes": "Asignación de lotes",
    "ver-elaboracion": "Elaboración",
    "ver-envasado-masivo": "Envasado Masivo",
    "ver-envasado-premium": "Envasado Premium",
    "ver-codificado": "Codificado",
    "ver-calidad": "Calidad",
    "ver-materia-prima": "Materias Primas",
    remitos: "Remitos",
    pedidos: "Pedidos",
    procedimientos: "Procedimientos",
    metricas: "Métricas",
    "work-detail": "Trabajo",
    "oa-detail": "Orden de Acondicionamiento",
    "oe-detail": "Orden de Elaboración",
    "client-detail": "Cliente",
  };
  return titles[view];
}

/**
 * Sectores cuyo historial de trabajos finalizados debe consultar el actor.
 * PRODUCCION debe ver el historial de todo lo que asigna, incluido
 * CODIFICADO (directo o vía Envasado) — se omitía acá igual que en el panel
 * general, dejando el historial de Codificado invisible para Producción.
 */
export function historialSectorsForActor(sectorId: SectorId): SectorId[] {
  if (sectorId === "PRODUCCION") {
    return [...PRODUCTION_MANAGED_SECTORS];
  }
  if (sectorId === "MATERIA_PRIMA") {
    return ["ELABORACION"];
  }
  return [sectorId];
}
