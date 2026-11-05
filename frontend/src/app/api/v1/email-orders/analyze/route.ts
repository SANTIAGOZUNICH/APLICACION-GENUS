import { NextResponse } from "next/server";
import { emailActor, emailError } from "@/lib/email-orders/http";
import { getEmailOrdersService } from "@/lib/email-orders/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** «Buscar pedidos nuevos»: consulta Gmail, analiza hasta 10 correos nuevos y crea borradores (opcional: ventana de 7/15/30 días o rango de fechas). */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { max?: number; scan?: number; afterDate?: string; beforeDate?: string; recheckExcluded?: boolean; windowDays?: number };
    return NextResponse.json({ result: await getEmailOrdersService().analyze(await emailActor(request), body) });
  } catch (err) {
    return emailError(err);
  }
}
