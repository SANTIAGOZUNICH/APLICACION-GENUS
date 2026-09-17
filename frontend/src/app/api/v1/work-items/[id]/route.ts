import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { workItems } from "@/lib/db/schema";
import { mapWorkItemRow } from "@/lib/planning/drizzle-repository";
import { projectNativeWorkItem } from "@/lib/planning/native-projector";
import { nativeIdFromItemId } from "@/lib/planning/work-item-progress-repository";
import { ensureNativePlanningReady, planningErrorResponse } from "@/lib/planning/http";
import { PlanningNotFoundError } from "@/lib/planning/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Fresh-fetch de UN work item por id — para "Editar trabajo": nunca confiar
 * solamente en el objeto que quedó cargado antes en React. Devuelve el
 * WorkItem canónico actual, incluyendo `version` (concurrencia optimista) y
 * `deletedAt` — el caller decide qué hacer si ya fue borrado mientras tanto.
 */
export async function GET(request: Request, ctx: Ctx) {
  const blocked = ensureNativePlanningReady();
  if (blocked) return blocked;
  try {
    const { id } = await ctx.params;
    const nativeId = nativeIdFromItemId(id) ?? id;
    const db = getDb();
    const [row] = await db.select().from(workItems).where(eq(workItems.id, nativeId)).limit(1);
    if (!row) throw new PlanningNotFoundError("Trabajo no encontrado.");
    const record = mapWorkItemRow(row);
    return NextResponse.json({
      item: projectNativeWorkItem(record),
      version: record.version,
      deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    });
  } catch (err) {
    return planningErrorResponse(err);
  }
}
