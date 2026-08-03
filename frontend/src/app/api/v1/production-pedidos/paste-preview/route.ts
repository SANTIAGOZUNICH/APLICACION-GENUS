import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { parseExcelPaste } from "@/lib/production-pedidos/excel-paste";
import { getProductionPedidosService } from "@/lib/production-pedidos/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const body = (await request.json()) as { text?: string };
    const keys = await getProductionPedidosService().duplicateKeys({
      email: actor.email,
      sector: actor.sector,
      roleId: actor.roleId,
    });
    const parsed = parseExcelPaste(String(body.text ?? ""), keys);
    return NextResponse.json(parsed);
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
