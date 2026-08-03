import { NextResponse } from "next/server";
import { resolveAuthenticatedActor } from "@/lib/auth/resolve-authenticated-actor";
import { authErrorResponse } from "@/lib/auth/http";
import { isDatabaseConfigured } from "@/lib/db/client";
import { weekStartMonday } from "@/lib/operational/operational-calendar";
import { getPlanningService } from "@/lib/planning/get-planning-service";
import { toWeeklyPlanItemDtos } from "@/lib/planning/weekly-plan-dto";
import {
  getAllowedPlanSectors,
  resolveRequestedPlanSectors,
} from "@/lib/planning/weekly-plans-rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseIsoDateParam(value: string | null): string | null {
  if (!value?.trim()) return null;
  const v = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/**
 * GET /api/v1/weekly-plans
 * Read-only shared weekly plans for CODIFICADO / DEPOSITO / MATERIA_PRIMA.
 * Server RBAC allowlist — never trust client sector alone.
 */
export async function GET(request: Request) {
  try {
    const actor = await resolveAuthenticatedActor(request);
    const allowed = getAllowedPlanSectors(actor.sector);
    if (allowed.length === 0) {
      return NextResponse.json(
        { error: "No tenés permiso para consultar planes semanales compartidos.", code: "WEEKLY_PLAN_FORBIDDEN" },
        { status: 403 }
      );
    }

    const url = new URL(request.url);
    const weekStartRaw = parseIsoDateParam(url.searchParams.get("weekStart"));
    const weekStart = weekStartRaw ? weekStartMonday(weekStartRaw) : weekStartMonday(new Date().toISOString().slice(0, 10));
    const planSector = url.searchParams.get("planSector");

    const sectors = resolveRequestedPlanSectors(actor.sector, planSector);
    if (!sectors) {
      return NextResponse.json(
        { error: "Sector de plan no autorizado.", code: "WEEKLY_PLAN_SECTOR_FORBIDDEN" },
        { status: 403 }
      );
    }

    if (!isDatabaseConfigured()) {
      return NextResponse.json(
        {
          weekStart,
          allowedSectors: allowed,
          requestedSectors: sectors,
          items: [],
          uniqueCount: 0,
          scannedAt: new Date().toISOString(),
          message: "Base de datos no disponible.",
        },
        { status: 503 }
      );
    }

    const rows = await getPlanningService().listPublishedItems({
      sectors,
      weekStart,
      limit: 500,
    });
    const items = toWeeklyPlanItemDtos(rows);

    return NextResponse.json({
      weekStart,
      allowedSectors: allowed,
      requestedSectors: sectors,
      items,
      uniqueCount: items.length,
      scannedAt: new Date().toISOString(),
      readOnly: true,
    });
  } catch (err) {
    return authErrorResponse(err);
  }
}
