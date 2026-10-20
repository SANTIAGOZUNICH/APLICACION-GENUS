import { NextResponse } from "next/server";
import { withBillingActor, noStore } from "@/lib/billing/api";
import { listBillableDeliveries } from "@/lib/billing/billing-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withBillingActor(request, async (actor) => {
    const p = new URL(request.url).searchParams;
    const deliveries = await listBillableDeliveries(actor, {
      rootKey: p.get("rootKey") || undefined,
      workItemId: p.get("workItemId") || undefined,
      client: p.get("client") || undefined,
      onlyPending: p.get("onlyPending") === "1",
    });
    return NextResponse.json({ deliveries }, { headers: noStore });
  });
}
