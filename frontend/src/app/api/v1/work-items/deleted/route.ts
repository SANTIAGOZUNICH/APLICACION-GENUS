import { NextResponse } from "next/server";
import { resolvePlanningActor } from "@/lib/planning/actor";
import { validateWorkMutationActor } from "@/features/os/operational/lib/work-mutation-rbac";
import { listDeletedWorkItemsDurable } from "@/lib/planning/work-item-progress-repository";
import { mapWorkItemRow } from "@/lib/planning/drizzle-repository";
import { projectNativeWorkItem } from "@/lib/planning/native-projector";
import { ensureNativePlanningReady, planningErrorResponse } from "@/lib/planning/http";
import { PlanningForbiddenError } from "@/lib/planning/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Ver eliminados" (sección 32) — lista work items nativos con soft-delete
 * activo, con fecha/usuario/motivo. Solo Producción (misma RBAC que
 * eliminar/restaurar) — sectores operativos no gestionan esta vista.
 */
export async function GET(request: Request) {
  const blocked = ensureNativePlanningReady();
  if (blocked) return blocked;
  try {
    const actor = await resolvePlanningActor(request);
    const gate = validateWorkMutationActor(actor.sector);
    if (!gate.ok) {
      throw new PlanningForbiddenError("Ver trabajos eliminados está habilitado solo para Producción.");
    }
    const rows = await listDeletedWorkItemsDurable();
    const items = rows.map((row) => ({
      item: projectNativeWorkItem(mapWorkItemRow(row)),
      deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
      deletedBy: row.deletedBy,
      deleteReason: row.deleteReason,
    }));
    return NextResponse.json({ items });
  } catch (err) {
    return planningErrorResponse(err);
  }
}
