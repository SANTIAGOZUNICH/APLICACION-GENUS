import { NextResponse } from "next/server";
import { canUseDriveAdapter } from "@/lib/api/bff-helpers";
import { getServerDataMode } from "@/lib/config/data-mode";
import { workItemsService } from "@/lib/operational/work-items.service";
import { CURRENT_SECTOR_OPTIONS, type CurrentSectorId } from "@/types/operational/sector";
import type { SectorId } from "@/types/operational/sector";
import type { WorkItemsPreviewResponse } from "@/types/operational/work-items-preview.types";

function parseSector(value: string | null): SectorId | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  if (CURRENT_SECTOR_OPTIONS.includes(normalized as CurrentSectorId)) {
    return normalized as SectorId;
  }
  return null;
}

function demoPreview(sector: SectorId): WorkItemsPreviewResponse {
  return {
    sector,
    scannedAt: new Date().toISOString(),
    source: "demo",
    profile: {
      greeting: sector,
      mission: "Preview requiere GENUS_DATA_MODE=real.",
      allowedActions: [],
      deniedActions: [],
      expectedSources: [],
    },
    workItems: [],
    counts: { total: 0, hoy: 0, semana: 0, pendientes: 0, bloqueados: 0 },
    sections: { hoy: [], semana: [], pendientes: [], bloqueados: [] },
    sourceBreakdown: { semanas_2026: 0, pedidos_2026: 0, asignacion_lotes_2026: 0 },
    dependencies: {
      withDependsOn: 0,
      withBlockedBy: 0,
      withUnblocks: 0,
      chainNote: "Modo demo — sin dependencias reales.",
      items: [],
    },
    gaps: [],
    mapperWarnings: [],
    message: "Modo demo — activá GENUS_DATA_MODE=real para validación funcional.",
    globalStats: { totalAllSectors: 0, bySector: {}, byOriginStage: {} },
  };
}

/** F8.1 preview — sector validation payload for /mi-trabajo. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const sector = parseSector(url.searchParams.get("sector"));

  if (!sector) {
    return NextResponse.json(
      {
        error: "Parámetro sector requerido.",
        code: "SECTOR_REQUIRED",
        allowed: CURRENT_SECTOR_OPTIONS,
      },
      { status: 400 }
    );
  }

  if (getServerDataMode() !== "real" || !canUseDriveAdapter()) {
    return NextResponse.json(demoPreview(sector));
  }

  try {
    const response = await workItemsService.getPreviewForSector(sector);
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        ...demoPreview(sector),
        source: "drive" as const,
        mapperWarnings: [
          error instanceof Error ? error.message : "Error al cargar preview.",
        ],
      },
      { status: 502 }
    );
  }
}
