import type { WorkspaceDefinition } from "@/config/workspaces/produccion.config";

export const calidadWorkspace: WorkspaceDefinition = {
  id: "calidad",
  title: "Calidad",
  mission: "Controlar y disponer lotes con evidencia trazable.",
  focoSectionId: "para-analizar",
  problemsSectionId: "problemas",
  sections: [
    {
      id: "para-analizar",
      label: "Para analizar / disponer",
      description: "Lotes en cuarentena, ordenados por antigüedad",
      defaultCollapsed: false,
    },
    {
      id: "problemas",
      label: "Problemas",
      description: "Rechazos, desvíos y análisis fuera de spec",
      defaultCollapsed: false,
      alwaysExpanded: true,
    },
    {
      id: "esperando-firma",
      label: "Esperando firma",
      description: "Disposiciones enviadas a Dirección Técnica",
      defaultCollapsed: false,
    },
    {
      id: "finalizados",
      label: "Finalizados",
      description: "Disposiciones completadas hoy",
      defaultCollapsed: true,
    },
  ],
};
