import { withBillingActor } from "@/lib/billing/api";
import { BILLING_REPORTS, buildReportXlsx, type BillingReport } from "@/lib/billing/billing-export";
import { OrdersValidationError } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withBillingActor(request, async (actor) => {
    const p = new URL(request.url).searchParams;
    const report = p.get("report") as BillingReport;
    if (!BILLING_REPORTS.includes(report)) throw new OrdersValidationError("Reporte desconocido.");
    const out = await buildReportXlsx(actor, report, { client: p.get("client") || undefined, from: p.get("from") || undefined, to: p.get("to") || undefined });
    return new Response(new Uint8Array(out.bytes), {
      headers: { "Content-Type": out.mime, "Content-Disposition": `attachment; filename="${out.filename}"`, "Cache-Control": "no-store" },
    });
  });
}
