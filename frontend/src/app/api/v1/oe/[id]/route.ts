import { NextResponse } from "next/server";
import { driveAdapter } from "@/lib/adapters/adapter-factory";
import { stripEntityPageIcon } from "@/lib/adapters/rehydrate-entity-page";
import { normalizeLookupKey } from "@/lib/adapters/drive/oe-document-locator";
import {
  canUseDriveAdapter,
  shouldUseDemoFallback,
} from "@/lib/api/bff-helpers";
import {
  getMockEntityPage,
  mockEntityNotFoundResponse,
  withEntityFallback,
} from "@/lib/api/entity-route-helpers";
import type { OeBundleResponse } from "@/lib/api/operations-client";
import { getServerDataMode } from "@/lib/config/data-mode";
import { EntityPageKinds } from "@/types/entity-page";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const lookupKey = normalizeLookupKey(id);

  if (getServerDataMode() !== "real" || !canUseDriveAdapter()) {
    const mockPage = getMockEntityPage(EntityPageKinds.OE, lookupKey);

    if (mockPage) {
      return NextResponse.json({
        lookupKey,
        oeId: lookupKey,
        entityPage: mockPage,
        source: "demo",
      } satisfies OeBundleResponse);
    }

    if (shouldUseDemoFallback()) {
      return mockEntityNotFoundResponse(EntityPageKinds.OE, lookupKey);
    }

    return NextResponse.json(
      { error: "Drive no configurado.", code: "DRIVE_NOT_CONFIGURED" },
      { status: 503 }
    );
  }

  try {
    const bundle = await driveAdapter.getOE!(lookupKey);
    if (!bundle) {
      const mockPage = getMockEntityPage(EntityPageKinds.OE, lookupKey);
      if (mockPage && shouldUseDemoFallback()) {
        return NextResponse.json({
          lookupKey,
          oeId: lookupKey,
          entityPage: mockPage,
          source: "demo",
        } satisfies OeBundleResponse);
      }

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
    } satisfies OeBundleResponse);
  } catch (error) {
    console.error(`[Genus] GET /api/v1/oe/${lookupKey} failed:`, error);
    return withEntityFallback(
      EntityPageKinds.OE,
      lookupKey,
      async () => null,
      (entityPage) => ({
        lookupKey,
        oeId: lookupKey,
        entityPage,
        source: "demo" as const,
      }),
      error
    );
  }
}
