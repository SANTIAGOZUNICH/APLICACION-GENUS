import { NextRequest, NextResponse } from "next/server";
import { canUseDriveAdapter } from "@/lib/api/bff-helpers";
import { getServerDataMode } from "@/lib/config/data-mode";
import { liveSyncEngine } from "@/lib/live-sync/live-sync-engine";
import type { SectorId } from "@/types/operational/sector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Check liviano Sheet → Genus OS (poll iniciado por el cliente).
 * No usa Drive discovery ni modifiedTime.
 * Idempotente: misma versión no regenera el snapshot.
 */
export async function GET(request: NextRequest) {
  if (getServerDataMode() !== "real" || !canUseDriveAdapter()) {
    return NextResponse.json({
      changed: false,
      version: "demo",
      checkedAt: new Date().toISOString(),
      mode: "demo",
    });
  }

  const { searchParams } = request.nextUrl;
  const sector = searchParams.get("sector") as SectorId | null;
  const date = searchParams.get("date");
  const weekStart = searchParams.get("weekStart");
  const knownVersion = searchParams.get("knownVersion");

  try {
    const result = await liveSyncEngine.check(knownVersion);

    return NextResponse.json({
      changed: result.changed,
      version: result.version,
      revision: result.revision,
      checkedAt: result.checkedAt,
      sector: sector ?? undefined,
      date: date ?? undefined,
      weekStart: weekStart ?? undefined,
      metrics: result.metrics,
      mode: "real",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "live-sync check failed";
    const is429 = /429|rate limit|quota/i.test(message);
    return NextResponse.json(
      {
        error: message,
        code: is429 ? "RATE_LIMITED" : "CHECK_FAILED",
        checkedAt: new Date().toISOString(),
      },
      { status: is429 ? 429 : 503 }
    );
  }
}
