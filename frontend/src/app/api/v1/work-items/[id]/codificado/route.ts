import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { resolvePlanningActor } from "@/lib/planning/actor";
import {
  cancelCodificadoHandoffDurable,
  deliverFromCodificadoDurable,
  handoffToCodificadoDurable,
  reopenCodificadoDeliveryDurable,
} from "@/lib/planning/codificado-handoff-service";
import {
  ensureNativePlanningReady,
  planningErrorResponse,
} from "@/lib/planning/http";
import { projectNativeWorkItem } from "@/lib/planning/native-projector";
import { getCodificadoTransferView, recordCodificadoProgressDurable, transferToCodificadoDurable } from "@/lib/planning/codificado-transfer-service";
import { PlanningValidationError } from "@/lib/planning/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Action = "send" | "cancel" | "deliver" | "resend" | "reopen_delivery" | "transfer" | "progress";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const blocked = ensureNativePlanningReady();
  if (blocked) return blocked;
  try {
    const actor = await resolvePlanningActor(request);
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) throw new PlanningValidationError("Body JSON inválido.");

    const action = String(body.action ?? "send").trim().toLowerCase() as Action;
    const idempotencyKey = String(
      body.idempotencyKey ?? body.idempotency_key ?? randomUUID()
    ).trim();
    const expectedVersion =
      body.expectedVersion != null && Number.isFinite(Number(body.expectedVersion))
        ? Number(body.expectedVersion)
        : null;

    // Entrega PARCIAL de Envasado a Codificado (movimiento interno; el trabajo de Envasado sigue abierto).
    if (action === "transfer") {
      const qty = Number(String(body.quantity ?? "").replace(",", "."));
      const result = await transferToCodificadoDurable(
        {
          workItemId: id,
          quantity: qty,
          finishedQty: body.finishedQty != null && String(body.finishedQty).trim() !== "" ? Number(String(body.finishedQty).replace(",", ".")) : null,
          observation: body.observation != null ? String(body.observation) : null,
          packingGroups: body.packingGroups ?? null,
          idempotencyKey,
        },
        actor
      );
      return NextResponse.json({ ok: true, replayed: result.replayed, complete: result.complete, transfer: result.transfer, view: result.view });
    }

    // Avance de Codificado: unidades ya codificadas de lo recibido.
    if (action === "progress") {
      const view = await recordCodificadoProgressDurable({ workItemId: id, codedUnits: Number(String(body.codedUnits ?? "").replace(",", ".")) }, actor);
      return NextResponse.json({ ok: true, view });
    }

    if (action === "send" || action === "resend") {
      const totalUnits = Number(body.totalUnits ?? body.packagingTotalUnits);
      const result = await handoffToCodificadoDurable(
        {
          workItemId: id,
          totalUnits,
          observation:
            body.observation != null ? String(body.observation) : null,
          packagingLote:
            body.packagingLote != null ? String(body.packagingLote) : null,
          packagingVto:
            body.packagingVto != null ? String(body.packagingVto) : null,
          packingGroups: body.packingGroups ?? null,
          sampleUnits:
            body.sampleUnits != null ? Number(body.sampleUnits) : null,
          bulkRemainderKg:
            body.bulkRemainderKg != null ? Number(body.bulkRemainderKg) : null,
          bulkRemainderObservation:
            body.bulkRemainderObservation != null
              ? String(body.bulkRemainderObservation)
              : null,
          bulkRemainderId:
            body.bulkRemainderId != null ? String(body.bulkRemainderId) : null,
          expectedVersion,
          idempotencyKey,
        },
        actor
      );
      return NextResponse.json({
        ok: true,
        replayed: result.replayed,
        operationId: result.operationId,
        workItem: projectNativeWorkItem(result.item),
        item: result.item,
      });
    }

    if (action === "cancel") {
      const result = await cancelCodificadoHandoffDurable(
        {
          workItemId: id,
          reason: body.reason != null ? String(body.reason) : null,
          expectedVersion,
          idempotencyKey,
          forceWithdrawDelivery: Boolean(body.forceWithdrawDelivery),
        },
        actor
      );
      return NextResponse.json({
        ok: true,
        replayed: result.replayed,
        operationId: result.operationId,
        workItem: projectNativeWorkItem(result.item),
        item: result.item,
      });
    }

    if (action === "deliver") {
      const result = await deliverFromCodificadoDurable(
        {
          workItemId: id,
          observation:
            body.observation != null ? String(body.observation) : null,
          packagingLote:
            body.packagingLote != null ? String(body.packagingLote) : null,
          packagingVto:
            body.packagingVto != null ? String(body.packagingVto) : null,
          packagingTotalUnits:
            body.packagingTotalUnits != null
              ? Number(body.packagingTotalUnits)
              : null,
          packingGroups: body.packingGroups ?? null,
          sampleUnits:
            body.sampleUnits != null ? Number(body.sampleUnits) : null,
          expectedVersion,
          idempotencyKey,
          // Entrega parcial: unidades entregadas ahora (omitido = todo el saldo).
          deliverQuantity:
            body.deliverQuantity != null && String(body.deliverQuantity).trim() !== ""
              ? Number(String(body.deliverQuantity).replace(",", "."))
              : null,
          deliveryPackingGroups: Array.isArray(body.deliveryPackingGroups) ? body.deliveryPackingGroups : null,
          remito: body.remito != null ? String(body.remito) : null,
          receivedBy: body.receivedBy != null ? String(body.receivedBy) : null,
          plannedDeliveryDate:
            body.plannedDeliveryDate != null ? String(body.plannedDeliveryDate) : null,
          actualDeliveredAt: body.actualDeliveredAt != null ? String(body.actualDeliveredAt) : null,
        },
        actor
      );
      return NextResponse.json({
        ok: true,
        replayed: result.replayed,
        operationId: result.operationId,
        workItem: projectNativeWorkItem(result.item),
        item: result.item,
        delivery: {
          id: result.deliveryId,
          complete: result.complete,
          delivered: result.delivered,
          pending: result.pending,
        },
      });
    }

    if (action === "reopen_delivery") {
      const result = await reopenCodificadoDeliveryDurable(
        {
          workItemId: id,
          reason: body.reason != null ? String(body.reason) : null,
          expectedVersion,
          idempotencyKey,
        },
        actor
      );
      return NextResponse.json({
        ok: true,
        replayed: result.replayed,
        operationId: result.operationId,
        workItem: projectNativeWorkItem(result.item),
        item: result.item,
      });
    }

    throw new PlanningValidationError(
      "action inválida (send|resend|cancel|deliver|reopen_delivery|transfer|progress)."
    );
  } catch (err) {
    return planningErrorResponse(err);
  }
}

/** Estado de las entregas de un trabajo a Codificado: asignada, terminada, entregada, recibida, codificada y entregas una por una. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = ensureNativePlanningReady();
  if (blocked) return blocked;
  try {
    const actor = await resolvePlanningActor(request);
    const { id } = await ctx.params;
    return NextResponse.json({ ok: true, view: await getCodificadoTransferView(id, actor) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return planningErrorResponse(err);
  }
}
