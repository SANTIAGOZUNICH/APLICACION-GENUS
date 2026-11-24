import { NextResponse } from "next/server";
import { isMissingSchemaError } from "@/lib/db/missing-schema";
import { resolvePlanningActor } from "@/lib/planning/actor";
import { ensureNativePlanningReady, planningErrorResponse } from "@/lib/planning/http";
import { getObservationFeed, getObservationSummary, getWorkObservations, markObservationsSeen } from "@/lib/observations/production-observations-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function fail(err: unknown) {
  if (isMissingSchemaError(err)) {
    return NextResponse.json({ error: "Las observaciones todavía no están disponibles (migración pendiente).", code: "OBSERVATIONS_SCHEMA_PENDING" }, { status: 503 });
  }
  return planningErrorResponse(err);
}

/**
 * GET /api/v1/production-observations
 *  - `?workItemId=…`            historial de la cadena del trabajo (etapas anteriores y posteriores), cronológico;
 *  - `?workItemIds=a,b,c`       cantidad (y nuevas) por trabajo, para «Observaciones (N)» en las tarjetas;
 *  - sin ids                    listado de las observaciones recientes (`sector`, `q`, `onlyNew=1`, `from`, `to`, `limit`, `offset`).
 * Producción y Dirección ven todo; Elaboración, Envasado y Codificado solo las de sus trabajos/cadena. Se valida acá, en el servidor.
 */
export async function GET(request: Request) {
  const blocked = ensureNativePlanningReady();
  if (blocked) return blocked;
  try {
    const actor = await resolvePlanningActor(request);
    const sp = new URL(request.url).searchParams;
    const workItemId = sp.get("workItemId");
    if (workItemId) return NextResponse.json({ ok: true, ...(await getWorkObservations(actor, workItemId)) }, { headers: NO_STORE });
    const many = sp.get("workItemIds");
    if (many) {
      const summary = await getObservationSummary(actor, many.split(",").map((s) => s.trim()).filter(Boolean));
      return NextResponse.json({ ok: true, summary }, { headers: NO_STORE });
    }
    const feed = await getObservationFeed(actor, {
      sector: sp.get("sector"),
      q: sp.get("q"),
      onlyNew: sp.get("onlyNew") === "1",
      from: sp.get("from"),
      to: sp.get("to"),
      limit: Number(sp.get("limit") ?? 100),
      offset: Number(sp.get("offset") ?? 0),
    });
    return NextResponse.json({ ok: true, ...feed }, { headers: NO_STORE });
  } catch (err) {
    return fail(err);
  }
}

/** POST /api/v1/production-observations — { action: "seen", scope: "FEED" | <id del trabajo> }. Solo registra cuándo las vio el usuario de la sesión. */
export async function POST(request: Request) {
  const blocked = ensureNativePlanningReady();
  if (blocked) return blocked;
  try {
    const actor = await resolvePlanningActor(request);
    const body = (await request.json().catch(() => null)) as { action?: unknown; scope?: unknown } | null;
    if (body?.action !== "seen") return NextResponse.json({ error: "Acción inválida.", code: "INVALID_ACTION" }, { status: 400 });
    const res = await markObservationsSeen(actor, typeof body.scope === "string" ? body.scope : "");
    return NextResponse.json({ ok: true, ...res }, { headers: NO_STORE });
  } catch (err) {
    return fail(err);
  }
}
