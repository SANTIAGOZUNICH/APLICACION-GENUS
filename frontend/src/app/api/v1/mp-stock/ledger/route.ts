import { NextResponse } from "next/server";
import { getMpStockLedger } from "@/lib/mp-stock/mp-stock-ledger";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = resolveOrdersActor(request);
    const url = new URL(request.url);
    const codigo = url.searchParams.get("codigo") ?? "";
    if (!codigo.trim()) {
      return NextResponse.json({ error: "codigo requerido" }, { status: 400 });
    }
    const ledger = getMpStockLedger();
    const balance = await ledger.getBalance(codigo);
    const history = await ledger.history(codigo);
    return NextResponse.json({
      balance,
      history,
      actor: { email: actor.email, sector: actor.sector },
    });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const actor = resolveOrdersActor(request);
    const body = (await request.json()) as {
      action?: string;
      codigo?: string;
      quantity?: number;
      reason?: string;
      fecha?: string;
      allowNegative?: boolean;
      descripcion?: string;
      seedQuantity?: number;
    };
    const ledger = getMpStockLedger();
    const a = { email: actor.email, sector: actor.sector };

    if (body.action === "seed") {
      const balance = await ledger.seedSaldoInicialOnce(
        a,
        String(body.codigo ?? ""),
        Number(body.seedQuantity ?? 0),
        body.descripcion
      );
      return NextResponse.json({ balance });
    }
    if (body.action === "ajuste") {
      const balance = await ledger.registerAjuste(a, {
        codigo: String(body.codigo ?? ""),
        quantity: Number(body.quantity ?? 0),
        reason: String(body.reason ?? ""),
        fecha: body.fecha,
        allowNegative: body.allowNegative,
      });
      return NextResponse.json({ balance });
    }
    return NextResponse.json({ error: "action inválida" }, { status: 400 });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
