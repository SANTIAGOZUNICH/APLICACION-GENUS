import { NextResponse } from "next/server";
import { DashboardSchemaPendingError, clearDashboardTarget, listDashboardTargets, setDashboardTarget } from "@/lib/dashboard/targets-service";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(err: unknown) {
  if (err instanceof DashboardSchemaPendingError) {
    return NextResponse.json({ error: err.message, code: err.code, schemaPending: true }, { status: 503 });
  }
  return ordersErrorResponse(err);
}

/** Objetivos vigentes (cualquier sector autenticado; son solo un número y un sentido). */
export async function GET(request: Request) {
  try {
    await resolveOrdersActor(request);
    const { targets, schemaPending } = await listDashboardTargets();
    return NextResponse.json({ targets, schemaPending }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Define/actualiza el objetivo de un indicador. SOLO Producción/Dirección (lo valida el servicio). */
export async function PUT(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const body = (await request.json().catch(() => ({}))) as { key?: unknown; value?: unknown; direction?: unknown };
    const target = await setDashboardTarget(
      { email: actor.email, sector: actor.sector },
      { key: String(body.key ?? ""), value: body.value, direction: body.direction }
    );
    return NextResponse.json({ target });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Quita el objetivo (vuelve a «Sin objetivo definido»). SOLO Producción/Dirección. */
export async function DELETE(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const key = new URL(request.url).searchParams.get("key") ?? "";
    await clearDashboardTarget({ email: actor.email, sector: actor.sector }, key);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
