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
import type { OaBundleResponse } from "@/lib/api/operations-client";
import { getServerDataMode } from "@/lib/config/data-mode";
import { EntityPageKinds } from "@/types/entity-page";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const lookupKey = normalizeLookupKey(id);

  if (getServerDataMode() !== "real" || !canUseDriveAdapter()) {
    const mockPage = getMockEntityPage(EntityPageKinds.OA, lookupKey);
    if (mockPage) {
      return NextResponse.json({
        lookupKey,
        oaId: lookupKey,
        entityPage: mockPage,
        source: "demo",
      } satisfies OaBundleResponse);
    }

    if (shouldUseDemoFallback()) {
      return mockEntityNotFoundResponse(EntityPageKinds.OA, lookupKey);
    }

    return NextResponse.json(
      { error: "Drive no configurado.", code: "DRIVE_NOT_CONFIGURED" },
      { status: 503 }
    );
  }

  try {
    const bundle = await driveAdapter.getOA!(lookupKey);
    if (!bundle) {
      const mockPage = getMockEntityPage(EntityPageKinds.OA, lookupKey);
      if (mockPage && shouldUseDemoFallback()) {
        return NextResponse.json({
          lookupKey,
          oaId: lookupKey,
          entityPage: mockPage,
          source: "demo",
        } satisfies OaBundleResponse);
      }

      return NextResponse.json(
        {
          error: `Documento OA no encontrado para "${lookupKey}".`,
          code: "NOT_FOUND",
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      fileId: bundle.fileId,
      fileName: bundle.fileName,
      oaId: bundle.oaId,
      entityPage: stripEntityPageIcon(bundle.entityPage),
      source: "drive",
    } satisfies OaBundleResponse);
  } catch (error) {
    console.error(`[Genus] GET /api/v1/oa/${lookupKey} failed:`, error);
    return withEntityFallback(
      EntityPageKinds.OA,
      lookupKey,
      async () => null,
      (entityPage) => ({
        lookupKey,
        oaId: lookupKey,
        entityPage,
        source: "demo" as const,
      }),
      error
    );
  }
}
