import { NextResponse } from "next/server";
import { driveAdapter } from "@/lib/adapters/adapter-factory";
import { mockAdapter } from "@/lib/adapters/mock-adapter";
import {
  canUseDriveAdapter,
  shouldUseDemoFallback,
} from "@/lib/api/bff-helpers";
import { getServerDataMode } from "@/lib/config/data-mode";

export async function GET() {
  if (getServerDataMode() !== "real" || !canUseDriveAdapter()) {
    if (shouldUseDemoFallback()) {
      const mockState = mockAdapter.getInitialState();
      return NextResponse.json({
        bandejaTasks: mockState.bandejaTasks,
        workspaceTasks: mockState.workspaceTasks,
        dayPulse: mockState.dayPulse,
        workspacePanorama: { direccion: undefined },
        source: "demo",
      });
    }

    return NextResponse.json({
      bandejaTasks: [],
      workspaceTasks: {},
      dayPulse: { completed: 0, pending: 0 },
      workspacePanorama: {},
      source: "demo",
    });
  }

  try {
    const hydration = await driveAdapter.buildOperationsHydration!();
    return NextResponse.json({
      ...hydration,
      source: "drive",
    });
  } catch (error) {
    console.error("[Genus] GET /api/v1/operations/state failed:", error);

    if (shouldUseDemoFallback()) {
      const mockState = mockAdapter.getInitialState();
      return NextResponse.json({
        bandejaTasks: mockState.bandejaTasks,
        workspaceTasks: mockState.workspaceTasks,
        dayPulse: mockState.dayPulse,
        workspacePanorama: {},
        source: "demo",
      });
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo construir el estado operativo.",
        code: "OPERATIONS_STATE_FAILED",
      },
      { status: 502 }
    );
  }
}
