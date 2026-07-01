import { NextResponse } from "next/server";
import {
  createServerAdapter,
  driveAdapter,
} from "@/lib/adapters/adapter-factory";
import { stripEntityPageIcon } from "@/lib/adapters/rehydrate-entity-page";
import {
  canUseDriveAdapter,
  demoFallbackResponse,
  getMockLoteBundles,
  shouldUseDemoFallback,
} from "@/lib/api/bff-helpers";
import type { LoteListResponse } from "@/lib/api/operations-client";
import { getServerDataMode } from "@/lib/config/data-mode";

export async function GET() {
  if (getServerDataMode() !== "real" || !canUseDriveAdapter()) {
    if (shouldUseDemoFallback()) {
      const mockLotes = getMockLoteBundles();
      return NextResponse.json({
        lotes: mockLotes.map((bundle) => ({
          loteId: bundle.loteId,
          entityPage: stripEntityPageIcon(bundle.entityPage),
          source: "demo",
        })),
        source: "demo",
      } satisfies LoteListResponse);
    }

    return NextResponse.json({
      lotes: [],
      source: "demo",
    } satisfies LoteListResponse);
  }

  try {
    const bundles = await driveAdapter.listLoteEntityPages!();
    return NextResponse.json({
      lotes: bundles.map((bundle) => ({
        loteId: bundle.loteId,
        entityPage: stripEntityPageIcon(bundle.entityPage),
        source: "drive",
      })),
      source: "drive",
    } satisfies LoteListResponse);
  } catch (error) {
    console.error("[Genus] GET /api/v1/lotes failed:", error);

    const fallback = demoFallbackResponse(
      () =>
        getMockLoteBundles().map((bundle) => ({
          loteId: bundle.loteId,
          entityPage: stripEntityPageIcon(bundle.entityPage),
          source: "demo" as const,
        })),
      error
    );

    if (!fallback.ok) return fallback.response;

    return NextResponse.json({
      lotes: fallback.data,
      source: fallback.source,
    } satisfies LoteListResponse);
  }
}

void createServerAdapter;
