import { NextResponse } from "next/server";
import { resolvePlanningActor } from "@/lib/planning/actor";
import { ensureNativePlanningReady, planningErrorResponse } from "@/lib/planning/http";
import {
  cancelInternalDelivery,
  editDeliveredWork,
  editInternalDelivery,
  editLegacyDelivery,
  getInternalDeliveryHistory,
  InternalDeliveryConflictError,
  listInternalDeliveries,
  type InternalDeliveryKind,
} from "@/lib/planning/internal-deliveries-service";
import { PlanningValidationError } from "@/lib/planning/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function fail(err: unknown) {
  if (err instanceof InternalDeliveryConflictError) return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
  return planningErrorResponse(err);
}

function kindOf(raw: unknown): InternalDeliveryKind {
  const k = String(raw ?? "").toUpperCase();
  if (k !== "PRODUCCION" && k !== "CODIFICADO") throw new PlanningValidationError("Tipo de entrega inválido.");
  return k;
}

/**
 * GET /api/v1/internal-deliveries — entregas internas (a Producción y a Codificado). Cada sector operativo ve las suyas; Producción y
 * Dirección ven todas. `?history=<kind>:<id>` devuelve el historial de modificaciones de una entrega.
 */
export async function GET(request: Request) {
  const blocked = ensureNativePlanningReady();
  if (blocked) return blocked;
  try {
    const actor = await resolvePlanningActor(request);
    const sp = new URL(request.url).searchParams;
    const history = sp.get("history");
    if (history) {
      const [kind, id] = history.split(":");
      return NextResponse.json({ ok: true, changes: await getInternalDeliveryHistory(actor, kindOf(kind), String(id ?? "")) }, { headers: NO_STORE });
    }
    const status = sp.get("status");
    const items = await listInternalDeliveries(actor, {
      q: sp.get("q"),
      workItemId: sp.get("workItemId"),
      sector: sp.get("sector"),
      status: status === "ACTIVA" || status === "CANCELADA" ? status : null,
      from: sp.get("from"),
      to: sp.get("to"),
      limit: Number(sp.get("limit") ?? 300),
    });
    return NextResponse.json({ ok: true, items }, { headers: NO_STORE });
  } catch (err) {
    return fail(err);
  }
}

/**
 * POST /api/v1/internal-deliveries — { action: "edit" | "cancel", kind, id, quantity?, observations?, reason?, expectedVersion? }.
 * Los permisos se validan acá (servidor): cada sector solo modifica las entregas de su sector; Producción/Dirección, todas.
 * Solo toca la entrega y los totales derivados del trabajo: nunca entregas a clientes, remitos ni stock.
 */
export async function POST(request: Request) {
  const blocked = ensureNativePlanningReady();
  if (blocked) return blocked;
  try {
    const actor = await resolvePlanningActor(request);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new PlanningValidationError("Body JSON inválido.");
    const action = String(body.action ?? "").toLowerCase();
    // Producción → Entregados → «Editar trabajo entregado»: corrige varias entregas del trabajo en UNA transacción.
    if (action === "edit_work") {
      const edits = Array.isArray(body.edits) ? (body.edits as Array<Record<string, unknown>>) : [];
      const result = await editDeliveredWork(actor, {
        workItemId: String(body.workItemId ?? ""),
        edits: edits.map((e) => ({
          id: String(e.id ?? ""),
          quantity: e.quantity === undefined ? undefined : (e.quantity as number | string | null),
          observations: e.observations === undefined ? undefined : e.observations == null ? "" : String(e.observations),
          packingGroups: e.packingGroups,
          expectedVersion: e.expectedVersion != null && Number.isFinite(Number(e.expectedVersion)) ? Number(e.expectedVersion) : null,
        })),
      });
      return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE });
    }
    if (action === "edit_legacy") {
      const result = await editLegacyDelivery(actor, {
        deliveryId: String(body.deliveryId ?? ""),
        quantity: body.quantity === undefined ? undefined : (body.quantity as number | string | null),
        observations: body.observations === undefined ? undefined : body.observations == null ? "" : String(body.observations),
        packingGroups: body.packingGroups,
      });
      return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE });
    }
    const kind = kindOf(body.kind);
    const id = String(body.id ?? "");
    const expectedVersion = body.expectedVersion != null && Number.isFinite(Number(body.expectedVersion)) ? Number(body.expectedVersion) : null;
    if (action === "edit") {
      const result = await editInternalDelivery(actor, {
        kind,
        id,
        quantity: body.quantity === undefined ? undefined : (body.quantity as number | string | null),
        observations: body.observations === undefined ? undefined : body.observations == null ? "" : String(body.observations),
        packingGroups: body.packingGroups,
        expectedVersion,
      });
      return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE });
    }
    if (action === "cancel") {
      const result = await cancelInternalDelivery(actor, { kind, id, reason: String(body.reason ?? ""), expectedVersion });
      return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE });
    }
    throw new PlanningValidationError("Acción inválida (edit | cancel | edit_work | edit_legacy).");
  } catch (err) {
    return fail(err);
  }
}
