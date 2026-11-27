import { withPortalPush } from "@/lib/portal/push/push-trigger";
import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { getProductionPedidosService } from "@/lib/production-pedidos/service";
import type { ProductionPedidoCreateInput } from "@/lib/production-pedidos/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const url = new URL(request.url);
    const result = await getProductionPedidosService().list(
      { email: actor.email, sector: actor.sector, roleId: actor.roleId },
      {
        op: url.searchParams.get("op") ?? undefined,
        nroOc: url.searchParams.get("nroOc") ?? undefined,
        cliente: url.searchParams.get("cliente") ?? undefined,
        producto: url.searchParams.get("producto") ?? undefined,
        estado: url.searchParams.get("estado") ?? undefined,
        fechaFrom: url.searchParams.get("fechaFrom") ?? undefined,
        fechaTo: url.searchParams.get("fechaTo") ?? undefined,
        search: url.searchParams.get("search") ?? undefined,
      }
    );
    return NextResponse.json({
      items: result.items,
      schemaPending: result.schemaPending,
      persistenceReady: !result.schemaPending,
    });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}

async function handlePost(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const body = (await request.json()) as ProductionPedidoCreateInput;
    const { record: item, opReassigned } = await getProductionPedidosService().createWithMeta(
      { email: actor.email, sector: actor.sector, roleId: actor.roleId },
      body
    );
    return NextResponse.json({ item, opReassigned }, { status: 201 });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}

/** Tras confirmar la operación se dispara (en segundo plano, sin afectarla) la detección de avisos del Portal de Clientes. */
export const POST = withPortalPush(handlePost);
