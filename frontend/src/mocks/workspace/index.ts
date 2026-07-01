export {
  labClients,
  labPeople,
  labProducts,
  labSectors,
  noop,
} from "./lab-context";

export { produccionTasks } from "./produccion.mock";
export { calidadTasks } from "./calidad.mock";
export { depositoTasks } from "./deposito.mock";
export { comercialTasks } from "./comercial.mock";
export { direccionTasks, direccionPanorama } from "./direccion.mock";
export { dtTasks } from "./dt.mock";

import type { WorkspaceId } from "@/config/navigation";
import { calidadTasks } from "./calidad.mock";
import { comercialTasks } from "./comercial.mock";
import { depositoTasks } from "./deposito.mock";
import { direccionPanorama, direccionTasks } from "./direccion.mock";
import { dtTasks } from "./dt.mock";
import { produccionTasks } from "./produccion.mock";
import type { WorkspacePanoramaMetric, WorkspaceTask } from "@/types/workspace/workspace-task";

export function getWorkspaceTasks(
  id: Exclude<WorkspaceId, "bandeja" | "consulta" | "design-system">
): WorkspaceTask[] {
  switch (id) {
    case "produccion":
      return produccionTasks;
    case "calidad":
      return calidadTasks;
    case "deposito":
      return depositoTasks;
    case "comercial":
      return comercialTasks;
    case "direccion":
      return direccionTasks;
    case "dt":
      return dtTasks;
  }
}

export function getWorkspacePanorama(
  id: WorkspaceId
): WorkspacePanoramaMetric[] | undefined {
  if (id === "direccion") return direccionPanorama;
  return undefined;
}
