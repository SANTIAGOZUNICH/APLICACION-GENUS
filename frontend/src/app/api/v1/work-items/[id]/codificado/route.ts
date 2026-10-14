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
import { PlanningValidationError } from "@/lib/planning/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Action = "send" | "cancel" | "deliver" | "resend" | "reopen_delivery";

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
      "action inválida (send|resend|cancel|deliver|reopen_delivery)."
    );
  } catch (err) {
    return planningErrorResponse(err);
  }
}
