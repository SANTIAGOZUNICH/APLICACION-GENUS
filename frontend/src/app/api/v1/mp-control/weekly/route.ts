import { NextResponse } from "next/server";
import { getWeeklyAvailability, loadStockLots } from "@/lib/mp-control/weekly-availability-service";
import { lotUsability, normText, round3, toNumber } from "@/lib/mp-control/availability";
import { canReadMpControl } from "@/lib/mp-control/types";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Disponibilidad real de MP de la semana (stock del inventario vs. necesidad consolidada). Solo lectura, sin caché. */
export async function GET(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (!canReadMpControl(actor.sector)) return NextResponse.json({ error: "Sin permiso de lectura MP Control." }, { status: 403 });
    const week = new URL(request.url).searchParams.get("week") ?? new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) return NextResponse.json({ error: "week debe ser AAAA-MM-DD" }, { status: 400 });
    // Diagnóstico de solo lectura: ?inspect=glicerina lista las filas del Stock MP que contienen ese texto y sus totales.
    const inspect = new URL(request.url).searchParams.get("inspect")?.trim();
    if (inspect) {
      const { lots, source } = await loadStockLots();
      const today = new Date().toISOString().slice(0, 10);
      const term = normText(inspect);
      const rows = lots
        .filter((l) => normText(l.descripcion).includes(term))
        .map((l) => ({ ...lotUsability(l, today), id: l.id, descripcion: l.descripcion, codigo: l.codigo, proveedor: l.proveedor, cliente: l.cliente, lote: l.lote, kgLote: toNumber(l.cantidadKg), archivado: Boolean(l.archived), vencimiento: l.vencimiento, estado: l.estadoStockManual || l.estadoStock }));
      const activas = rows.filter((r) => !r.archivado);
      return NextResponse.json({
        inspect: term,
        source,
        filasLeidasDelStock: lots.length,
        coinciden: rows.length,
        sinCodigo: rows.filter((r) => !r.codigo.trim()).length,
        totalFisico: round3(activas.reduce((s, r) => s + Math.max(0, r.kgLote ?? 0), 0)),
        totalUtilizable: round3(activas.reduce((s, r) => s + (r.usable ? (r.kgLote ?? 0) : 0), 0)),
        rows,
      }, { headers: { "Cache-Control": "no-store" } });
    }
    const data = await getWeeklyAvailability(week);
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
