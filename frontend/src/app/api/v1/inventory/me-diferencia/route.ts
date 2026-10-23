import { NextResponse } from "next/server";
import { ensureInventoryPersistenceReady, inventoryErrorResponse, resolveInventoryActor } from "@/lib/inventory/http";
import { candidatePedidosDb, listMeDiferenciasDb, removeMePedidoLinkDb, upsertMePedidoLinkDb } from "@/lib/inventory/me-diferencia-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET → { data: { [materialId]: DIFERENCIA } }; GET ?candidatos=<materialId> → pedidos activos del cliente del material. */
export async function GET(request: Request) {
  try {
    const blocked = ensureInventoryPersistenceReady();
    if (blocked) return blocked;
    const actor = await resolveInventoryActor(request);
    const materialId = new URL(request.url).searchParams.get("candidatos");
    if (materialId) return NextResponse.json({ data: await candidatePedidosDb(actor, materialId) });
    return NextResponse.json({ data: await listMeDiferenciasDb(actor) });
  } catch (err) {
    return inventoryErrorResponse(err);
  }
}

/** POST { action: "link"|"unlink", materialId, pedidoId, unidadesPorProducto? }. No toca stock ni pedidos. */
export async function POST(request: Request) {
  try {
    const blocked = ensureInventoryPersistenceReady();
    if (blocked) return blocked;
    const actor = await resolveInventoryActor(request);
    const b = (await request.json()) as { action?: string; materialId?: string; pedidoId?: string; unidadesPorProducto?: number | null };
    if (!b.materialId || !b.pedidoId) return NextResponse.json({ error: "Faltan material o pedido." }, { status: 400 });
    if (b.action === "unlink") await removeMePedidoLinkDb(actor, b.materialId, b.pedidoId);
    else if (b.action === "link") await upsertMePedidoLinkDb(actor, { materialId: b.materialId, pedidoId: b.pedidoId, unidadesPorProducto: b.unidadesPorProducto == null ? null : Number(b.unidadesPorProducto) });
    else return NextResponse.json({ error: "Acción inválida." }, { status: 400 });
    return NextResponse.json({ data: await listMeDiferenciasDb(actor) });
  } catch (err) {
    return inventoryErrorResponse(err);
  }
}
