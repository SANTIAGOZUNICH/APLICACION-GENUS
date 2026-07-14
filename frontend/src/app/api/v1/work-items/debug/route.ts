import { NextResponse } from "next/server";
import { canUseDriveAdapter } from "@/lib/api/bff-helpers";
import { getServerDataMode } from "@/lib/config/data-mode";
import { isDevEnvironment } from "@/lib/config/is-dev";
import { workItemsService } from "@/lib/operational/work-items.service";
import type { WorkItemsDebugResponse } from "@/types/operational/work-items-preview.types";

function demoDebug(): WorkItemsDebugResponse {
  return {
    scannedAt: new Date().toISOString(),
    source: "demo",
    totalCount: 0,
    bySector: {},
    bySource: {},
    byOriginStage: {},
    byPriority: { null: 0 },
    byConfidence: {},
    dependencies: { withDependsOn: 0, withBlockedBy: 0, withUnblocks: 0 },
    workItems: [],
    mapperWarnings: [],
    productionOverview: {
      scannedAt: new Date().toISOString(),
      source: "demo",
      capacity: null,
      load: null,
      blockers: [],
      sectors: [],
      priorities: null,
      dependencies: [],
      warnings: ["Modo demo"],
    },
    sourcesIndexed: {
      semanas_2026: false,
      pedidos_2026: false,
      asignacion_lotes_2026: false,
    },
    sourcesMapped: {
      semanas_2026: 0,
      pedidos_2026: 0,
      asignacion_lotes_2026: 0,
    },
    gaps: [],
    message: "Modo demo — activá GENUS_DATA_MODE=real.",
  };
}

/** F8.1 — dev-only WorkItems diagnostic snapshot (404 en preview/producción). */
export async function GET() {
  if (!isDevEnvironment()) {
    return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
  }

  if (getServerDataMode() !== "real" || !canUseDriveAdapter()) {
    return NextResponse.json(demoDebug());
  }

  try {
    const response = await workItemsService.getDebugSnapshot();
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        ...demoDebug(),
        source: "drive" as const,
        mapperWarnings: [
          error instanceof Error ? error.message : "Error al cargar debug snapshot.",
        ],
      },
      { status: 502 }
    );
  }
}
