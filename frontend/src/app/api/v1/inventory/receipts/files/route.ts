import { NextResponse } from "next/server";
import { inventoryErrorResponse, resolveInventoryActor } from "@/lib/inventory/http";
import { InventoryValidationError } from "@/lib/inventory/inventory-service";
import { parseReceiptModule } from "@/lib/inventory/receipt-rules";
import { getReceiptService, ReceiptError } from "@/lib/inventory/receipt-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Adjunta UN archivo (foto o PDF) al borrador de una recepción: multipart `module`, `receiptId`, `file`. No toca stock. */
export async function POST(request: Request) {
  try {
    const actor = await resolveInventoryActor(request);
    const form = await request.formData().catch(() => null);
    if (!form) throw new InventoryValidationError("Pedido inválido: falta el archivo.");
    const mod = parseReceiptModule(form.get("module"));
    if (!mod) throw new InventoryValidationError("Módulo inválido (MP o ME).");
    const file = form.get("file");
    if (!(file instanceof File)) throw new InventoryValidationError("Falta el archivo.");
    const item = await getReceiptService().addFile(actor, String(form.get("receiptId") ?? ""), mod, { fileName: file.name || "remito.jpg", bytes: new Uint8Array(await file.arrayBuffer()) });
    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    if (err instanceof ReceiptError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    return inventoryErrorResponse(err);
  }
}
