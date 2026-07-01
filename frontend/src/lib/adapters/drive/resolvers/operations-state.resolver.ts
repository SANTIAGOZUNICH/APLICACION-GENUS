import "server-only";

import {
  buildBandejaTasks,
  buildDayPulse,
} from "@/lib/mappers/build-bandeja-tasks";
import { buildWorkspacePanorama } from "@/lib/mappers/build-workspace-panorama";
import { buildWorkspaceTasks } from "@/lib/mappers/build-workspace-tasks";
import { parseAsignacionLoteRows } from "@/lib/mappers/sheet-lote-to-entity";
import { buildLiberacionSummariesFromLotes } from "@/lib/mappers/sheet-liberacion-to-entity";
import { loteResolver } from "@/lib/adapters/drive/resolvers/lote.resolver";
import { oeResolver } from "@/lib/adapters/drive/resolvers/oe.resolver";
import { oaResolver } from "@/lib/adapters/drive/resolvers/oa.resolver";
import { pedidoResolver } from "@/lib/adapters/drive/resolvers/pedido.resolver";
import type { WorkspaceId } from "@/types/actions";
import type { BandejaDayPulse, BandejaTask } from "@/types/bandeja/bandeja-task";
import type {
  WorkspacePanoramaMetric,
  WorkspaceTask,
} from "@/types/workspace/workspace-task";

export interface OperationsHydration {
  bandejaTasks: BandejaTask[];
  workspaceTasks: Record<WorkspaceId, WorkspaceTask[]>;
  dayPulse: BandejaDayPulse;
  workspacePanorama: Partial<Record<WorkspaceId, WorkspacePanoramaMetric[]>>;
}

/** Builds bandeja/workspace from cached indexes and critical sheets — no mass OE/OA reads. */
export class OperationsStateResolver {
  async buildHydration(): Promise<OperationsHydration> {
    const [oes, oas, pedidos, loteRows] = await Promise.all([
      oeResolver.listOeIndex(),
      oaResolver.listOaIndex(),
      pedidoResolver.listPedidos(),
      loteResolver.readAsignacionRows(),
    ]);

    const lotes = parseAsignacionLoteRows(loteRows);
    const liberaciones = buildLiberacionSummariesFromLotes(lotes);

    const buildInput = {
      oes: oes.map((item) => ({
        fileId: item.fileId,
        fileName: item.fileName,
        fileSlug: item.fileSlug,
        modifiedTime: item.modifiedTime,
        folderPath: item.folderPath,
      })),
      oas: oas.map((item) => ({
        fileId: item.fileId,
        fileName: item.fileName,
        fileSlug: item.fileSlug,
        modifiedTime: item.modifiedTime,
        folderPath: item.folderPath,
      })),
      pedidos,
      lotes,
      liberaciones,
    };

    const bandejaTasks = buildBandejaTasks(buildInput);
    const workspaceTasks = buildWorkspaceTasks(buildInput);
    const dayPulse = buildDayPulse(bandejaTasks);
    const workspacePanorama = buildWorkspacePanorama({
      oes: buildInput.oes,
      pedidos,
      lotes,
      liberaciones,
    });

    return {
      bandejaTasks,
      workspaceTasks,
      dayPulse,
      workspacePanorama,
    };
  }
}

export const operationsStateResolver = new OperationsStateResolver();
