import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { diagnoseDriveFormulasAccess } from "@/lib/formulas/drive-formulas-diagnose";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = ["CALIDAD", "PRODUCCION", "MATERIA_PRIMA", "DIRECCION"];

/**
 * Diagnóstico READ-ONLY de acceso Drive para fórmulas.
 * No lista nombres de archivos ni contenido de fórmulas.
 */
export async function GET(request: Request) {
  try {
    const actor = resolveOrdersActor(request);
    if (!ALLOWED.includes(actor.sector)) {
      return NextResponse.json({ error: "Sector no autorizado" }, { status: 403 });
    }
    const report = await diagnoseDriveFormulasAccess();
    return NextResponse.json({
      ...report,
      // Nunca devolver private key ni folder id crudo en claro si preferimos ocultarlo;
      // folderEnvKey sí (nombre de variable).
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error";
    // No filtrar secretos: el diagnose no los incluye.
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
