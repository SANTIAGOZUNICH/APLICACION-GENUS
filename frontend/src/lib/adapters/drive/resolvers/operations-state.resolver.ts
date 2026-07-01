import "server-only";

import {
  buildBandejaTasks,
  buildDayPulse,
} from "@/lib/mappers/build-bandeja-tasks";
import { buildWorkspacePanorama } from "@/lib/mappers/build-workspace-panorama";
import { buildWorkspaceTasks } from "@/lib/mappers/build-workspace-tasks";
import { parseAsignacionLoteRowsWithDiagnostics } from "@/lib/mappers/diagnose-asignacion-lotes";
import { parsePedidosWithDiagnostics } from "@/lib/mappers/diagnose-pedidos";
import { buildLiberacionSummariesFromLotes } from "@/lib/mappers/sheet-liberacion-to-entity";
import { operationsDocumentRepository } from "@/lib/adapters/drive/operations-document-repository";
import { loteResolver } from "@/lib/adapters/drive/resolvers/lote.resolver";
import { oeResolver } from "@/lib/adapters/drive/resolvers/oe.resolver";
import { oaResolver } from "@/lib/adapters/drive/resolvers/oa.resolver";
import { pedidoResolver } from "@/lib/adapters/drive/resolvers/pedido.resolver";
import type {
  MapperWarning,
  RealSourcesDiagnostic,
} from "@/lib/mappers/mapper-diagnostics.types";
import type { WorkspaceId } from "@/types/actions";
import type { BandejaDayPulse, BandejaTask } from "@/types/bandeja/bandeja-task";
import type { OperationsEntityCounts } from "@/types/operations/operations-diagnostics";
import type {
  WorkspacePanoramaMetric,
  WorkspaceTask,
} from "@/types/workspace/workspace-task";

export interface OperationsHydration {
  bandejaTasks: BandejaTask[];
  workspaceTasks: Record<WorkspaceId, WorkspaceTask[]>;
  dayPulse: BandejaDayPulse;
  workspacePanorama: Partial<Record<WorkspaceId, WorkspacePanoramaMetric[]>>;
  counts: OperationsEntityCounts;
  realSources: RealSourcesDiagnostic;
  mapperWarnings: MapperWarning[];
}

function buildMapperWarnings(input: {
  lotesRowsRead: number;
  lotesRowsMapped: number;
  lotesHeaders: string[];
  lotesSampleRow?: Record<string, string>;
  lotesDiscardReasons: string[];
  pedidosRowsRead: number;
  pedidosRowsMapped: number;
  pedidosHeaders: string[];
  pedidosSampleRow?: Record<string, string>;
  pedidosDiscardReasons: string[];
}): MapperWarning[] {
  const warnings: MapperWarning[] = [];

  if (input.lotesRowsRead > 0 && input.lotesRowsMapped === 0) {
    warnings.push({
      entity: "lote",
      reason:
        input.lotesDiscardReasons[0] ??
        "ASIGNACION DE LOTES 2026 conectada, pero falta mapear columnas.",
      sampleHeaders: input.lotesHeaders.slice(0, 12),
      sampleRow: input.lotesSampleRow,
    });
  }

  if (input.pedidosRowsRead > 0 && input.pedidosRowsMapped === 0) {
    warnings.push({
      entity: "pedido",
      reason:
        input.pedidosDiscardReasons[0] ??
        "PEDIDOS 2026 conectado, pero falta mapear columnas.",
      sampleHeaders: input.pedidosHeaders.slice(0, 12),
      sampleRow: input.pedidosSampleRow,
    });
  }

  return warnings;
}

/** Builds bandeja/workspace from cached indexes and critical sheets — no mass OE/OA reads. */
export class OperationsStateResolver {
  async buildHydration(): Promise<OperationsHydration> {
    const [oes, oas, loteRead, pedidoRead, lotesDocRef, pedidosDocRef] =
      await Promise.all([
        oeResolver.listOeIndex(),
        oaResolver.listOaIndex(),
        loteResolver.readAsignacionWithMeta(),
        pedidoResolver.readPedidosWithMeta(),
        operationsDocumentRepository.getCriticalSheetRef("asignacion_lotes_2026"),
        operationsDocumentRepository.getCriticalSheetRef("pedidos_2026"),
      ]);

    const lotesParsed = parseAsignacionLoteRowsWithDiagnostics(loteRead.rows);
    const pedidosParsed = parsePedidosWithDiagnostics(pedidoRead.rows);

    lotesParsed.diagnostic.sheetId = lotesDocRef.fileId;
    lotesParsed.diagnostic.sheetName = lotesDocRef.name;
    lotesParsed.diagnostic.tabUsed = loteRead.tabUsed;
    lotesParsed.diagnostic.tabsAttempted = loteRead.tabsAttempted;

    pedidosParsed.diagnostic.sheetId = pedidosDocRef.fileId;
    pedidosParsed.diagnostic.sheetName = pedidosDocRef.name;
    pedidosParsed.diagnostic.tabUsed = pedidoRead.tabUsed;
    pedidosParsed.diagnostic.tabsAttempted = pedidoRead.tabsAttempted;

    const lotes = lotesParsed.lotes;
    const pedidos = pedidosParsed.pedidos;
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

    const counts: OperationsEntityCounts = {
      oe: oes.length,
      oa: oas.length,
      pedidos: pedidos.length,
      lotes: lotes.length,
      liberaciones: liberaciones.length,
    };

    const realSources: RealSourcesDiagnostic = {
      elaboracionIndexCount: oes.length,
      lotesRowsRead: lotesParsed.diagnostic.rowsRead,
      lotesRowsMapped: lotesParsed.diagnostic.rowsMapped,
      pedidosRowsRead: pedidosParsed.diagnostic.rowsRead,
      pedidosRowsMapped: pedidosParsed.diagnostic.rowsMapped,
    };

    const mapperWarnings = buildMapperWarnings({
      lotesRowsRead: lotesParsed.diagnostic.rowsRead,
      lotesRowsMapped: lotesParsed.diagnostic.rowsMapped,
      lotesHeaders: lotesParsed.diagnostic.headersDetected,
      lotesSampleRow: lotesParsed.diagnostic.sampleRow,
      lotesDiscardReasons: lotesParsed.diagnostic.discardReasons,
      pedidosRowsRead: pedidosParsed.diagnostic.rowsRead,
      pedidosRowsMapped: pedidosParsed.diagnostic.rowsMapped,
      pedidosHeaders: pedidosParsed.diagnostic.headersDetected,
      pedidosSampleRow: pedidosParsed.diagnostic.sampleRow,
      pedidosDiscardReasons: pedidosParsed.diagnostic.discardReasons,
    });

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
      counts,
      realSources,
      mapperWarnings,
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
    mapperWarnings: [],
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
