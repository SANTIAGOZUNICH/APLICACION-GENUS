import { NextResponse } from "next/server";
import { MpTotalSchemaPendingError, removeTotalReplacement, setTotalReplacement } from "@/lib/mp-control/weekly-availability-service";
import { canWriteMpControl } from "@/lib/mp-control/types";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reemplazo MANUAL de una MP del Control semanal total por CUALQUIER MP del inventario (`remove: true` lo deshace). Persistente.
 * Solo cambia cómo se identifica y consolida la MP en este control: no modifica fórmulas, OE, consumos ni inventario.
 */
export async function POST(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (!canWriteMpControl(actor.sector)) return NextResponse.json({ error: "Solo Materia Prima puede reemplazar materias primas del control." }, { status: 403 });
    const b = (await request.json().catch(() => ({}))) as { sourceKey?: unknown; sourceLabel?: unknown; targetCode?: unknown; remove?: unknown };
    if (typeof b.sourceKey !== "string" || !b.sourceKey) return NextResponse.json({ error: "sourceKey es obligatorio." }, { status: 400 });
    if (b.remove) {
      await removeTotalReplacement(b.sourceKey);
      return NextResponse.json({ ok: true, removed: true });
    }
    if (typeof b.targetCode !== "string" || !b.targetCode.trim()) return NextResponse.json({ error: "Elegí la materia prima del inventario." }, { status: 400 });
    try {
      const replacement = await setTotalReplacement({ sourceKey: b.sourceKey.slice(0, 300), sourceLabel: String(b.sourceLabel ?? "").slice(0, 300), targetCode: b.targetCode, by: actor.email });
      return NextResponse.json({ ok: true, replacement });
    } catch (e) {
      if (e instanceof MpTotalSchemaPendingError) return NextResponse.json({ error: e.message, schemaPending: true }, { status: 503 });
      if (e instanceof Error && /inventario|reemplazar/.test(e.message)) return NextResponse.json({ error: e.message }, { status: 422 });
      throw e;
    }
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
