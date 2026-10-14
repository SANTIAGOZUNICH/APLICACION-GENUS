import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { resolvePlanningActor } from "@/lib/planning/actor";
import { ensureNativePlanningReady, planningErrorResponse } from "@/lib/planning/http";
import { projectNativeWorkItem } from "@/lib/planning/native-projector";
import {
  sendElaboracionToEnvasadoDurable,
  suggestEnvasadoDestinationForItem,
} from "@/lib/planning/circuit/elaboracion-handoff";
import { isEnvasadoDestination } from "@/lib/planning/circuit/destination";
import { PlanningValidationError } from "@/lib/planning/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sugerencia de Envasado de destino (Masivo/Premium) para el diálogo «Enviar a Envasado». Solo lectura. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = ensureNativePlanningReady();
  if (blocked) return blocked;
  try {
    await resolvePlanningActor(request);
    const { id } = await ctx.params;
    const suggestion = await suggestEnvasadoDestinationForItem(id);
    return NextResponse.json({ ok: true, ...suggestion });
  } catch (err) {
    return planningErrorResponse(err);
  }
}

/**
 * Elaboración → Envasado Masivo/Premium, directo (sin Calidad). Idempotente por `idempotencyKey`.
 * Body: { destination?, line?, producedQuantity?, unitsToPackage?, observation?, plannedDate?, idempotencyKey }
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = ensureNativePlanningReady();
  if (blocked) return blocked;
  try {
    const actor = await resolvePlanningActor(request);
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new PlanningValidationError("Body JSON inválido.");
    const destination = body.destination != null ? String(body.destination).trim().toUpperCase() : null;
    if (destination && !isEnvasadoDestination(destination)) {
      throw new PlanningValidationError("El destino debe ser ENVASADO_MASIVO o ENVASADO_PREMIUM.");
    }
    const result = await sendElaboracionToEnvasadoDurable(
      {
        workItemId: id,
        destination: destination && isEnvasadoDestination(destination) ? destination : null,
        line: body.line != null ? String(body.line) : null,
        producedQuantity: body.producedQuantity != null ? String(body.producedQuantity) : null,
        unitsToPackage: body.unitsToPackage != null ? String(body.unitsToPackage) : null,
        observation: body.observation != null ? String(body.observation) : null,
        plannedDate: body.plannedDate != null ? String(body.plannedDate) : null,
        idempotencyKey: String(body.idempotencyKey ?? body.idempotency_key ?? randomUUID()).trim(),
      },
      actor
    );
    return NextResponse.json({
      ok: true,
      replayed: result.replayed,
      linked: result.linked,
      operationId: result.operationId,
      destinationSector: result.destinationSector,
      workItem: projectNativeWorkItem(result.source),
      destinationWorkItem: projectNativeWorkItem(result.destination),
    });
  } catch (err) {
    return planningErrorResponse(err);
  }
}
