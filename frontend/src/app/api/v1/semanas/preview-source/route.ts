import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";
import { getPreviewStatus, isPreviewSourceAllowed, resetPreviewWorkbook, savePreviewWorkbook, validateSemanasWorkbook, PREVIEW_MAX_BYTES } from "@/lib/semanas-sheet/preview-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function guard(request: Request) {
  // Production: la ruta no existe (404), sin importar flags.
  if (!isPreviewSourceAllowed()) return NextResponse.json({ error: "No disponible." }, { status: 404 });
  const actor = await resolveOrdersActor(request);
  if (actor.sector !== "PRODUCCION") throw new OrdersForbiddenError("Semanas está habilitado para Producción.");
  return null;
}

/** Estado de la copia XLSX que usa Preview (origen, hash, semanas por pestaña). */
export async function GET(request: Request) {
  try {
    const blocked = await guard(request);
    if (blocked) return blocked;
    return NextResponse.json({ status: await getPreviewStatus() });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}

/** Carga un .xlsx de SEMANAS 2026 como fuente de Preview (solo lectura; nunca toca Google ni la base). */
export async function POST(request: Request) {
  try {
    const blocked = await guard(request);
    if (blocked) return blocked;
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > PREVIEW_MAX_BYTES + 64 * 1024) throw new OrdersValidationError(`El archivo supera ${PREVIEW_MAX_BYTES / 1024 / 1024} MB.`);
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new OrdersValidationError("Adjuntá un archivo .xlsx en el campo «file».");
    if (!/\.xlsx$/i.test(file.name)) throw new OrdersValidationError("El archivo debe ser .xlsx.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    await validateSemanasWorkbook(bytes);
    const { persisted } = await savePreviewWorkbook(bytes);
    return NextResponse.json({ status: await getPreviewStatus(), persisted });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}

/** Vuelve a la copia incluida en el deploy. */
export async function DELETE(request: Request) {
  try {
    const blocked = await guard(request);
    if (blocked) return blocked;
    await resetPreviewWorkbook();
    return NextResponse.json({ status: await getPreviewStatus() });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
