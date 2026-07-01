import { NextResponse } from "next/server";
import { driveAdapter } from "@/lib/adapters/adapter-factory";
import { mockAdapter } from "@/lib/adapters/mock-adapter";
import {
  allFallbackUsed,
  buildEmptyRealHydration,
} from "@/lib/adapters/drive/resolvers/operations-state.resolver";
import {
  canUseDriveAdapter,
  shouldUseDemoFallback,
} from "@/lib/api/bff-helpers";
import { getServerDataMode } from "@/lib/config/data-mode";
import {
  createEmptyCounts,
  createEmptyFallbackUsed,
} from "@/types/operations/operations-diagnostics";

function buildDemoDiagnostics(source: "demo" | "drive", fallbackUsed: boolean) {
  const mockState = mockAdapter.getInitialState();
  return {
    dataMode: getServerDataMode(),
    source,
    counts: {
      oe: Object.values(mockState.entityPages).filter((p) => p.kind === "oe").length,
      lotes: Object.values(mockState.entityPages).filter((p) => p.kind === "lote").length,
      pedidos: Object.values(mockState.entityPages).filter((p) => p.kind === "pedido").length,
      oa: Object.values(mockState.entityPages).filter((p) => p.kind === "oa").length,
      liberaciones: Object.values(mockState.entityPages).filter((p) => p.kind === "liberacion").length,
    },
    fallbackUsed: fallbackUsed ? allFallbackUsed(true) : createEmptyFallbackUsed(),
    message: fallbackUsed
      ? "Datos demo etiquetados como fallback."
      : "Modo demo activo.",
  };
}

export async function GET() {
  const dataMode = getServerDataMode();

  if (dataMode !== "real" || !canUseDriveAdapter()) {
    if (dataMode === "real" && !canUseDriveAdapter()) {
      const empty = buildEmptyRealHydration();
      return NextResponse.json({
        ...empty,
        source: "demo",
        diagnostics: {
          dataMode,
          source: "demo",
          counts: createEmptyCounts(),
          fallbackUsed: createEmptyFallbackUsed(),
          message:
            "Modo real sin Drive configurado — sin datos ficticios. Configurá credenciales y GOOGLE_DRIVE_GENUS_FOLDER_ID.",
        },
      });
    }

    const mockState = mockAdapter.getInitialState();
    return NextResponse.json({
      bandejaTasks: mockState.bandejaTasks,
      workspaceTasks: mockState.workspaceTasks,
      dayPulse: mockState.dayPulse,
      workspacePanorama: { direccion: undefined },
      source: "demo",
      diagnostics: buildDemoDiagnostics("demo", false),
    });
  }

  try {
    const hydration = await driveAdapter.buildOperationsHydration!();
    const responseSource = hydration.source ?? "drive";

    return NextResponse.json({
      bandejaTasks: hydration.bandejaTasks,
      workspaceTasks: hydration.workspaceTasks,
      dayPulse: hydration.dayPulse,
      workspacePanorama: hydration.workspacePanorama,
      source: responseSource,
      diagnostics: {
        dataMode,
        source: responseSource,
        counts: hydration.counts,
        fallbackUsed: createEmptyFallbackUsed(),
        realSources: hydration.realSources,
        message: `E7.2 — ${hydration.counts.oe} OEs indexadas en ELABORACION.`,
      },
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
        diagnostics: {
          dataMode,
          source: "demo",
          counts: createEmptyCounts(),
          fallbackUsed: allFallbackUsed(true),
          message:
            "Error al leer Drive — fallback demo activo y etiquetado. Los datos mostrados NO son reales.",
        },
      });
    }

    const empty = buildEmptyRealHydration();
    return NextResponse.json(
      {
        ...empty,
        source: "drive-partial",
        diagnostics: {
          dataMode,
          source: "drive-partial",
          counts: createEmptyCounts(),
          fallbackUsed: createEmptyFallbackUsed(),
          message:
            error instanceof Error
              ? error.message
              : "No se pudo construir el estado operativo.",
        },
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
