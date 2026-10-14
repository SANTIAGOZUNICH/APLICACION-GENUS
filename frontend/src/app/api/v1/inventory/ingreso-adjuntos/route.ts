import { NextResponse } from "next/server";
import { inventoryErrorResponse, resolveInventoryActor } from "@/lib/inventory/http";
import { getIngresoAdjuntosService } from "@/lib/inventory/ingreso-adjuntos-service";
import { parseAdjuntoModule } from "@/lib/inventory/ingreso-adjuntos-rules";
import { InventoryValidationError } from "@/lib/inventory/inventory-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Fotos de remito de un ingreso: ?module=MP|ME&ingresoId=… — o ?module=…&counts=1 (cantidad por ingreso). */
export async function GET(request: Request) {
  try {
    const actor = await resolveInventoryActor(request);
    const url = new URL(request.url);
    const mod = parseAdjuntoModule(url.searchParams.get("module"));
    if (!mod) throw new InventoryValidationError("Módulo inválido (MP o ME).");
    if (url.searchParams.get("counts") === "1") {
      return NextResponse.json({ counts: await getIngresoAdjuntosService().counts(actor, mod) });
    }
    const items = await getIngresoAdjuntosService().list(actor, mod, url.searchParams.get("ingresoId") ?? "");
    return NextResponse.json({ items });
  } catch (err) {
    return inventoryErrorResponse(err);
  }
}

/** Adjunta UNA foto (multipart: module, ingresoId, file). No toca cantidades ni stock. */
export async function POST(request: Request) {
  try {
    const actor = await resolveInventoryActor(request);
    const form = await request.formData().catch(() => null);
    if (!form) throw new InventoryValidationError("Pedido inválido: falta el archivo.");
    const mod = parseAdjuntoModule(form.get("module"));
    if (!mod) throw new InventoryValidationError("Módulo inválido (MP o ME).");
    const file = form.get("file");
    if (!(file instanceof File)) throw new InventoryValidationError("Falta el archivo.");
    const item = await getIngresoAdjuntosService().upload(actor, {
      module: mod,
      ingresoId: String(form.get("ingresoId") ?? ""),
      fileName: file.name || "remito.jpg",
      contentType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    return inventoryErrorResponse(err);
  }
}
