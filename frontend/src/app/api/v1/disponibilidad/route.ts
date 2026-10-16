import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { AvailabilityError, getAvailabilityState, markReadyForDelivery, retractAvailability, type AvailabilityActor } from "@/lib/portal/availability-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function actorOf(request: Request): Promise<AvailabilityActor> {
  // Identidad SIEMPRE de la sesión del servidor (nunca de lo que mande el navegador).
  const a = await resolveOrdersActor(request);
  return { email: a.email, sector: a.sector, displayName: a.displayName };
}

function fail(err: unknown) {
  if (err instanceof AvailabilityError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  return ordersErrorResponse(err);
}

/** Estado de disponibilidad de un trabajo para el usuario actual. */
export async function GET(request: Request) {
  try {
    const actor = await actorOf(request);
    const workItemId = new URL(request.url).searchParams.get("workItemId") ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(workItemId)) throw new AvailabilityError("Trabajo inválido.", 400, "BAD_WORK");
    return NextResponse.json(await getAvailabilityState(actor, workItemId));
  } catch (err) {
    return fail(err);
  }
}

/** Marcar «Listo para entregar» (action=mark) o rectificar (action=retract). Permisos y cantidades se validan acá. */
export async function POST(request: Request) {
  try {
    const actor = await actorOf(request);
    const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b || typeof b.action !== "string") throw new AvailabilityError("Solicitud inválida.", 400, "BAD_REQUEST");
    if (b.action === "mark") {
      const r = await markReadyForDelivery(actor, { workItemId: String(b.workItemId ?? ""), quantity: b.quantity, idempotencyKey: b.idempotencyKey });
      return NextResponse.json(r, { status: r.replayed ? 200 : 201 });
    }
    if (b.action === "retract") return NextResponse.json(await retractAvailability(actor, { markId: String(b.markId ?? ""), reason: b.reason }));
    throw new AvailabilityError("Acción desconocida.", 400, "BAD_ACTION");
  } catch (err) {
    return fail(err);
  }
}
