import { NextResponse } from "next/server";
import { runPushWorker } from "@/lib/portal/push/push-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Worker de notificaciones Web Push del Portal de Clientes: detecta transiciones de pedidos de los clientes en piloto, las encola
 * (idempotente) y las entrega con reintentos. Mismo esquema de seguridad que los otros crons: exige CRON_SECRET.
 * Desacoplado de Producción: un fallo se informa acá y NUNCA afecta a una operación de planta. Con el envío real apagado
 * (por defecto) solo registra eventos «simulados».
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "CRON_SECRET no configurado." }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, push: await runPushWorker() });
  } catch (err) {
    console.error("[portal-push] el worker falló (sin efecto sobre Producción)", err);
    return NextResponse.json({ ok: false, error: "El worker de notificaciones falló; se reintenta en la próxima corrida." }, { status: 200 });
  }
}
