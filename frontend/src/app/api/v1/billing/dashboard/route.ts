import { NextResponse } from "next/server";
import { withBillingActor, noStore } from "@/lib/billing/api";
import { billingDashboard } from "@/lib/billing/billing-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withBillingActor(request, async (actor) => {
    const p = new URL(request.url).searchParams;
    const dashboard = await billingDashboard(actor, { client: p.get("client") || undefined, from: p.get("from") || undefined, to: p.get("to") || undefined });
    return NextResponse.json({ dashboard }, { headers: noStore });
  });
}
