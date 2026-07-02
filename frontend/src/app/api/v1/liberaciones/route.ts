import { NextResponse } from "next/server";
import { driveAdapter } from "@/lib/adapters/adapter-factory";
import {
  canUseDriveAdapter,
  shouldUseDemoFallback,
} from "@/lib/api/bff-helpers";
import { getServerDataMode } from "@/lib/config/data-mode";

export async function GET() {
  if (getServerDataMode() !== "real" || !canUseDriveAdapter()) {
    return NextResponse.json({ liberaciones: [], source: "demo" });
  }

  try {
    const liberaciones = await driveAdapter.listLiberaciones!();
    return NextResponse.json({
      liberaciones,
      count: liberaciones.length,
      source: "drive",
    });
  } catch (error) {
    console.error("[Genus] GET /api/v1/liberaciones failed:", error);
    if (shouldUseDemoFallback()) {
      return NextResponse.json({ liberaciones: [], source: "demo" });
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo leer liberaciones.",
        code: "LIBERACION_LIST_FAILED",
      },
      { status: 502 }
    );
  }
}
