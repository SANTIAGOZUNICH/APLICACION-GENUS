import "server-only";

import { buildE72WorkspaceTasks } from "@/lib/mappers/build-produccion-oe-tasks";
import { oeResolver } from "@/lib/adapters/drive/resolvers/oe.resolver";
import type { WorkspaceId } from "@/types/actions";
import type { BandejaDayPulse, BandejaTask } from "@/types/bandeja/bandeja-task";
import type { OperationsEntityCounts } from "@/types/operations/operations-diagnostics";
import type {
  WorkspacePanoramaMetric,
  WorkspaceTask,
} from "@/types/workspace/workspace-task";
import type { RealSourcesDiagnostic } from "@/lib/mappers/mapper-diagnostics.types";

export type OperationsHydrationSource = "drive" | "drive-partial";

/** E7.2 slice — ELABORACION OEs for consulta, produccion and /oe/[id] only. */
export interface OperationsHydration {
  bandejaTasks: BandejaTask[];
  workspaceTasks: Record<WorkspaceId, WorkspaceTask[]>;
  dayPulse: BandejaDayPulse;
  workspacePanorama: Partial<Record<WorkspaceId, WorkspacePanoramaMetric[]>>;
  counts: OperationsEntityCounts;
  realSources: RealSourcesDiagnostic;
  source: OperationsHydrationSource;
}

export class OperationsStateResolver {
  async buildHydration(): Promise<OperationsHydration> {
    const oes = await oeResolver.listOeIndex();
    const workspaceTasks = buildE72WorkspaceTasks(
      oes.map((item) => ({
        fileId: item.fileId,
        fileName: item.fileName,
        fileSlug: item.fileSlug,
        modifiedTime: item.modifiedTime,
        folderPath: item.folderPath,
      }))
    );

    const counts: OperationsEntityCounts = {
      oe: oes.length,
      oa: 0,
      pedidos: 0,
      lotes: 0,
      liberaciones: 0,
    };

    const realSources: RealSourcesDiagnostic = {
      elaboracionIndexCount: oes.length,
      lotesRowsRead: 0,
      lotesRowsMapped: 0,
      pedidosRowsRead: 0,
      pedidosRowsMapped: 0,
    };

    return {
      bandejaTasks: [],
      workspaceTasks,
      dayPulse: { completed: 0, pending: 0 },
      workspacePanorama: {},
      counts,
      realSources,
      source: "drive",
    };
  }
}

export const operationsStateResolver = new OperationsStateResolver();

export function buildEmptyRealHydration(): OperationsHydration {
  return {
    bandejaTasks: [],
    workspaceTasks: {
      produccion: [],
      calidad: [],
      comercial: [],
      deposito: [],
      direccion: [],
      dt: [],
    },
    dayPulse: { completed: 0, pending: 0 },
    workspacePanorama: {},
    counts: {
      oe: 0,
      lotes: 0,
      pedidos: 0,
      oa: 0,
      liberaciones: 0,
    },
    realSources: {
      elaboracionIndexCount: 0,
      lotesRowsRead: 0,
      lotesRowsMapped: 0,
      pedidosRowsRead: 0,
      pedidosRowsMapped: 0,
    },
    source: "drive-partial",
  };
}

export function allFallbackUsed(value = true) {
  return {
    bandeja: value,
    workspaces: value,
    entityPages: value,
    panorama: value,
  };
}
