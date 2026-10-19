import { NextResponse } from "next/server";
import { resolvePlanningActor } from "@/lib/planning/actor";
import { validateWorkMutationActor } from "@/features/os/operational/lib/work-mutation-rbac";
import { bulkDeleteWorkItemsDurable } from "@/lib/planning/bulk-delete-works-service";
import { ensureNativePlanningReady, planningErrorResponse } from "@/lib/planning/http";
import { PlanningForbiddenError, PlanningValidationError } from "@/lib/planning/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Eliminación masiva de trabajos (Producción). Misma RBAC que el borrado individual: solo PRODUCCION,
 * validado acá en el servidor con el sector de la sesión (no con lo que declare el cliente).
 * `dryRun: true` devuelve los veredictos por trabajo sin escribir nada (alimenta el modal de confirmación).
 */
export async function POST(request: Request) {
  const blocked = ensureNativePlanningReady();
  if (blocked) return blocked;
  try {
    const actor = await resolvePlanningActor(request);
    const gate = validateWorkMutationActor(actor.sector);
    if (!gate.ok) {
      throw new PlanningForbiddenError(gate.error);
    }
    const body = (await request.json().catch(() => null)) as {
      ids?: unknown;
      reason?: unknown;
      dryRun?: unknown;
      batchKey?: unknown;
      expectedVersions?: unknown;
    } | null;
    if (!body || !Array.isArray(body.ids) || !body.ids.every((id) => typeof id === "string")) {
      throw new PlanningValidationError("Falta la lista de trabajos a eliminar.");
    }
    const expectedVersions: Record<string, number> = {};
    if (body.expectedVersions && typeof body.expectedVersions === "object") {
      for (const [k, v] of Object.entries(body.expectedVersions as Record<string, unknown>)) {
        if (typeof v === "number" && Number.isInteger(v)) expectedVersions[k] = v;
      }
    }
    const result = await bulkDeleteWorkItemsDurable({
      ids: body.ids as string[],
      reason: typeof body.reason === "string" ? body.reason : "",
      actorEmail: actor.email,
      dryRun: body.dryRun === true,
      batchKey: typeof body.batchKey === "string" ? body.batchKey : undefined,
      expectedVersions,
    });
    return NextResponse.json(result);
  } catch (err) {
    return planningErrorResponse(err);
  }
}
