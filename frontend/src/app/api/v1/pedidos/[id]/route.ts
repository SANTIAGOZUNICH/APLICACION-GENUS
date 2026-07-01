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
import type { PedidoBundleResponse } from "@/lib/api/operations-client";
import { getServerDataMode } from "@/lib/config/data-mode";
import { EntityPageKinds } from "@/types/entity-page";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  if (getServerDataMode() !== "real" || !canUseDriveAdapter()) {
    const mockPage = getMockEntityPage(EntityPageKinds.PEDIDO, id);
    if (mockPage) {
      return NextResponse.json({
        pedidoId: id,
        entityPage: mockPage,
        source: "demo",
      } satisfies PedidoBundleResponse);
    }

    if (shouldUseDemoFallback()) {
      return mockEntityNotFoundResponse(EntityPageKinds.PEDIDO, id);
    }

    return NextResponse.json(
      { error: "Drive no configurado.", code: "DRIVE_NOT_CONFIGURED" },
      { status: 503 }
    );
  }

  try {
    const bundle = await driveAdapter.getPedido!(id);
    if (!bundle) {
      const mockPage = getMockEntityPage(EntityPageKinds.PEDIDO, id);
      if (mockPage && shouldUseDemoFallback()) {
        return NextResponse.json({
          pedidoId: id,
          entityPage: mockPage,
          source: "demo",
        } satisfies PedidoBundleResponse);
      }

      return NextResponse.json(
        { error: `Pedido ${id} no encontrado.`, code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      pedidoId: bundle.pedidoId,
      entityPage: stripEntityPageIcon(bundle.entityPage),
      source: "drive",
    } satisfies PedidoBundleResponse);
  } catch (error) {
    console.error(`[Genus] GET /api/v1/pedidos/${id} failed:`, error);
    return withEntityFallback(
      EntityPageKinds.PEDIDO,
      id,
      async () => null,
      (entityPage) => ({
        pedidoId: id,
        entityPage,
        source: "demo" as const,
      }),
      error
    );
  }
}
