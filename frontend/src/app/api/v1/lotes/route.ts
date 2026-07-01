import { NextResponse } from "next/server";
import {
  createServerAdapter,
  sheetsAdapter,
} from "@/lib/adapters/adapter-factory";
import { stripEntityPageIcon } from "@/lib/adapters/rehydrate-entity-page";
import {
  getServerDataMode,
  shouldFallbackToDemo,
} from "@/lib/config/data-mode";
import type { LoteListResponse } from "@/lib/api/operations-client";

export async function GET() {
  if (getServerDataMode() !== "real") {
    return NextResponse.json({
      lotes: [],
      source: "demo",
    } satisfies LoteListResponse);
  }

  try {
    const bundles = await sheetsAdapter.listLoteEntityPages!();
    return NextResponse.json({
      lotes: bundles.map((bundle) => ({
        loteId: bundle.loteId,
        entityPage: stripEntityPageIcon(bundle.entityPage),
        source: "sheets",
      })),
      source: "sheets",
    } satisfies LoteListResponse);
  } catch (error) {
    console.error("[Genus] GET /api/v1/lotes failed:", error);

    if (!shouldFallbackToDemo()) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "No se pudieron leer los lotes.",
          code: "SHEETS_READ_FAILED",
        },
        { status: 502 }
      );
    }

    const mockLotes = Object.values(
      createServerAdapter().getInitialState().entityPages
    )
      .filter((page) => page.kind === "lote")
      .map((page) => ({
        loteId: page.entityId,
        entityPage: stripEntityPageIcon(page),
        source: "demo" as const,
      }));

    return NextResponse.json({
      lotes: mockLotes,
      source: "demo",
    } satisfies LoteListResponse);
  }
}
