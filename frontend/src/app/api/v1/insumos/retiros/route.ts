import { NextResponse } from "next/server";
import { createRetiro, listRetiros } from "@/lib/insumos/insumos-service";
import { readJson, resolveInsumoActor } from "@/lib/insumos/insumos-http";
import type { CreateRetiroInput } from "@/lib/insumos/types";
import { ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Historial con filtros (desde, hasta, sector, responsableId, insumoId). Solo Administración y Dirección. */
export async function GET(request: Request) {
  try {
    const actor = await resolveInsumoActor(request);
    const p = new URL(request.url).searchParams;
    const res = await listRetiros(actor, {
      from: p.get("from") ?? undefined,
      to: p.get("to") ?? undefined,
      sector: p.get("sector") ?? undefined,
      responsableId: p.get("responsableId") ?? undefined,
      insumoId: p.get("insumoId") ?? undefined,
    });
    return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}

/** Registra un retiro (sector = el de la sesión). `clientRequestId` hace seguro el reintento / doble toque. */
export async function POST(request: Request) {
  try {
    const actor = await resolveInsumoActor(request);
    const body = await readJson<Partial<CreateRetiroInput>>(request);
    const r = await createRetiro(actor, {
      clientRequestId: body.clientRequestId as string,
      responsableId: body.responsableId as string,
      lines: body.lines as CreateRetiroInput["lines"],
    });
    return NextResponse.json(r, { status: r.created ? 201 : 200 });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
