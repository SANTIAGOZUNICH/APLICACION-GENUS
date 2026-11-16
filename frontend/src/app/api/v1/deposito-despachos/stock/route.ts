import { NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db/client";
import { applyHistoricoDespachos, assignDespachoMaterial, despachoStockReport, listMaterialesParaEntrega } from "@/lib/despachos/despacho-me-stock";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersValidationError } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const toActor = (a: Awaited<ReturnType<typeof resolveOrdersActor>>) => ({ email: a.email, sector: a.sector, displayName: a.displayName });

/** Informe de diferencias entre Entregas Producción y stock ME (solo lectura) + materiales para elegir. */
export async function GET(request: Request) {
  try {
    const actor = toActor(await resolveOrdersActor(request));
    if (!isDatabaseConfigured()) return NextResponse.json({ rows: [], resumen: { vinculadas: 0, historicas: 0, sinMaterial: 0, pendientes: 0, unidadesHistoricas: 0 }, materiales: [], persistenceReady: false });
    const report = await despachoStockReport(actor);
    return NextResponse.json({ ...report, materiales: await listMaterialesParaEntrega(actor), persistenceReady: true });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}

/** `{ action: "assign", id, codigo }` elige el material de una entrega; `{ action: "apply", ids? }` aplica el descuento a entregas históricas. */
export async function POST(request: Request) {
  try {
    const actor = toActor(await resolveOrdersActor(request));
    const body = (await request.json().catch(() => ({}))) as { action?: string; id?: string; codigo?: string; ids?: unknown };
    if (!isDatabaseConfigured()) throw new OrdersValidationError("Requiere la base de datos.");
    if (body.action === "assign") {
      if (!body.id || !body.codigo) throw new OrdersValidationError("id y codigo son obligatorios.");
      return NextResponse.json({ result: await assignDespachoMaterial(actor, body.id, body.codigo) });
    }
    if (body.action === "apply") {
      const ids = Array.isArray(body.ids) ? body.ids.filter((v): v is string => typeof v === "string") : undefined;
      return NextResponse.json(await applyHistoricoDespachos(actor, ids));
    }
    throw new OrdersValidationError("Acción no válida.");
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
