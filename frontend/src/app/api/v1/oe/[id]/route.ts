import { NextResponse } from "next/server";
import { createServerAdapter, driveAdapter } from "@/lib/adapters/adapter-factory";
import { stripEntityPageIcon } from "@/lib/adapters/rehydrate-entity-page";
import { normalizeLookupKey } from "@/lib/adapters/drive/oe-document-locator";
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
  const lookupKey = normalizeLookupKey(id);

  if (getServerDataMode() !== "real" || !canUseDriveAdapter()) {
    const mockPage =
      createServerAdapter().getInitialState().entityPages[`oe:${lookupKey}`];

    if (mockPage && mockPage.kind === "oe") {
      return NextResponse.json({
        lookupKey,
        oeId: lookupKey,
        entityPage: stripEntityPageIcon(mockPage),
        source: "demo",
      });
    }

    if (shouldUseDemoFallback()) {
      return NextResponse.json(
        { error: `OE ${lookupKey} no encontrada en demo.`, code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: "Drive no configurado.", code: "DRIVE_NOT_CONFIGURED" },
      { status: 503 }
    );
  }

  try {
    const bundle = await driveAdapter.getOeEntityPage!(lookupKey);
    if (!bundle) {
      return NextResponse.json(
        {
          error: `Documento OE no encontrado para "${lookupKey}". Probá con fileId o fileSlug del índice.`,
          code: "NOT_FOUND",
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      fileId: bundle.fileId,
      fileName: bundle.fileName,
      oeId: bundle.oeId,
      fields: bundle.fields,
      entityPage: stripEntityPageIcon(bundle.entityPage),
      source: "drive",
    });
  } catch (error) {
    console.error(`[Genus] GET /api/v1/oe/${lookupKey} failed:`, error);
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
