import { NextResponse } from "next/server";
import { emailActor, emailError } from "@/lib/email-orders/http";
import { getEmailOrdersService } from "@/lib/email-orders/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await getEmailOrdersService().disconnect(await emailActor(request));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return emailError(err);
  }
}
