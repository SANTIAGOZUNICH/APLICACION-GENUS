import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { getProductionPedidosService } from "@/lib/production-pedidos/service";
import type { ProductionPedidoInput } from "@/lib/production-pedidos/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicImportError(err: unknown): string {
  const msg = err instanceof Error ? err.message : "No se pudo importar";
  if (/failed query|sql|syntax|postgres|neon|stack/i.test(msg)) {
    return "No se pudo guardar la importación. Revisá los datos e intentá de nuevo.";
  }
  return msg;
}

export async function POST(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const body = (await request.json()) as {
      rows?: ProductionPedidoInput[];
      confirm?: boolean;
      idempotencyKey?: string;
    };
    if (!body.confirm) {
      return NextResponse.json(
        { error: "Confirmá la importación (confirm: true)." },
        { status: 400 }
      );
    }
    const result = await getProductionPedidosService().importMany(
      { email: actor.email, sector: actor.sector, roleId: actor.roleId },
      body.rows ?? [],
      { idempotencyKey: body.idempotencyKey }
    );
    return NextResponse.json(
      {
        created: result.created,
        inserted: result.inserted,
        rejected: result.rejected,
        duplicateWarnings: result.duplicateWarnings,
        idempotentReplay: result.idempotentReplay,
        skipped: result.rejected,
      },
      { status: 201 }
    );
  } catch (err) {
    const res = ordersErrorResponse(err);
    try {
      const cloned = res.clone();
      const body = (await cloned.json()) as { error?: string };
      if (body.error && /failed query|sql|syntax|postgres|neon/i.test(body.error)) {
        return NextResponse.json(
          { error: publicImportError(err) },
          { status: res.status }
        );
      }
    } catch {
      /* keep original */
    }
    return res;
  }
}
