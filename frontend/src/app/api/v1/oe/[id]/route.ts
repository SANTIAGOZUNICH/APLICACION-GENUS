import { NextResponse } from "next/server";
import { createServerAdapter, driveAdapter } from "@/lib/adapters/adapter-factory";
import { stripEntityPageIcon } from "@/lib/adapters/rehydrate-entity-page";
import { normalizeOeId } from "@/lib/adapters/drive/parse-oe-id";
import {
  canUseDriveAdapter,
  shouldUseDemoFallback,
} from "@/lib/api/bff-helpers";
import { getServerDataMode } from "@/lib/config/data-mode";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const oeId = normalizeOeId(id);

  if (getServerDataMode() !== "real" || !canUseDriveAdapter()) {
    const mockPage =
      createServerAdapter().getInitialState().entityPages[`oe:${oeId}`];

    if (mockPage && mockPage.kind === "oe") {
      return NextResponse.json({
        oeId,
        entityPage: stripEntityPageIcon(mockPage),
        source: "demo",
      });
    }

    if (shouldUseDemoFallback()) {
      return NextResponse.json(
        { error: `OE ${oeId} no encontrada en demo.`, code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: "Drive no configurado.", code: "DRIVE_NOT_CONFIGURED" },
      { status: 503 }
    );
  }

  try {
    const bundle = await driveAdapter.getOeEntityPage!(oeId);
    if (!bundle) {
      return NextResponse.json(
        {
          error: `OE ${oeId} no encontrada en el índice. Ejecutá /api/v1/drive/refresh.`,
          code: "NOT_FOUND",
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      oeId: bundle.oeId,
      entityPage: stripEntityPageIcon(bundle.entityPage),
      source: "drive",
    });
  } catch (error) {
    console.error(`[Genus] GET /api/v1/oe/${oeId} failed:`, error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo leer la OE.",
        code: "OE_READ_FAILED",
      },
      { status: 502 }
    );
  }
}
