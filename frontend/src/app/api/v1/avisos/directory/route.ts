import { NextResponse } from "next/server";
import { listAvisoDirectory } from "@/lib/avisos/directory";
import { canUseAvisos } from "@/lib/avisos/rbac";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersForbiddenError } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Personas a las que se les puede dirigir un aviso (nombre, sector, si es responsable). Solo para quienes pueden enviar avisos. */
export async function GET(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (!canUseAvisos(actor.sector)) throw new OrdersForbiddenError("Tu sector no puede enviar avisos internos.");
    const users = await listAvisoDirectory();
    return NextResponse.json({ users });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
