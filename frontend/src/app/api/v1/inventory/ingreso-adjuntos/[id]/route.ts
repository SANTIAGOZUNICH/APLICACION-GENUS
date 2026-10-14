import { NextResponse } from "next/server";
import { inventoryErrorResponse, resolveInventoryActor } from "@/lib/inventory/http";
import { getIngresoAdjuntosService } from "@/lib/inventory/ingreso-adjuntos-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Devuelve la foto (proxy autenticado: la URL del Blob privado nunca llega al navegador). */
export async function GET(request: Request, ctx: Ctx) {
  try {
    const actor = await resolveInventoryActor(request);
    const { id } = await ctx.params;
    const { adjunto, bytes } = await getIngresoAdjuntosService().download(actor, id);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": adjunto.contentType,
        "Content-Length": String(bytes.length),
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(adjunto.fileName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    return inventoryErrorResponse(err);
  }
}

/** Quita una foto del ingreso (soft-delete: el archivo se conserva). */
export async function DELETE(request: Request, ctx: Ctx) {
  try {
    const actor = await resolveInventoryActor(request);
    const { id } = await ctx.params;
    await getIngresoAdjuntosService().remove(actor, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return inventoryErrorResponse(err);
  }
}
