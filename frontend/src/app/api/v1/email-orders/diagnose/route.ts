import { NextResponse } from "next/server";
import { emailActor, emailError } from "@/lib/email-orders/http";
import { getEmailOrdersService } from "@/lib/email-orders/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Prueba del filtro de destinatario original (solo encabezados; no analiza, no usa IA, no escribe). */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { scan?: number; afterDate?: string };
    return NextResponse.json(await getEmailOrdersService().diagnoseFilter(await emailActor(request), body));
  } catch (err) {
    return emailError(err);
  }
}
