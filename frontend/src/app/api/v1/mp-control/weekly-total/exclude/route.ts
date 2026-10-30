import { NextResponse } from "next/server";
import { excludeTotalRows, restoreTotalRows } from "@/lib/mp-control/weekly-availability-service";
import { canWriteMpControl } from "@/lib/mp-control/types";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Quita (o restaura con `restore: true`) MP del Control semanal total de una semana. Persistente. NO borra la MP del inventario
 * maestro ni toca OE, fórmulas o consumos: solo deja de mostrarla en este control.
 */
export async function POST(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (!canWriteMpControl(actor.sector)) return NextResponse.json({ error: "Solo Materia Prima puede quitar materias primas del control." }, { status: 403 });
    const b = (await request.json().catch(() => ({}))) as { week?: unknown; rows?: Array<{ rowKey?: unknown; label?: unknown }>; rowKeys?: unknown; restore?: unknown };
    const week = typeof b.week === "string" && (b.week === "sin-fecha" || /^\d{4}-\d{2}-\d{2}$/.test(b.week)) ? b.week : null;
    if (!week) return NextResponse.json({ error: "week inválida." }, { status: 400 });
    if (b.restore) {
      const keys = Array.isArray(b.rowKeys) ? b.rowKeys.map(String).slice(0, 500) : [];
      if (keys.length === 0) return NextResponse.json({ error: "rowKeys es obligatorio." }, { status: 400 });
      return NextResponse.json({ ok: true, restored: await restoreTotalRows({ week, rowKeys: keys }) });
    }
    const rows = (Array.isArray(b.rows) ? b.rows : []).filter((r) => typeof r.rowKey === "string" && r.rowKey).slice(0, 500).map((r) => ({ rowKey: String(r.rowKey), label: String(r.label ?? "").slice(0, 300) }));
    if (rows.length === 0) return NextResponse.json({ error: "rows es obligatorio." }, { status: 400 });
    return NextResponse.json({ ok: true, excluded: await excludeTotalRows({ week, rows, by: actor.email }) });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
