import type { WorkspaceDefinition } from "@/config/workspaces/produccion.config";

export const depositoWorkspace: WorkspaceDefinition = {
  id: "deposito",
  title: "Depósito",
  mission: "Mover lo que hay que mover — recepción y despacho.",
  focoSectionId: "para-mover",
  problemsSectionId: "problemas",
  sections: [
    {
      id: "para-mover",
      label: "Para mover",
      description: "Despachos listos y recepciones pendientes",
      defaultCollapsed: false,
    },
    {
      id: "problemas",
      label: "Problemas",
      description: "Stock crítico, vencimientos y faltantes",
      defaultCollapsed: false,
      alwaysExpanded: true,
    },
    {
      id: "esperando-otros",
      label: "Esperando a otros",
      description: "Lotes recién recibidos en cuarentena",
      defaultCollapsed: true,
    },
    {
      id: "finalizados",
      label: "Finalizados",
      description: "Movimientos completados hoy",
      defaultCollapsed: true,
    },
  ],
};
