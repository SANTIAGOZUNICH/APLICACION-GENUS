import type { SectorId } from "@/types/operational/sector";
import { SECTOR_LABELS } from "@/types/operational/sector";
import type { WorkspaceDefinition } from "../types";

const BASE_NAV = [
  { id: "mi-trabajo", label: "Mi trabajo", sidebarItemId: "mi_trabajo" as const },
  { id: "plan", label: "Plan semanal", sidebarItemId: "plan_semanal" as const },
  { id: "consulta", label: "Consulta", sidebarItemId: "consulta" as const },
];

/** Workspace genérico cuando el sector no tiene definición dedicada. */
export function createDefaultWorkspaceDefinition(sectorId: SectorId): WorkspaceDefinition {
  const label = SECTOR_LABELS[sectorId];

  return {
    sectorId,
    subtitle: `Tu espacio de trabajo en ${label} está listo.`,
    primaryNav: BASE_NAV,
    primaryActions: [
      { id: "start", label: "Empezar trabajo", description: "Ver tareas asignadas hoy" },
      { id: "consult", label: "Consultar pedido", description: "Buscar lote u orden" },
    ],
    widgets: [
      { id: "work", label: "Mi trabajo", hint: "Pendientes del día" },
      { id: "plan", label: "Plan semanal", hint: "Próximas entregas" },
    ],
  };
}
