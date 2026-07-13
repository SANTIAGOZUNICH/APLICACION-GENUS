import { NextResponse } from "next/server";
import { canUseDriveAdapter } from "@/lib/api/bff-helpers";
import { getServerDataMode } from "@/lib/config/data-mode";
import { workItemsService } from "@/lib/operational/work-items.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Estado del Live Sync Engine — edad del snapshot y suscriptores activos. */
export async function GET() {
  if (getServerDataMode() !== "real" || !canUseDriveAdapter()) {
    return NextResponse.json({
      revision: 0,
      updatedAt: new Date().toISOString(),
      sheetsSyncedAt: null,
      subscribers: 0,
      snapshotReady: false,
      workItemCount: 0,
      mode: "demo",
    });
  }

  const status = workItemsService.getSyncStatus();
  return NextResponse.json({ ...status, mode: "real" });
}
