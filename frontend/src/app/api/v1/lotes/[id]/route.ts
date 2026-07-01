import { NextResponse } from "next/server";
import {
  createServerAdapter,
  driveAdapter,
} from "@/lib/adapters/adapter-factory";
import { stripEntityPageIcon } from "@/lib/adapters/rehydrate-entity-page";
import {
  canUseDriveAdapter,
  demoFallbackResponse,
  shouldUseDemoFallback,
} from "@/lib/api/bff-helpers";
import type { LoteBundleResponse } from "@/lib/api/operations-client";
import { getServerDataMode } from "@/lib/config/data-mode";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  if (getServerDataMode() !== "real" || !canUseDriveAdapter()) {
    const mockPage =
      createServerAdapter().getInitialState().entityPages[`lote:${id}`];

    if (!mockPage || mockPage.kind !== "lote") {
      if (shouldUseDemoFallback()) {
        return NextResponse.json(
          { error: `Lote ${id} no encontrado en modo demo.`, code: "NOT_FOUND" },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { error: `Lote ${id} no encontrado.`, code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      loteId: id,
      entityPage: stripEntityPageIcon(mockPage),
      source: "demo",
    } satisfies LoteBundleResponse);
  }

  try {
    const bundle = await driveAdapter.getLoteEntityPage!(id);
    if (!bundle) {
      return NextResponse.json(
        { error: `Lote ${id} no encontrado.`, code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      loteId: bundle.loteId,
      entityPage: stripEntityPageIcon(bundle.entityPage),
      source: "drive",
    } satisfies LoteBundleResponse);
  } catch (error) {
    console.error(`[Genus] GET /api/v1/lotes/${id} failed:`, error);

    const mockPage =
      createServerAdapter().getInitialState().entityPages[`lote:${id}`];

    const fallback = demoFallbackResponse(
      () => {
        if (!mockPage || mockPage.kind !== "lote") {
          throw error;
        }
        return {
          loteId: id,
          entityPage: stripEntityPageIcon(mockPage),
          source: "demo" as const,
        };
      },
      error
    );

    if (!fallback.ok) return fallback.response;

    return NextResponse.json(fallback.data satisfies LoteBundleResponse);
  }
}
