import { NextResponse } from "next/server";
import { resolvePlanningActor } from "@/lib/planning/actor";
import { getPlanningService } from "@/lib/planning/get-planning-service";
import { ensureNativePlanningReady, planningErrorResponse } from "@/lib/planning/http";
import { projectNativeWorkItems } from "@/lib/planning/native-projector";
import { classifyPendingDefinition } from "@/lib/planning/circuit/pending-definition";
import { retireQualityCircuitDurable } from "@/lib/planning/circuit/quality-retirement";
import { PlanningForbiddenError } from "@/lib/planning/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * «Pendientes de definir» (Producción/Dirección): trabajos terminados sin destino, incluidos los que estaban
 * pendientes en la ex-bandeja de Calidad. Al abrirlos se corre la reubicación idempotente (evento
 * QUALITY_CIRCUIT_RETIRED por trabajo); NUNCA se marca nada como entregado ni finalizado.
 */
export async function GET(request: Request) {
  const blocked = ensureNativePlanningReady();
  if (blocked) return blocked;
  try {
    const actor = await resolvePlanningActor(request);
    const sector = String(actor.sector ?? "").toUpperCase();
    if (sector !== "PRODUCCION" && sector !== "DIRECCION") {
      throw new PlanningForbiddenError("Solo Producción y Dirección ven los trabajos pendientes de definir.");
    }
    // NOTA: este GET hace una escritura idempotente (backfill auditable QUALITY_CIRCUIT_RETIRED por trabajo, ids
    // determinísticos + onConflictDoNothing). Si esa escritura falla NUNCA rompe la lectura: se loguea y se sigue.
    let retirement = { candidates: 0, recorded: 0 };
    try {
      retirement = await retireQualityCircuitDurable();
    } catch (error) {
      // La reubicación es un efecto auditable idempotente: si falla, la lista igual se muestra.
      console.error("[circuito] reubicación de pendientes de Calidad falló", error);
    }
    // El filtro por estado va en la consulta (sin tope que deje pendientes afuera).
    const pendingRows = await getPlanningService().listCompletedItems({ operationalStatus: "revision" });
    const workItems = projectNativeWorkItems(pendingRows);
    const items = workItems.map((workItem) => ({
      workItem,
      info: classifyPendingDefinition({
        sector: workItem.sector,
        operationalStatus: "revision",
        completedAt: workItem.completedAt ?? null,
        qualityStatus: workItem.qualityStatus ?? "pendiente",
        viaCodificado: workItem.viaCodificado,
        codificadoCancelledAt: workItem.codificadoCancelledAt ?? null,
      }),
    }));
    return NextResponse.json({
      ok: true,
      count: items.length,
      legacyQualityPending: items.filter((i) => i.info.legacyQualityPending).length,
      retirement,
      items,
    });
  } catch (err) {
    return planningErrorResponse(err);
  }
}
