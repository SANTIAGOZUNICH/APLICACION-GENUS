export type { WorkspaceDefinition } from "./produccion.config";
export { produccionWorkspace } from "./produccion.config";
export { calidadWorkspace } from "./calidad.config";
export { depositoWorkspace } from "./deposito.config";
export { comercialWorkspace } from "./comercial.config";
export { direccionWorkspace } from "./direccion.config";
export { dtWorkspace } from "./dt.config";

import type { WorkspaceId } from "@/config/navigation";
import { calidadWorkspace } from "./calidad.config";
import { comercialWorkspace } from "./comercial.config";
import { depositoWorkspace } from "./deposito.config";
import { direccionWorkspace } from "./direccion.config";
import { dtWorkspace } from "./dt.config";
import { produccionWorkspace } from "./produccion.config";
import type { WorkspaceDefinition } from "./produccion.config";

export const workspaceRegistry: Record<
  Exclude<WorkspaceId, "bandeja" | "consulta" | "design-system">,
  WorkspaceDefinition
> = {
  produccion: produccionWorkspace,
  calidad: calidadWorkspace,
  deposito: depositoWorkspace,
  comercial: comercialWorkspace,
  direccion: direccionWorkspace,
  dt: dtWorkspace,
};

export function getWorkspaceDefinition(
  id: Exclude<WorkspaceId, "bandeja" | "consulta" | "design-system">
): WorkspaceDefinition {
  return workspaceRegistry[id];
}
