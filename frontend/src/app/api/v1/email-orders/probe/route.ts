import { NextResponse } from "next/server";
import { emailActor, emailError } from "@/lib/email-orders/http";
import { getEmailOrdersService } from "@/lib/email-orders/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** «Verificar conexión»: consulta Gmail DE VERDAD (perfil + muestra de la bandeja). No analiza ni guarda correos. */
export async function POST(request: Request) {
  try {
    return NextResponse.json(await getEmailOrdersService().checkConnection(await emailActor(request)));
  } catch (err) {
    return emailError(err);
  }
}
