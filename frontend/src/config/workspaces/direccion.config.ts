import type { WorkspaceDefinition } from "@/config/workspaces/produccion.config";

export const direccionWorkspace: WorkspaceDefinition = {
  id: "direccion",
  title: "Dirección",
  mission: "Atender lo que se sale de lo normal.",
  focoSectionId: "excepciones",
  problemsSectionId: "excepciones",
  sections: [
    {
      id: "excepciones",
      label: "Excepciones",
      description: "Rechazos, retrasos, quiebres y KPIs fuera de rango",
      defaultCollapsed: false,
      alwaysExpanded: true,
    },
    {
      id: "panorama",
      label: "Panorama",
      description: "Resumen ejecutivo — secundario",
      defaultCollapsed: true,
      variant: "panorama",
    },
  ],
};
