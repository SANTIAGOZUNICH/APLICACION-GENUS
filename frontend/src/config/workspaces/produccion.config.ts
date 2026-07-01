import type { WorkspaceSectionConfig } from "@/types/workspace/workspace-section";
import type { WorkspaceId } from "@/config/navigation";

export interface WorkspaceDefinition {
  id: WorkspaceId;
  title: string;
  mission: string;
  focoSectionId: string;
  problemsSectionId?: string;
  sections: readonly WorkspaceSectionConfig[];
}

export const produccionWorkspace: WorkspaceDefinition = {
  id: "produccion",
  title: "Producción",
  mission: "Fabricar lo planificado, sin error.",
  focoSectionId: "esperando-decision",
  problemsSectionId: "problemas",
  sections: [
    {
      id: "esperando-decision",
      label: "Esperando tu decisión",
      description: "OE/OA listas para cerrar o planes por confirmar",
      defaultCollapsed: false,
    },
    {
      id: "problemas",
      label: "Problemas",
      description: "Desvíos, faltantes y bloqueos de producción",
      defaultCollapsed: false,
      alwaysExpanded: true,
    },
    {
      id: "en-curso",
      label: "En curso",
      description: "Órdenes activas en Elaboración y Envasado",
      defaultCollapsed: false,
    },
    {
      id: "esperando-otros",
      label: "Esperando a otros",
      description: "Postas entregadas a Calidad o Depósito",
      defaultCollapsed: true,
    },
    {
      id: "finalizados",
      label: "Finalizados",
      description: "Cerrado hoy en planta",
      defaultCollapsed: true,
    },
  ],
};

/** E7.2 real data — OEs from ELABORACION index, grouped by recency/month. */
export const produccionRealWorkspace: WorkspaceDefinition = {
  id: "produccion",
  title: "Producción",
  mission: "Órdenes de elaboración indexadas en Google Drive.",
  focoSectionId: "__none__",
  sections: [
    {
      id: "recientes",
      label: "Recientes",
      description: "OEs modificadas en las últimas semanas",
      defaultCollapsed: false,
    },
    {
      id: "julio",
      label: "Julio",
      description: "Órdenes en carpeta Julio",
      defaultCollapsed: false,
    },
    {
      id: "junio",
      label: "Junio",
      description: "Órdenes en carpeta Junio",
      defaultCollapsed: false,
    },
    {
      id: "meses-anteriores",
      label: "Meses anteriores",
      description: "OEs de meses previos en ELABORACION",
      defaultCollapsed: true,
    },
  ],
};
