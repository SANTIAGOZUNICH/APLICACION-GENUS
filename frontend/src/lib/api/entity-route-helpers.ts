import "server-only";

import { createServerAdapter } from "@/lib/adapters/adapter-factory";
import { stripEntityPageIcon } from "@/lib/adapters/rehydrate-entity-page";
import {
  demoFallbackResponse,
  shouldUseDemoFallback,
} from "@/lib/api/bff-helpers";
import type { EntityPageModelDTO } from "@/lib/api/operations-client";
import { entityPageKey } from "@/types/actions";
import type { EntityPageKind } from "@/types/entity-page";

export function getMockEntityPage(kind: EntityPageKind, entityId: string) {
  const mockPage =
    createServerAdapter().getInitialState().entityPages[
      entityPageKey(kind, entityId)
    ];

  if (!mockPage || mockPage.kind !== kind) {
    return null;
  }

  return stripEntityPageIcon(mockPage);
}

export function mockEntityNotFoundResponse(kind: EntityPageKind, entityId: string) {
  return Response.json(
    {
      error: `${kind.toUpperCase()} ${entityId} no encontrado en demo.`,
      code: "NOT_FOUND",
    },
    { status: 404 }
  );
}

export async function withEntityFallback<T extends { entityPage: EntityPageModelDTO; source: "drive" | "demo" }>(
  kind: EntityPageKind,
  entityId: string,
  loadReal: () => Promise<T | null>,
  buildMock: (page: EntityPageModelDTO) => T,
  error: unknown
) {
  if (shouldUseDemoFallback()) {
    const mockPage = getMockEntityPage(kind, entityId);
    if (mockPage) {
      console.error(`[Genus] ${kind} fallback to demo:`, error);
      return Response.json(buildMock(mockPage));
    }
  }

  const fallback = demoFallbackResponse(
    () => {
      const mockPage = getMockEntityPage(kind, entityId);
      if (!mockPage) throw error;
      return buildMock(mockPage);
    },
    error
  );

  if (!fallback.ok) return fallback.response;
  return Response.json(fallback.data);
}
