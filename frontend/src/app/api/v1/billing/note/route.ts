import { NextResponse } from "next/server";
import { withBillingActor, noStore } from "@/lib/billing/api";
import { saveBillingNote } from "@/lib/billing/billing-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  return withBillingActor(request, async (actor) => {
    const body = (await request.json().catch(() => ({}))) as { rootKey?: string; observations?: string };
    await saveBillingNote(actor, String(body.rootKey ?? ""), String(body.observations ?? ""));
    return NextResponse.json({ ok: true }, { headers: noStore });
  });
}
