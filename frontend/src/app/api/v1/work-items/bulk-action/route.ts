import { NextResponse } from "next/server";
import { resolvePlanningActor } from "@/lib/planning/actor";
import { runBulkPendingAction, type BulkItemInput } from "@/lib/planning/bulk-pending-actions-service";
import { ensureNativePlanningReady, planningErrorResponse } from "@/lib/planning/http";
import { PlanningForbiddenError, PlanningValidationError } from "@/lib/planning/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/**
 * Acciones masivas de «Pendientes de definir» (marcar como entregados / enviar a Codificado). Reutilizan el flujo
 * individual; el sector sale de la SESIÓN (Producción o Dirección, igual que ver los pendientes y operarlos).
 * `dryRun: true` ejecuta el flujo real y lo revierte: devuelve qué pasaría con cada trabajo sin escribir nada.
 */
export async function POST(request: Request) {
  const blocked = ensureNativePlanningReady();
  if (blocked) return blocked;
  try {
    const actor = await resolvePlanningActor(request);
    const sector = String(actor.sector ?? "").toUpperCase();
    if (sector !== "PRODUCCION" && sector !== "DIRECCION") {
      throw new PlanningForbiddenError("Solo Producción o Dirección pueden operar los pendientes de definir.");
    }
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const action = body?.action;
    if (action !== "DELIVER" && action !== "SEND_CODIFICADO") {
      throw new PlanningValidationError("Acción masiva inválida.");
    }
    if (!body || !Array.isArray(body.items)) throw new PlanningValidationError("Falta la lista de trabajos.");
    const items: BulkItemInput[] = [];
    for (const raw of body.items) {
      const r = raw as { id?: unknown; totalUnits?: unknown };
      if (typeof r?.id !== "string") throw new PlanningValidationError("Lista de trabajos inválida.");
      const total = typeof r.totalUnits === "number" && Number.isFinite(r.totalUnits) ? r.totalUnits : null;
      items.push({ id: r.id, totalUnits: total });
    }
    const d = (body.delivery ?? {}) as Record<string, unknown>;
    const result = await runBulkPendingAction({
      action,
      items,
      actor,
      dryRun: body.dryRun === true,
      batchKey: str(body.batchKey) ?? undefined,
      delivery:
        action === "DELIVER"
          ? {
              actualDeliveredAt: str(d.actualDeliveredAt),
              remito: str(d.remito),
              receivedBy: str(d.receivedBy),
              observations: str(d.observations),
            }
          : undefined,
      observation: str(body.observation),
    });
    return NextResponse.json(result);
  } catch (err) {
    return planningErrorResponse(err);
  }
}
