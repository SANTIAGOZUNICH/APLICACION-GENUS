import { NextResponse } from "next/server";
import { canUseDriveAdapter } from "@/lib/api/bff-helpers";
import { getServerDataMode } from "@/lib/config/data-mode";
import { workItemsService } from "@/lib/operational/work-items.service";
import { CURRENT_SECTOR_OPTIONS, type CurrentSectorId } from "@/types/operational/sector";
import type { SectorId } from "@/types/operational/sector";

/** Sectores válidos en API /work-items. DEPOSITO pendiente de modelado — PR posterior. */
function parseSector(value: string | null): SectorId | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  if (CURRENT_SECTOR_OPTIONS.includes(normalized as CurrentSectorId)) {
    return normalized as SectorId;
  }
  return null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sector = parseSector(url.searchParams.get("sector"));
  const ownerPerson = url.searchParams.get("ownerPerson")?.trim() || null;

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
    return NextResponse.json({
      sector,
      ownerPerson,
      source: "demo" as const,
      scannedAt: new Date().toISOString(),
      workItems: [],
      counts: { total: 0, hoy: 0, semana: 0, pendientes: 0, bloqueados: 0 },
      message:
        getServerDataMode() !== "real"
          ? "Modo demo — WorkItems reales requieren GENUS_DATA_MODE=real."
          : "Drive no configurado — sin WorkItems inventados.",
    });
  }

  try {
    const response = await workItemsService.listForSector(sector, ownerPerson);
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        sector,
        source: "drive" as const,
        scannedAt: new Date().toISOString(),
        workItems: [],
        counts: { total: 0, hoy: 0, semana: 0, pendientes: 0, bloqueados: 0 },
        error: error instanceof Error ? error.message : "Error al cargar WorkItems.",
        code: "WORK_ITEMS_FAILED",
      },
      { status: 502 }
    );
  }
}
