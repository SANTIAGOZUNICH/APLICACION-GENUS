import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";
import { AuthUnauthorizedError } from "@/lib/auth/types";
import { isSuperadminEmail } from "@/lib/auth/superadmin";
import { canAccessManagementReport } from "@/lib/reports/report-rbac";
import { fetchReportDataset } from "@/lib/reports/data-fetch";
import { buildManagementReport } from "@/lib/reports/analytics";
import { buildManagementReportWorkbook, buildReportFileName } from "@/lib/reports/xlsx-generator";
import type { ReportFilters } from "@/lib/reports/types";
import type { SectorId } from "@/types/operational/sector";
import { OPERATIONAL_SECTOR_IDS } from "@/types/operational/sector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isSectorId(v: string): v is SectorId {
  return (OPERATIONAL_SECTOR_IDS as readonly string[]).includes(v);
}

export async function GET(request: Request) {
  let actor;
  try {
    actor = await resolveOrdersActor(request);
  } catch (err) {
    if (err instanceof AuthUnauthorizedError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 401 });
    }
    if (err instanceof OrdersForbiddenError || err instanceof OrdersValidationError) {
      return NextResponse.json(
        { error: err.message, code: "ACTOR_FORBIDDEN" },
        { status: err instanceof OrdersForbiddenError ? 403 : 400 }
      );
    }
    throw err;
  }

  // Server-side, no solo ocultar el botón en el cliente — ver report-rbac.ts.
  if (!canAccessManagementReport(actor.sector, isSuperadminEmail(actor.email))) {
    return NextResponse.json(
      { error: "No tenés permiso para exportar el reporte gerencial.", code: "REPORT_FORBIDDEN" },
      { status: 403 }
    );
  }

  const url = new URL(request.url);
  const from = url.searchParams.get("from")?.trim() ?? "";
  const to = url.searchParams.get("to")?.trim() ?? "";
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    return NextResponse.json(
      { error: "Rango de fechas inválido (from/to requeridos, YYYY-MM-DD).", code: "INVALID_RANGE" },
      { status: 400 }
    );
  }
  if (to < from) {
    return NextResponse.json(
      { error: "\"Hasta\" no puede ser anterior a \"Desde\".", code: "INVALID_RANGE" },
      { status: 400 }
    );
  }

  const sectorParam = url.searchParams.get("sector")?.trim();
  if (sectorParam && !isSectorId(sectorParam)) {
    return NextResponse.json(
      { error: "Sector inválido.", code: "INVALID_SECTOR" },
      { status: 400 }
    );
  }

  const filters: ReportFilters = {
    from,
    to,
    client: url.searchParams.get("client")?.trim() || undefined,
    product: url.searchParams.get("product")?.trim() || undefined,
    sector: sectorParam as SectorId | undefined,
    employee: url.searchParams.get("employee")?.trim() || undefined,
  };

  try {
    const db = getDb();
    const dataset = await fetchReportDataset(db, filters);
    const report = buildManagementReport(dataset, filters);
    const workbook = buildManagementReportWorkbook(report);
    const buffer = await workbook.xlsx.writeBuffer();
    const fileName = buildReportFileName(from, to);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "No se pudo generar el reporte.",
        code: "REPORT_FAILED",
      },
      { status: 500 }
    );
  }
}
