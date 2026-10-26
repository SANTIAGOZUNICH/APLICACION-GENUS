import { NextResponse } from "next/server";
import { emailActor, emailError } from "@/lib/email-orders/http";
import { getEmailOrdersService } from "@/lib/email-orders/service";
import { DRAFT_STATUSES, type DraftStatus } from "@/lib/email-orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const raw = new URL(request.url).searchParams.get("status") ?? "";
    const status = raw.split(",").filter((s): s is DraftStatus => (DRAFT_STATUSES as readonly string[]).includes(s));
    return NextResponse.json({ items: await getEmailOrdersService().list(await emailActor(request), { status }) });
  } catch (err) {
    return emailError(err);
  }
}
