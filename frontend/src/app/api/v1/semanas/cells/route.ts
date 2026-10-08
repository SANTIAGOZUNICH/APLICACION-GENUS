import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersValidationError } from "@/lib/orders/types";
import { captureEditedTaskKeys, reconcileSemanasPriorities, writeSemanasCell, type SemanasCellEdit, type SemanasEditResult } from "@/lib/semanas-sheet/semanas-sheet-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_EDITS = 100;

/**
 * Edita celdas de SEMANAS 2026 (una escritura de Google por celda). Resultado
 * POR CELDA; `ok` solo si todas quedaron confirmadas en la Sheet.
 */
export async function PATCH(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const body = (await request.json().catch(() => null)) as { edits?: SemanasCellEdit[] } | null;
    if (!body || !Array.isArray(body.edits) || body.edits.length === 0) throw new OrdersValidationError("edits es obligatorio.");
    if (body.edits.length > MAX_EDITS) throw new OrdersValidationError(`Máximo ${MAX_EDITS} celdas por operación.`);
    // Solo Producción edita (el servicio lo vuelve a exigir por celda); la clave previa permite conservar la prioridad si se corrige el texto.
    const captured = actor.sector === "PRODUCCION" ? await captureEditedTaskKeys(body.edits.map((e) => ({ tabKey: String(e.tabKey), a1: String(e.a1 ?? "") }))) : [];
    const results: SemanasEditResult[] = [];
    for (const edit of body.edits) {
      results.push(
        await writeSemanasCell({ email: actor.email, sector: actor.sector, displayName: actor.displayName }, {
          tabKey: edit.tabKey,
          a1: String(edit.a1 ?? ""),
          expectedValue: String(edit.expectedValue ?? ""),
          value: String(edit.value ?? ""),
          reason: edit.reason ? String(edit.reason) : undefined,
        })
      );
    }
    if (results.some((r) => r.ok) && captured.length > 0) {
      const okA1 = new Set(body.edits.filter((_, i) => results[i]?.ok).map((e) => String(e.a1 ?? "").toUpperCase()));
      await reconcileSemanasPriorities(captured.filter((c) => okA1.has(c.a1)), { email: actor.email, sector: actor.sector, displayName: actor.displayName });
    }
    const ok = results.every((r) => r.ok);
    const codes = new Set(results.flatMap((r) => (r.ok ? [] : [r.code])));
    const status = ok ? 200 : codes.has("CONFLICT") || codes.has("BUSY") ? 409 : codes.has("NOT_WRITABLE") || codes.has("PROTECTED") ? 403 : codes.has("INVALID") || codes.has("REASON_REQUIRED") ? 400 : 502;
    return NextResponse.json({ ok, results, error: results.find((r) => !r.ok && "message" in r) && (results.find((r) => !r.ok) as { message: string }).message }, { status });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
