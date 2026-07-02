import { NextResponse } from "next/server";
import { driveAdapter } from "@/lib/adapters/adapter-factory";
import { stripEntityPageIcon } from "@/lib/adapters/rehydrate-entity-page";
import {
  canUseDriveAdapter,
  shouldUseDemoFallback,
} from "@/lib/api/bff-helpers";
import {
  getMockEntityPage,
  mockEntityNotFoundResponse,
  withEntityFallback,
} from "@/lib/api/entity-route-helpers";
import type { LiberacionBundleResponse } from "@/lib/api/operations-client";
import { getServerDataMode } from "@/lib/config/data-mode";
import { EntityPageKinds } from "@/types/entity-page";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  if (getServerDataMode() !== "real" || !canUseDriveAdapter()) {
    const mockPage = getMockEntityPage(EntityPageKinds.LIBERACION, id);
    if (mockPage) {
      return NextResponse.json({
        liberacionId: id,
        entityPage: mockPage,
        source: "demo",
      } satisfies LiberacionBundleResponse);
    }

    if (shouldUseDemoFallback()) {
      return mockEntityNotFoundResponse(EntityPageKinds.LIBERACION, id);
    }

    return NextResponse.json(
      { error: "Drive no configurado.", code: "DRIVE_NOT_CONFIGURED" },
      { status: 503 }
    );
  }

  try {
    const bundle = await driveAdapter.getLiberacion!(id);
    if (!bundle) {
      const mockPage = getMockEntityPage(EntityPageKinds.LIBERACION, id);
      if (mockPage && shouldUseDemoFallback()) {
        return NextResponse.json({
          liberacionId: id,
          entityPage: mockPage,
          source: "demo",
        } satisfies LiberacionBundleResponse);
      }

      return NextResponse.json(
        { error: `Liberación ${id} no encontrada.`, code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      liberacionId: bundle.liberacionId,
      loteId: bundle.loteId,
      entityPage: stripEntityPageIcon(bundle.entityPage),
      source: "drive",
    } satisfies LiberacionBundleResponse);
  } catch (error) {
    console.error(`[Genus] GET /api/v1/liberaciones/${id} failed:`, error);
    return withEntityFallback(
      EntityPageKinds.LIBERACION,
      id,
      async () => null,
      (entityPage) => ({
        liberacionId: id,
        entityPage,
        source: "demo" as const,
      }),
      error
    );
  }
}
