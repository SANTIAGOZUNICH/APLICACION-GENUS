import { NextResponse } from "next/server";
import { inventoryErrorResponse, resolveInventoryActor } from "@/lib/inventory/http";
import { persistInventorySnapshot } from "@/lib/inventory/neon-persist";
import { memoryInventoryRepo } from "@/lib/inventory/get-inventory-service";
import { readyInventoryService } from "@/lib/inventory/ready-service";
import { getMeRemitoIngresoService } from "@/lib/inventory/remito-ai/get-remito-service";
import {
  RemitoDuplicateError,
  type ConfirmInput,
} from "@/lib/inventory/remito-ai/remito-ingreso-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Confirmación humana: recién acá se crean los ingresos (flujo canónico + ledger). */
export async function POST(request: Request) {
  try {
    const ready = await readyInventoryService();
    if ("blocked" in ready) return ready.blocked;
    const actor = await resolveInventoryActor(request);
    const body = (await request.json()) as ConfirmInput;
    if (!body || typeof body.docId !== "string" || !Array.isArray(body.lines)) {
      return NextResponse.json({ error: "Solicitud inválida.", code: "VALIDATION" }, { status: 400 });
    }
    const result = getMeRemitoIngresoService().confirm(actor, body);
    await persistInventorySnapshot(memoryInventoryRepo);
    return NextResponse.json({ data: result });
  } catch (err) {
    if (err instanceof RemitoDuplicateError) {
      return NextResponse.json(
        { error: err.message, code: err.code, duplicate: err.duplicate },
        { status: err.status }
      );
    }
    return inventoryErrorResponse(err);
  }
}
