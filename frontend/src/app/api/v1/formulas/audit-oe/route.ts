import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { getOrdersService } from "@/lib/orders/get-orders-service";
import { ensureOrdersPersistenceReady, ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLS = ["cliente", "producto", "oe", "estadoOe", "materiaPrima", "codigo", "pctOriginal", "pctMostrado", "diferencia", "revision"] as const;
const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Auditoría de fórmulas en OE (SOLO LECTURA, Producción/Dirección): diferencias contra la versión aprobada vinculada, OE por revisar y
 * versiones del banco con % reescalados. `?format=csv` descarga el reporte; `?pending=1` limita a las pendientes de verificación.
 */
export async function GET(request: Request) {
  const blocked = ensureOrdersPersistenceReady();
  if (blocked) return blocked;
  try {
    const actor = await resolveOrdersActor(request);
    const url = new URL(request.url);
    const report = await getOrdersService().auditFormulas(actor, { pendingOnly: url.searchParams.get("pending") === "1" });
    if (url.searchParams.get("format") === "csv") {
      const csv = [COLS.join(","), ...report.rows.map((r) => COLS.map((c) => csvCell(r[c])).join(","))].join("\n");
      return new NextResponse("﻿" + csv, {
        headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="auditoria-formulas-oe.csv"' },
      });
    }
    return NextResponse.json(report);
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
