import type { WorkspaceDefinition } from "@/config/workspaces/produccion.config";

export const dtWorkspace: WorkspaceDefinition = {
  id: "dt",
  title: "Dirección Técnica",
  mission: "Garantizar el cumplimiento GMP — firmar liberaciones.",
  focoSectionId: "esperando-firma",
  problemsSectionId: "problemas",
  sections: [
    {
      id: "esperando-firma",
      label: "Esperando tu firma",
      description: "Disposiciones con evidencia lista para firmar",
      defaultCollapsed: false,
    },
    {
      id: "problemas",
      label: "Problemas",
      description: "Rechazos y lotes que requieren decisión técnica",
      defaultCollapsed: false,
      alwaysExpanded: true,
    },
    {
      id: "finalizados",
      label: "Finalizados",
      description: "Firmado hoy",
      defaultCollapsed: true,
    },
  ],
};
