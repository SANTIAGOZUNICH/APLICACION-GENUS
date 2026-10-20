import { NextResponse } from "next/server";
import { withBillingActor, noStore } from "@/lib/billing/api";
import { canWriteBilling, listBillingRows } from "@/lib/billing/billing-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withBillingActor(request, async (actor) => {
    const p = new URL(request.url).searchParams;
    const get = (k: string) => p.get(k) || undefined;
    const rows = await listBillingRows(actor, {
      q: get("q"), client: get("client"), pedido: get("pedido"), product: get("product"), state: get("state"),
      deliveryState: get("deliveryState"), from: get("from"), to: get("to"), workItemId: get("workItemId"),
    });
    return NextResponse.json({ rows, canWrite: canWriteBilling(actor.sector) }, { headers: noStore });
  });
}
