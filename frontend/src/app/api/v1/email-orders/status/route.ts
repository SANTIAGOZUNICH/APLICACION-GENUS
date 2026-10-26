import { NextResponse } from "next/server";
import { emailActor, emailError } from "@/lib/email-orders/http";
import { getEmailOrdersService } from "@/lib/email-orders/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return NextResponse.json(await getEmailOrdersService().status(await emailActor(request)));
  } catch (err) {
    return emailError(err);
  }
}
