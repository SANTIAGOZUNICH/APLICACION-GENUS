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
import type { LoteBundleResponse } from "@/lib/api/operations-client";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  if (getServerDataMode() !== "real") {
    const mockPage =
      createServerAdapter().getInitialState().entityPages[`lote:${id}`];

    if (!mockPage || mockPage.kind !== "lote") {
      return NextResponse.json(
        { error: `Lote ${id} no encontrado en modo demo.`, code: "NOT_FOUND" },
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
    const bundle = await sheetsAdapter.getLoteEntityPage!(id);
    if (!bundle) {
      return NextResponse.json(
        { error: `Lote ${id} no encontrado.`, code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      loteId: bundle.loteId,
      entityPage: stripEntityPageIcon(bundle.entityPage),
      source: "sheets",
    } satisfies LoteBundleResponse);
  } catch (error) {
    console.error(`[Genus] GET /api/v1/lotes/${id} failed:`, error);

    if (!shouldFallbackToDemo()) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "No se pudo leer el lote.",
          code: "SHEETS_READ_FAILED",
        },
        { status: 502 }
      );
    }

    const mockPage =
      createServerAdapter().getInitialState().entityPages[`lote:${id}`];

    if (!mockPage || mockPage.kind !== "lote") {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : `Lote ${id} no encontrado.`,
          code: "SHEETS_READ_FAILED",
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      loteId: id,
      entityPage: stripEntityPageIcon(mockPage),
      source: "demo",
    } satisfies LoteBundleResponse);
  }
}
