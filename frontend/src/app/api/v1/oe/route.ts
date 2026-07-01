import { NextResponse } from "next/server";
import { driveAdapter } from "@/lib/adapters/adapter-factory";
import {
  canUseDriveAdapter,
  shouldUseDemoFallback,
} from "@/lib/api/bff-helpers";
import { getServerDataMode } from "@/lib/config/data-mode";

export async function GET() {
  if (getServerDataMode() !== "real" || !canUseDriveAdapter()) {
    return NextResponse.json({
      oes: [],
      source: "demo",
      message: shouldUseDemoFallback()
        ? "Modo demo — índice OE vacío."
        : undefined,
    });
  }

  try {
    const oes = await driveAdapter.listOeIndex!();
    return NextResponse.json({
      oes,
      count: oes.length,
      source: "drive",
    });
  } catch (error) {
    console.error("[Genus] GET /api/v1/oe failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo listar el índice de OEs.",
        code: "OE_INDEX_FAILED",
      },
      { status: 502 }
    );
  }
}
