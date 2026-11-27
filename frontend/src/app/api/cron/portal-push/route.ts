import { NextResponse } from "next/server";
import { runPushWorker } from "@/lib/portal/push/push-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** El worker recorre clientes piloto y reintenta envíos: holgura suficiente sin acercarse al tope del plan. */
export const maxDuration = 60;

/**
 * Worker de notificaciones Web Push del Portal de Clientes (Vercel Cron, cada 2 minutos — ver vercel.json): detecta transiciones de pedidos de
 * los clientes en piloto, las encola (idempotente) y las entrega con reintentos. Es la RED DE SEGURIDAD del disparo inmediato: corre solo, sin
 * sesión de usuario ni portal abierto. Mismo esquema de seguridad que los otros crons: `Authorization: Bearer ${CRON_SECRET}` (Vercel lo manda
 * solo cuando CRON_SECRET está definido). Responde 500 si el worker falla (Vercel lo muestra como error de cron) y deja el latido en la base
 * aunque no haya eventos. Desacoplado de Producción: un fallo se informa acá y NUNCA afecta a una operación de planta.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "CRON_SECRET no configurado." }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, push: await runPushWorker({ trigger: "cron" }) });
  } catch (err) {
    console.error("[portal-push] el worker falló (sin efecto sobre Producción)", err);
    return NextResponse.json({ ok: false, error: "El worker de notificaciones falló; se reintenta en la próxima corrida." }, { status: 500 });
  }
}
