import { NextResponse } from "next/server";
import { inventoryErrorResponse, resolveInventoryActor } from "@/lib/inventory/http";
import { readyInventoryService } from "@/lib/inventory/ready-service";
import { getMeRemitoIngresoService } from "@/lib/inventory/remito-ai/get-remito-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** [VER REMITO]: devuelve la foto/PDF original (storage privado) a quien puede leer ingresos ME. */
export async function GET(request: Request) {
  try {
    const ready = await readyInventoryService();
    if ("blocked" in ready) return ready.blocked;
    const actor = await resolveInventoryActor(request);
    const { searchParams } = new URL(request.url);
    const docId = searchParams.get("docId") ?? "";
    const index = Math.max(0, Number(searchParams.get("i") ?? "0") || 0);
    const file = await getMeRemitoIngresoService().getDocumentFile(actor, docId, index);
    return new NextResponse(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `inline; filename="${file.name.replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
        "X-Remito-Pages": String(file.pages),
      },
    });
  } catch (err) {
    return inventoryErrorResponse(err);
  }
}
