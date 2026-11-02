import { NextResponse } from "next/server";
import { resolvePlanningActor } from "@/lib/planning/actor";
import { listCodificadoReceipts } from "@/lib/planning/codificado-transfer-service";
import { ensureNativePlanningReady, planningErrorResponse } from "@/lib/planning/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bandeja de Codificado: entregas parciales recibidas desde Envasado (Codificado, Producción y Dirección). Solo lectura. */
export async function GET(request: Request) {
  const blocked = ensureNativePlanningReady();
  if (blocked) return blocked;
  try {
    const actor = await resolvePlanningActor(request);
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 100);
    return NextResponse.json({ ok: true, items: await listCodificadoReceipts(actor, { limit: Number.isFinite(limit) ? limit : 100 }) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return planningErrorResponse(err);
  }
}
