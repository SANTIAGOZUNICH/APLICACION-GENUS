import { NextResponse } from "next/server";
import { withBillingActor, noStore } from "@/lib/billing/api";
import { listInvoices, registerInvoice, type RegisterInvoiceInput } from "@/lib/billing/billing-service";
import { OrdersValidationError } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withBillingActor(request, async (actor) => {
    const p = new URL(request.url).searchParams;
    const invoices = await listInvoices(actor, { client: p.get("client") || undefined, q: p.get("q") || undefined });
    return NextResponse.json({ invoices }, { headers: noStore });
  });
}

export async function POST(request: Request) {
  return withBillingActor(request, async (actor) => {
    let body: Partial<RegisterInvoiceInput>;
    try {
      body = (await request.json()) as Partial<RegisterInvoiceInput>;
    } catch {
      throw new OrdersValidationError("Solicitud inválida.");
    }
    const result = await registerInvoice(actor, {
      invoiceNumber: String(body.invoiceNumber ?? ""),
      invoiceDate: String(body.invoiceDate ?? ""),
      observations: body.observations ?? null,
      lines: Array.isArray(body.lines) ? body.lines.map((l) => ({ deliveryLineId: String(l?.deliveryLineId ?? ""), quantity: Number(l?.quantity) })) : [],
      idempotencyKey: String(body.idempotencyKey ?? ""),
    });
    return NextResponse.json(result, { status: result.replayed ? 200 : 201, headers: noStore });
  });
}
