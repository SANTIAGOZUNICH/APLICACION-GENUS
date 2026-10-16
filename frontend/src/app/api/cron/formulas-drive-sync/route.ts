import { NextResponse } from "next/server";
import { syncFormulaIndex } from "@/lib/formulas/drive-formula-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Actualización automática del índice de fórmulas (carpeta nueva de Drive), cada hora. Mismo patrón que
 * /api/cron/asignacion-lotes-sync: Vercel firma con Authorization: Bearer <CRON_SECRET>. Solo lectura de Drive.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "CRON_SECRET no configurado." }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const result = await syncFormulaIndex({ trigger: "cron", actorEmail: "cron" });
  return NextResponse.json({ ok: result.ok, result });
}
