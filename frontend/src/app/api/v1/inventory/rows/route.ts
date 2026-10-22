import { NextResponse } from "next/server";
import { ensureInventoryPersistenceReady, inventoryErrorResponse, resolveInventoryActor } from "@/lib/inventory/http";
import { insertBlankSheetRow, isSheetRowResource, moveSheetRow } from "@/lib/inventory/sheet-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Filas de la planilla como en Excel (orden manual persistente).
 *  - { action: "move", resource, id, beforeId|null }  → mueve la fila antes de `beforeId` (null = al final).
 *  - { action: "insert", resource, beforeId|null }    → crea una fila en blanco antes de `beforeId` (null = al final).
 * Sin motivos ni confirmaciones; queda auditado (usuario, fecha, posición anterior/nueva).
 */
export async function POST(request: Request) {
  try {
    const blocked = ensureInventoryPersistenceReady();
    if (blocked) return blocked;
    const actor = await resolveInventoryActor(request);
    const body = (await request.json()) as { action?: string; resource?: string; id?: string; beforeId?: string | null };
    if (!isSheetRowResource(body.resource)) return NextResponse.json({ error: "Planilla inválida." }, { status: 400 });
    const beforeId = body.beforeId ?? null;
    if (body.action === "move") {
      if (!body.id) return NextResponse.json({ error: "Falta la fila." }, { status: 400 });
      return NextResponse.json({ ok: true, ...(await moveSheetRow(actor, body.resource, body.id, beforeId)) });
    }
    if (body.action === "insert") {
      return NextResponse.json({ ok: true, ...(await insertBlankSheetRow(actor, body.resource, beforeId)) });
    }
    return NextResponse.json({ error: "Acción inválida." }, { status: 400 });
  } catch (err) {
    return inventoryErrorResponse(err);
  }
}
