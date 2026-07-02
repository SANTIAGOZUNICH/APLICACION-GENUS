import { NextResponse } from "next/server";
import { driveAdapter } from "@/lib/adapters/adapter-factory";
import {
  canUseDriveAdapter,
  shouldUseDemoFallback,
} from "@/lib/api/bff-helpers";
import { getServerDataMode } from "@/lib/config/data-mode";

export async function GET() {
  if (getServerDataMode() !== "real" || !canUseDriveAdapter()) {
    return NextResponse.json({ oas: [], source: "demo" });
  }

  try {
    const oas = await driveAdapter.listOA!();
    return NextResponse.json({
      oas,
      count: oas.length,
      source: "drive",
    });
  } catch (error) {
    console.error("[Genus] GET /api/v1/oa failed:", error);
    if (shouldUseDemoFallback()) {
      return NextResponse.json({ oas: [], source: "demo" });
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "No se pudo leer el índice OA.",
        code: "OA_INDEX_FAILED",
      },
      { status: 502 }
    );
  }
}
