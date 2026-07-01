import type { WorkspaceDefinition } from "@/config/workspaces/produccion.config";

export const comercialWorkspace: WorkspaceDefinition = {
  id: "comercial",
  title: "Comercial",
  mission: "Que los pedidos se cumplan a tiempo.",
  focoSectionId: "necesita-seguimiento",
  problemsSectionId: "problemas",
  sections: [
    {
      id: "necesita-seguimiento",
      label: "Necesita seguimiento",
      description: "Compromisos por vencer y pedidos estancados",
      defaultCollapsed: false,
    },
    {
      id: "en-produccion",
      label: "En producción",
      description: "Avance de pedidos en planta",
      defaultCollapsed: false,
    },
    {
      id: "listos-despachar",
      label: "Listos para despachar",
      description: "PT liberado, pendiente de salida",
      defaultCollapsed: false,
    },
    {
      id: "problemas",
      label: "Problemas",
      description: "Retrasos y quiebres de compromiso",
      defaultCollapsed: false,
      alwaysExpanded: true,
    },
    {
      id: "cerrados",
      label: "Cerrados",
      description: "Pedidos completados recientemente",
      defaultCollapsed: true,
    },
  ],
};
