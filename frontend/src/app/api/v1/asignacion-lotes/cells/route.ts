import { NextResponse } from "next/server";
import { AsignacionCellPatchError } from "@/lib/asignacion-lotes/asignacion-lotes-service";
import { patchCellsWithWriteback } from "@/lib/asignacion-lotes/asignacion-lotes-writeback-service";
import type { AsignacionCellChange } from "@/lib/asignacion-lotes/cell-edit";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { asignacionLotesErrorResponse } from "@/lib/asignacion-lotes/schema-status";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH parcial por celda (grilla tipo Excel). Atómico: o se guardan TODAS
 * las celdas o ninguna. Respuesta de rechazo: { error, failures: [...] }.
 */
export async function PATCH(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const body = (await request.json().catch(() => null)) as {
      actorSectorId?: string;
      changes?: AsignacionCellChange[];
    } | null;
    if (!body || !Array.isArray(body.changes)) {
      throw new OrdersValidationError("changes es obligatorio.");
    }
    if (body.actorSectorId && body.actorSectorId !== actor.sector) {
      throw new OrdersForbiddenError("El sector enviado no coincide con la sesión del actor.");
    }
    const result = await patchCellsWithWriteback(
      { email: actor.email, sector: actor.sector, displayName: actor.displayName },
      body.changes
    );
    if (result.ok) {
      return NextResponse.json({
        ok: true,
        items: result.items,
        changedCells: result.results.length,
        unchangedCells: 0,
      });
    }
    // Éxito PARCIAL o fallo: nunca "ok". `items` trae lo que sí quedó consistente (para refrescar la UI).
    const failures = result.results.flatMap((r) =>
      r.status === "confirmed"
        ? []
        : [{ index: r.index, id: body.changes![r.index]?.id ?? "", field: body.changes![r.index]?.field ?? "", code: r.code, message: r.message }]
    );
    const codes = new Set(failures.map((f) => f.code));
    const status = codes.has("GOOGLE_CONFLICT") || codes.has("CONFLICT")
      ? 409
      : codes.has("PROTECTED_SOURCE") || codes.has("FORBIDDEN_FIELD")
        ? 403
        : codes.has("GOOGLE_ERROR") || codes.has("GOOGLE_PENDING")
          ? 502
          : 400;
    return NextResponse.json(
      { ok: false, error: failures[0]?.message ?? "No se pudo guardar.", failures, items: result.items },
      { status }
    );
  } catch (err) {
    if (err instanceof AsignacionCellPatchError) {
      return NextResponse.json(
        { error: err.message, code: err.code, failures: err.failures },
        { status: err.status }
      );
    }
    return asignacionLotesErrorResponse(err);
  }
}
