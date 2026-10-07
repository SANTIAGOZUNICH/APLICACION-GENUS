import { NextResponse } from "next/server";
import { inventoryErrorResponse, resolveInventoryActor } from "@/lib/inventory/http";
import { persistInventorySnapshot } from "@/lib/inventory/neon-persist";
import { memoryInventoryRepo } from "@/lib/inventory/get-inventory-service";
import { readyInventoryService } from "@/lib/inventory/ready-service";
import { getMeRemitoIngresoService } from "@/lib/inventory/remito-ai/get-remito-service";
import { REMITO_MAX_FILES } from "@/lib/inventory/remito-ai/remito-ingreso-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Interpreta fotos/PDF de un remito y devuelve un PREVIEW. No crea ingresos. */
export async function POST(request: Request) {
  try {
    const ready = await readyInventoryService();
    if ("blocked" in ready) return ready.blocked;
    const actor = await resolveInventoryActor(request);
    const form = await request.formData();
    const entries = form.getAll("files").filter((f): f is File => typeof f !== "string");
    if (entries.length > REMITO_MAX_FILES) {
      return NextResponse.json(
        { error: `Máximo ${REMITO_MAX_FILES} páginas por remito.`, code: "VALIDATION" },
        { status: 400 }
      );
    }
    const files = await Promise.all(
      entries.map(async (f) => ({
        bytes: Buffer.from(await f.arrayBuffer()),
        contentType: f.type,
        name: f.name,
      }))
    );
    const preview = await getMeRemitoIngresoService().analyze(actor, files);
    await persistInventorySnapshot(memoryInventoryRepo);
    return NextResponse.json({ data: preview });
  } catch (err) {
    return inventoryErrorResponse(err);
  }
}
