import { NextResponse } from "next/server";
import { ensureInventoryPersistenceReady, inventoryErrorResponse, resolveInventoryActor } from "@/lib/inventory/http";
import { candidatePedidosDb, linkIngresoPedidoDb, listIngresoDiferenciasDb, unlinkIngresoPedidoDb } from "@/lib/inventory/me-diferencia-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET → { data: { ingresos, previsto? } }; GET ?candidatos=<ingresoId> → pedidos activos del cliente del ingreso. */
export async function GET(request: Request) {
  try {
    const blocked = ensureInventoryPersistenceReady();
    if (blocked) return blocked;
    const actor = await resolveInventoryActor(request);
    const ingresoId = new URL(request.url).searchParams.get("candidatos");
    if (ingresoId) return NextResponse.json({ data: await candidatePedidosDb(actor, ingresoId) });
    return NextResponse.json({ data: await listIngresoDiferenciasDb(actor) });
  } catch (err) {
    return inventoryErrorResponse(err);
  }
}

/** POST { action: "link"|"unlink", ingresoId, pedidoId?, unidadesPorProducto? }. No toca stock ni pedidos. */
export async function POST(request: Request) {
  try {
    const blocked = ensureInventoryPersistenceReady();
    if (blocked) return blocked;
    const actor = await resolveInventoryActor(request);
    const b = (await request.json()) as { action?: string; ingresoId?: string; pedidoId?: string; unidadesPorProducto?: number | null };
    if (!b.ingresoId) return NextResponse.json({ error: "Falta el ingreso." }, { status: 400 });
    if (b.action === "unlink") await unlinkIngresoPedidoDb(actor, b.ingresoId);
    else if (b.action === "link") {
      if (!b.pedidoId) return NextResponse.json({ error: "Falta el pedido." }, { status: 400 });
      await linkIngresoPedidoDb(actor, { ingresoId: b.ingresoId, pedidoId: b.pedidoId, unidadesPorProducto: b.unidadesPorProducto === undefined ? undefined : b.unidadesPorProducto == null ? null : Number(b.unidadesPorProducto) });
    } else return NextResponse.json({ error: "Acción inválida." }, { status: 400 });
    return NextResponse.json({ data: await listIngresoDiferenciasDb(actor) });
  } catch (err) {
    return inventoryErrorResponse(err);
  }
}
