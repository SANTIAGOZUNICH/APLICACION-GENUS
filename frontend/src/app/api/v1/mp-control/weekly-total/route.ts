import { NextResponse } from "next/server";
import { getWeeklyTotal } from "@/lib/mp-control/weekly-availability-service";
import { weeklyTotalToSheets } from "@/lib/mp-control/weekly-total";
import { canReadMpControl } from "@/lib/mp-control/types";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Control Semanal TOTAL de MP: necesidad pendiente consolidada por materia prima de inventario vs. stock real.
 * `?week=AAAA-MM-DD` (cualquier día de la semana) o `?week=sin-fecha`; `?format=xlsx` descarga el Excel. Solo lectura.
 */
export async function GET(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (!canReadMpControl(actor.sector)) return NextResponse.json({ error: "Sin permiso de lectura MP Control." }, { status: 403 });
    const url = new URL(request.url);
    const week = url.searchParams.get("week") ?? new Date().toISOString().slice(0, 10);
    if (week !== "sin-fecha" && !/^\d{4}-\d{2}-\d{2}$/.test(week)) return NextResponse.json({ error: "week debe ser AAAA-MM-DD o sin-fecha" }, { status: 400 });
    const data = await getWeeklyTotal(week);
    if (url.searchParams.get("format") === "xlsx") {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      const sheets = weeklyTotalToSheets(data);
      const ws = wb.addWorksheet("Control semanal total");
      sheets.total.forEach((r) => ws.addRow(r));
      ws.getRow(1).font = { bold: true };
      ws.getRow(ws.rowCount).font = { bold: true };
      ws.columns.forEach((c) => (c.width = 22));
      const wd = wb.addWorksheet("Detalle por OE");
      sheets.detalle.forEach((r) => wd.addRow(r));
      wd.getRow(1).font = { bold: true };
      wd.columns.forEach((c) => (c.width = 22));
      const buf = Buffer.from(await wb.xlsx.writeBuffer());
      const name = data.mode === "sin-fecha" ? "sin-fecha" : data.weekStart;
      return new NextResponse(buf, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="control-semanal-total-${name}.xlsx"`,
          "Cache-Control": "no-store",
        },
      });
    }
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
