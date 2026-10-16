import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { OrdersForbiddenError } from "@/lib/orders/types";
import { readIndexedFile } from "@/lib/formulas/drive-formula-source";
import { canViewWorkFormula } from "@/lib/formulas/work-formula-info";
import { formulasErrorResponse } from "@/lib/formulas/formulas-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ fileId: string }> };

/**
 * Descarga el archivo de una fórmula a través de GENUS OS (con la cuenta de servicio, solo lectura). Requiere sesión
 * de un sector que ve fórmulas y SOLO sirve archivos del índice de la carpeta de fórmulas: no publica nada ni cambia
 * permisos en Drive.
 */
export async function GET(request: Request, ctx: Ctx) {
  try {
    const actor = await resolveOrdersActor(request);
    if (!canViewWorkFormula(actor.sector)) throw new OrdersForbiddenError("Tu sector no ve las fórmulas.");
    const { fileId } = await ctx.params;
    const f = await readIndexedFile(decodeURIComponent(fileId));
    return new NextResponse(new Uint8Array(f.buffer), {
      headers: {
        "Content-Type": f.mimeType || "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return formulasErrorResponse(err);
  }
}
