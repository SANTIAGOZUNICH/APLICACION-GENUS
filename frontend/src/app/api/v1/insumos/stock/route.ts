import { NextResponse } from "next/server";
import { correctIngreso, getStockSummary, listStockAudit, listStockMovements, manualAdjust, registerIngreso, setInitialStock, updateStockConfig, voidMovement } from "@/lib/insumos/stock-service";
import { readJson, resolveInsumoActor } from "@/lib/insumos/insumos-http";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersValidationError } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

/** Solo Administración y Dirección. `?view=summary` (por defecto) · `movements` (filtros insumoId, kind, from, to, includeVoided) · `audit` (insumoId, targetId). */
export async function GET(request: Request) {
  try {
    const actor = await resolveInsumoActor(request);
    const p = new URL(request.url).searchParams;
    const view = p.get("view") ?? "summary";
    if (view === "movements") {
      const res = await listStockMovements(actor, {
        insumoId: p.get("insumoId") ?? undefined,
        kind: p.get("kind") ?? undefined,
        from: p.get("from") ?? undefined,
        to: p.get("to") ?? undefined,
        includeVoided: p.get("includeVoided") === "0" ? false : true,
      });
      return NextResponse.json(res, { headers: NO_STORE });
    }
    if (view === "audit") return NextResponse.json({ events: await listStockAudit(actor, { insumoId: p.get("insumoId") ?? undefined, targetId: p.get("targetId") ?? undefined }) }, { headers: NO_STORE });
    return NextResponse.json({ summary: await getStockSummary(actor) }, { headers: NO_STORE });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}

/** `{ action: "inicial" | "ingreso" | "ajuste" | "config" | "corregir_ingreso" | "anular", ... }`. Solo Administración y Dirección. */
export async function POST(request: Request) {
  try {
    const actor = await resolveInsumoActor(request);
    const b = await readJson<Record<string, unknown>>(request);
    switch (b.action) {
      case "inicial":
        return NextResponse.json({ row: await setInitialStock(actor, { insumoId: b.insumoId, quantity: b.quantity, fecha: b.fecha, note: b.note, key: b.key }) });
      case "ingreso": {
        const r = await registerIngreso(actor, { insumoId: b.insumoId, cantidad: b.cantidad, fecha: b.fecha, observaciones: b.observaciones, key: b.key });
        return NextResponse.json(r, { status: r.replayed ? 200 : 201 });
      }
      case "ajuste":
        return NextResponse.json({ row: await manualAdjust(actor, { insumoId: b.insumoId, delta: b.delta, reason: b.reason, fecha: b.fecha, key: b.key }) });
      case "config":
        return NextResponse.json({ row: await updateStockConfig(actor, String(b.insumoId ?? ""), { minStock: b.minStock, unit: b.unit }) });
      case "corregir_ingreso":
        return NextResponse.json({ row: await correctIngreso(actor, String(b.id ?? ""), { cantidad: b.cantidad, fecha: b.fecha, observaciones: b.observaciones, reason: b.reason }) });
      case "anular":
        return NextResponse.json({ row: await voidMovement(actor, String(b.id ?? ""), b.reason) });
      default:
        throw new OrdersValidationError("Acción inválida.");
    }
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
