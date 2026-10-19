import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { OrdersForbiddenError } from "@/lib/orders/types";
import { getIndexStatus, loadClientFolderMatch, searchDriveLiveByName, lookupFormulaForWork, retryPendingOeFormulas, reviewReport, syncFormulaIndex } from "@/lib/formulas/drive-formula-source";
import { clientKey } from "@/lib/formulas/drive-match-rules";
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
    const url = new URL(request.url);
    const client = url.searchParams.get("client")?.trim();
    const product = url.searchParams.get("product")?.trim();
    const find = url.searchParams.get("find")?.trim();
    if (find) return NextResponse.json({ status, find, hits: await searchDriveLiveByName(find) });
    // Diagnóstico de una búsqueda (la misma que usa la OE automática): qué carpeta de cliente y qué archivos encuentra.
    if (client && product && status.validated) {
      const lookup = await lookupFormulaForWork(client, product);
      return NextResponse.json({ status, diagnose: { client, clientKey: clientKey(client), folders: await loadClientFolderMatch(client), lookup } });
    }
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
    // OE que quedaron con la fórmula pendiente: se vuelven a buscar con el índice actualizado (sin reemplazar nada).
    const pending = result.ok ? await retryPendingOeFormulas(actor).catch(() => null) : null;
    return NextResponse.json({ result, pending, status: await getIndexStatus() }, { status: result.ok ? 200 : result.running ? 409 : 502 });
  } catch (err) {
    return formulasErrorResponse(err);
  }
}
