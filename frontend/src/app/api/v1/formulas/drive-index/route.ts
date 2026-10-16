import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { OrdersForbiddenError } from "@/lib/orders/types";
import { getIndexStatus, reviewReport, syncFormulaIndex } from "@/lib/formulas/drive-formula-source";
import { formulasErrorResponse } from "@/lib/formulas/formulas-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED = ["PRODUCCION", "DIRECCION", "CALIDAD"];

/** Estado del índice de la carpeta nueva de fórmulas + lo que conviene revisar (repetidos, otro cliente, sueltos). */
export async function GET(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (!ALLOWED.includes(actor.sector)) throw new OrdersForbiddenError("Solo Producción, Dirección y Calidad ven el índice de fórmulas.");
    const status = await getIndexStatus();
    const review = status.validated ? await reviewReport() : null;
    return NextResponse.json({ status, review });
  } catch (err) {
    return formulasErrorResponse(err);
  }
}

/** «Actualizar índice»: vuelve a leer la carpeta de Drive (solo lectura) y agrega/actualiza/marca lo que cambió. */
export async function POST(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (!ALLOWED.includes(actor.sector)) throw new OrdersForbiddenError("Solo Producción, Dirección y Calidad actualizan el índice de fórmulas.");
    const result = await syncFormulaIndex({ trigger: "manual", actorEmail: actor.email });
    return NextResponse.json({ result, status: await getIndexStatus() }, { status: result.ok ? 200 : result.running ? 409 : 502 });
  } catch (err) {
    return formulasErrorResponse(err);
  }
}
