import { NextResponse } from "next/server";
import { canUseDriveAdapter } from "@/lib/api/bff-helpers";
import { getServerDataMode } from "@/lib/config/data-mode";
import { serverOperationalState } from "@/lib/live-sync/server-operational-state";
import { validateQualityDecisionActor } from "@/features/os/operational/lib/quality-decision-rbac";
import { validateWorkMutationActor } from "@/features/os/operational/lib/work-mutation-rbac";
import { validateDeliveryMutationActor } from "@/features/os/operational/lib/delivery-rbac";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";
import { AuthUnauthorizedError } from "@/lib/auth/types";
import { PlanningValidationError } from "@/lib/planning/types";
import type { WorkItem } from "@/types/operational/work-item";
import type { SectorId } from "@/types/operational/sector";
import type { DeliveryRecord } from "@/features/os/operational/adapters/delivery-repository";
import { notifyEnvasadoForApproval } from "@/lib/notifications/approval-envasado-notify";
import { normalizeOptionalReason } from "@/lib/lifecycle";
import {
  annulDeliveryDurable,
  annulQualityDecisionDurable,
  archiveDeliveryDurable,
  cancelWorkDurable,
  completeWorkDurable,
  decideQualityDurable,
  deleteDeliveryRecordDurable,
  deleteWorkItemDurable,
  deliverWorkDurable,
  nativeIdFromItemId,
  restoreCancelledWorkDurable,
  restoreDeliveryDurable,
  reworkWorkItemDurable,
  saveWorkProgressDurable,
  toClientDeliveryRecord,
  updateWorkItemLoteVtoDurable,
  updateWorkItemOrderRefDurable,
  updateWorkItemPlanningDurable,
} from "@/lib/planning/work-item-progress-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OperationAction =
  | {
      action: "save_progress";
      itemId: string;
      sector?: SectorId;
      finishedQty: string;
      observation: string;
      updatedBy?: string;
      packagingLote?: string | null;
      packagingVto?: string | null;
      packagingTotalUnits?: number | null;
      packagingCajas?: number | null;
      packagingUnidadesPorCaja?: number | null;
      packingGroups?: Array<{ cajas: number; unidadesPorCaja: number }> | null;
      packingMismatchObservation?: string | null;
      sampleUnits?: number | null;
    }
  | {
      action: "complete_work";
      item: WorkItem;
      finishedQty: string;
      observation: string;
      completedBy?: string;
      bulkRemainderKg?: number | null;
      bulkRemainderObservation?: string | null;
      bulkRemainderId?: string | null;
    }
  | {
      action: "quality_decision";
      itemId: string;
      status: "aprobado" | "rechazado";
      decidedBy?: string;
      observation?: string;
      actorSectorId?: SectorId;
      product?: string | null;
      client?: string | null;
      plannedDate?: string | null;
      plannedDateTo?: string | null;
      lote?: string | null;
      quantity?: string | null;
      relatedWorkItemId?: string | null;
    }
  | {
      action: "quality_annul";
      itemId: string;
      reason: string;
      decidedBy?: string;
      actorSectorId?: SectorId;
    }
  | {
      action: "rework_work";
      itemId: string;
      reason?: string | null;
      requestedBy?: string;
      actorSectorId?: SectorId;
    }
  | {
      action: "cancel_work";
      itemId: string;
      reason: string;
      cancelledBy?: string;
      sector?: SectorId;
      actorSectorId?: SectorId;
    }
  | {
      action: "restore_work";
      itemId: string;
      reason?: string;
      restoredBy?: string;
      sector?: SectorId;
      actorSectorId?: SectorId;
    }
  | {
      action: "update_lote_vto";
      itemId: string;
      packagingLote?: string | null;
      packagingVto?: string | null;
      reason: string;
      updatedBy?: string;
      actorSectorId?: SectorId;
    }
  | {
      action: "update_order_ref";
      itemId: string;
      orderNumberRaw: string;
      reason: string;
      updatedBy?: string;
      actorSectorId?: SectorId;
    }
  | {
      action: "edit_assignment";
      itemId: string;
      client?: string | null;
      product?: string | null;
      plannedQuantity?: string | null;
      unit?: string | null;
      deliveryDate?: string | null;
      plannedDate?: string | null;
      notes?: string | null;
      reason?: string | null;
      updatedBy?: string;
      actorSectorId?: SectorId;
    }
  | {
      action: "delete_work";
      itemId: string;
      reason?: string | null;
      deletedBy?: string;
      actorSectorId?: SectorId;
    }
  | (DeliveryRecord & {
      action: "deliver_work";
      actorSectorId?: SectorId;
    })
  | {
      action: "archive_delivery" | "restore_delivery";
      id: string;
      actorSectorId?: SectorId;
      actorName?: string;
    }
  | {
      action: "delete_delivery_record" | "annul_delivery";
      id: string;
      reason: string;
      actorSectorId?: SectorId;
      actorName?: string;
    };

function assertBodySectorMatches(
  bodySector: SectorId | undefined,
  actorSector: SectorId
): void {
  if (bodySector && bodySector !== actorSector) {
    throw new OrdersForbiddenError(
      "El sector enviado no coincide con la sesión del actor."
    );
  }
}

/** Mutaciones operativas — identidad por headers; body.actorSectorId no autoriza solo. */
export async function POST(request: Request) {
  if (getServerDataMode() !== "real" || !canUseDriveAdapter()) {
    return NextResponse.json(
      { error: "Operaciones en vivo requieren modo real.", code: "LIVE_SYNC_UNAVAILABLE" },
      { status: 503 }
    );
  }

  let body: OperationAction;
  try {
    body = (await request.json()) as OperationAction;
  } catch {
    return NextResponse.json({ error: "JSON inválido.", code: "INVALID_BODY" }, { status: 400 });
  }

  let actor: { email: string; sector: SectorId; displayName?: string; userId?: string };
  try {
    actor = await resolveOrdersActor(request);
  } catch (err) {
    if (err instanceof AuthUnauthorizedError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 401 });
    }
    if (err instanceof OrdersForbiddenError || err instanceof OrdersValidationError) {
      return NextResponse.json(
        { error: err.message, code: "ACTOR_FORBIDDEN" },
        { status: err instanceof OrdersForbiddenError ? 403 : 400 }
      );
    }
    throw err;
  }

  try {
    switch (body.action) {
      case "save_progress": {
        const nativeId = nativeIdFromItemId(body.itemId);
        if (nativeId) {
          const row = await saveWorkProgressDurable(
            nativeId,
            {
              finishedQty: body.finishedQty,
              observation: body.observation,
              updatedBy: body.updatedBy ?? actor.displayName ?? actor.email,
              sector: body.sector ?? actor.sector,
              packagingLote: body.packagingLote,
              packagingVto: body.packagingVto,
              packagingTotalUnits: body.packagingTotalUnits,
              packingGroups: body.packingGroups,
              packingMismatchObservation: body.packingMismatchObservation,
              sampleUnits: body.sampleUnits,
            },
            actor.sector
          );
          return NextResponse.json({ ok: true, revision: row.version, record: row });
        }
        const record = serverOperationalState.saveProgress(body.itemId, {
          finishedQty: body.finishedQty,
          observation: body.observation,
          updatedBy: body.updatedBy ?? actor.displayName ?? actor.email,
          sector: body.sector ?? actor.sector,
          packagingLote: body.packagingLote,
          packagingVto: body.packagingVto,
          packagingTotalUnits: body.packagingTotalUnits,
          packagingCajas: body.packagingCajas,
          packagingUnidadesPorCaja: body.packagingUnidadesPorCaja,
          packingGroups: body.packingGroups,
          packingMismatchObservation: body.packingMismatchObservation,
        });
        return NextResponse.json({
          ok: true,
          revision: serverOperationalState.getRevision(),
          record,
        });
      }
      case "complete_work": {
        const nativeId = nativeIdFromItemId(body.item.id);
        if (nativeId) {
          const row = await completeWorkDurable(
            nativeId,
            {
              finishedQty: body.finishedQty,
              observation: body.observation,
              completedBy: body.completedBy ?? actor.displayName ?? actor.email,
              bulkRemainderKg: body.bulkRemainderKg,
              bulkRemainderObservation: body.bulkRemainderObservation,
              bulkRemainderId: body.bulkRemainderId,
            },
            actor.sector
          );
          return NextResponse.json({ ok: true, revision: row.version, progress: row });
        }
        const result = serverOperationalState.completeWork(body.item, {
          finishedQty: body.finishedQty,
          observation: body.observation,
          completedBy: body.completedBy ?? actor.displayName ?? actor.email,
        });
        return NextResponse.json({
          ok: true,
          revision: serverOperationalState.getRevision(),
          ...result,
        });
      }
      case "quality_decision": {
        assertBodySectorMatches(body.actorSectorId, actor.sector);
        const gate = validateQualityDecisionActor(actor.sector);
        if (!gate.ok) {
          return NextResponse.json({ error: gate.error, code: gate.code }, { status: 403 });
        }
        const nativeQualityId = nativeIdFromItemId(body.itemId);
        const record = nativeQualityId
          ? await decideQualityDurable(nativeQualityId, body.status, {
              decidedBy: body.decidedBy ?? actor.displayName ?? actor.email,
              observation: body.observation,
              decidedBySector: actor.sector,
              decidedByEmail: actor.email,
            })
          : serverOperationalState.decideQuality(body.itemId, body.status, {
              decidedBy: body.decidedBy ?? actor.displayName ?? actor.email,
              observation: body.observation,
              decidedBySector: actor.sector,
              decidedByEmail: actor.email,
            });
        if (body.status === "aprobado" && (actor.sector === "CALIDAD" || actor.sector === "PRODUCCION")) {
          await notifyEnvasadoForApproval(
            actor,
            {
              itemId: body.itemId, product: body.product, client: body.client,
              plannedDate: body.plannedDate, plannedDateTo: body.plannedDateTo,
              lote: body.lote, quantity: body.quantity, relatedWorkItemId: body.relatedWorkItemId,
            },
            actor.sector
          );
        }
        return NextResponse.json({
          ok: true,
          revision: serverOperationalState.getRevision(),
          record,
        });
      }
      case "quality_annul": {
        assertBodySectorMatches(body.actorSectorId, actor.sector);
        const gate = validateQualityDecisionActor(actor.sector);
        if (!gate.ok) {
          return NextResponse.json({ error: gate.error, code: gate.code }, { status: 403 });
        }
        const reason = normalizeOptionalReason(body.reason);
        const nativeAnnulId = nativeIdFromItemId(body.itemId);
        const record = nativeAnnulId
          ? await annulQualityDecisionDurable(nativeAnnulId, {
              reason,
              decidedBy: body.decidedBy ?? actor.displayName ?? actor.email,
              decidedBySector: actor.sector,
              decidedByEmail: actor.email,
            })
          : serverOperationalState.annulQualityDecision(body.itemId, {
              reason,
              decidedBy: body.decidedBy ?? actor.displayName ?? actor.email,
              decidedBySector: actor.sector,
              decidedByEmail: actor.email,
            });
        return NextResponse.json({
          ok: true,
          revision: serverOperationalState.getRevision(),
          record,
        });
      }
      case "rework_work": {
        assertBodySectorMatches(body.actorSectorId, actor.sector);
        // Mismo conjunto de actores que Aprobar/Rechazar (CALIDAD/PRODUCCION)
        // — Rehacer es una tercera decisión sobre el mismo work item, no una
        // mutación de asignación (no reutiliza validateWorkMutationActor).
        const gate = validateQualityDecisionActor(actor.sector);
        if (!gate.ok) {
          return NextResponse.json({ error: gate.error, code: gate.code }, { status: 403 });
        }
        const nativeReworkId = nativeIdFromItemId(body.itemId);
        if (!nativeReworkId) {
          return NextResponse.json(
            { error: "Rehacer no disponible para este trabajo.", code: "NOT_NATIVE" },
            { status: 400 }
          );
        }
        try {
          const row = await reworkWorkItemDurable(nativeReworkId, {
            requestedBy: body.requestedBy ?? actor.displayName ?? actor.email,
            requestedBySector: actor.sector,
            reason: body.reason,
          });
          return NextResponse.json({ ok: true, revision: row.version, record: row });
        } catch (error) {
          if (error instanceof PlanningValidationError) {
            return NextResponse.json({ error: error.message, code: "REWORK_NOT_ALLOWED" }, { status: 409 });
          }
          throw error;
        }
      }
      case "cancel_work": {
        assertBodySectorMatches(body.actorSectorId, actor.sector);
        const gate = validateWorkMutationActor(actor.sector);
        if (!gate.ok) {
          return NextResponse.json({ error: gate.error, code: gate.code }, { status: 403 });
        }
        const reason = normalizeOptionalReason(body.reason);
        const nativeCancelId = nativeIdFromItemId(body.itemId);
        const record = nativeCancelId
          ? await cancelWorkDurable(nativeCancelId, {
              cancelledBy: body.cancelledBy ?? actor.displayName ?? actor.email,
              reason,
            })
          : serverOperationalState.cancelWork(body.itemId, {
              cancelledBy: body.cancelledBy ?? actor.displayName ?? actor.email,
              reason,
              sector: body.sector ?? actor.sector,
            });
        return NextResponse.json({
          ok: true,
          revision: serverOperationalState.getRevision(),
          record,
        });
      }
      case "restore_work": {
        assertBodySectorMatches(body.actorSectorId, actor.sector);
        const gate = validateWorkMutationActor(actor.sector);
        if (!gate.ok) {
          return NextResponse.json({ error: gate.error, code: gate.code }, { status: 403 });
        }
        const nativeRestoreId = nativeIdFromItemId(body.itemId);
        const record = nativeRestoreId
          ? await restoreCancelledWorkDurable(nativeRestoreId, {
              restoredBy: body.restoredBy ?? actor.displayName ?? actor.email,
              reason: body.reason,
            })
          : serverOperationalState.restoreCancelledWork(body.itemId, {
              restoredBy: body.restoredBy ?? actor.displayName ?? actor.email,
              reason: body.reason,
              sector: body.sector ?? actor.sector,
            });
        return NextResponse.json({
          ok: true,
          revision: serverOperationalState.getRevision(),
          record,
        });
      }
      case "update_lote_vto": {
        assertBodySectorMatches(body.actorSectorId, actor.sector);
        const gate = validateWorkMutationActor(actor.sector);
        if (!gate.ok) {
          return NextResponse.json({ error: gate.error, code: gate.code }, { status: 403 });
        }
        const nativeLoteVtoId = nativeIdFromItemId(body.itemId);
        if (!nativeLoteVtoId) {
          return NextResponse.json(
            { error: "Corrección de Lote/VTO no disponible para este trabajo.", code: "NOT_NATIVE" },
            { status: 400 }
          );
        }
        const row = await updateWorkItemLoteVtoDurable(nativeLoteVtoId, {
          packagingLote: body.packagingLote,
          packagingVto: body.packagingVto,
          reason: body.reason,
          updatedBy: body.updatedBy ?? actor.displayName ?? actor.email,
          updatedBySector: actor.sector,
        });
        return NextResponse.json({ ok: true, revision: row.version, record: row });
      }
      case "update_order_ref": {
        assertBodySectorMatches(body.actorSectorId, actor.sector);
        const gate = validateWorkMutationActor(actor.sector);
        if (!gate.ok) {
          return NextResponse.json({ error: gate.error, code: gate.code }, { status: 403 });
        }
        const nativeOrderRefId = nativeIdFromItemId(body.itemId);
        if (!nativeOrderRefId) {
          return NextResponse.json(
            { error: "Corrección de OA/OE no disponible para este trabajo.", code: "NOT_NATIVE" },
            { status: 400 }
          );
        }
        const row = await updateWorkItemOrderRefDurable(nativeOrderRefId, {
          orderNumberRaw: body.orderNumberRaw,
          reason: body.reason,
          updatedBy: body.updatedBy ?? actor.displayName ?? actor.email,
          updatedBySector: actor.sector,
        });
        return NextResponse.json({ ok: true, revision: row.version, record: row });
      }
      case "edit_assignment": {
        assertBodySectorMatches(body.actorSectorId, actor.sector);
        const gate = validateWorkMutationActor(actor.sector);
        if (!gate.ok) {
          return NextResponse.json({ error: gate.error, code: gate.code }, { status: 403 });
        }
        const nativePlanningId = nativeIdFromItemId(body.itemId);
        if (!nativePlanningId) {
          return NextResponse.json(
            { error: "Edición no disponible para este trabajo.", code: "NOT_NATIVE" },
            { status: 400 }
          );
        }
        const row = await updateWorkItemPlanningDurable(nativePlanningId, {
          client: body.client,
          product: body.product,
          plannedQuantity: body.plannedQuantity,
          unit: body.unit,
          deliveryDate: body.deliveryDate,
          plannedDate: body.plannedDate,
          notes: body.notes,
          reason: body.reason,
          updatedBy: body.updatedBy ?? actor.displayName ?? actor.email,
          updatedBySector: actor.sector,
        });
        return NextResponse.json({ ok: true, revision: row.version, record: row });
      }
      case "delete_work": {
        assertBodySectorMatches(body.actorSectorId, actor.sector);
        const gate = validateWorkMutationActor(actor.sector);
        if (!gate.ok) {
          return NextResponse.json({ error: gate.error, code: gate.code }, { status: 403 });
        }
        const nativeDeleteId = nativeIdFromItemId(body.itemId);
        if (!nativeDeleteId) {
          return NextResponse.json(
            { error: "Borrado no disponible para este trabajo.", code: "NOT_NATIVE" },
            { status: 400 }
          );
        }
        const row = await deleteWorkItemDurable(nativeDeleteId, {
          reason: body.reason,
          deletedBy: body.deletedBy ?? actor.displayName ?? actor.email,
        });
        return NextResponse.json({ ok: true, revision: row.version, record: row });
      }
      case "deliver_work": {
        assertBodySectorMatches(body.actorSectorId, actor.sector);
        const gate = validateDeliveryMutationActor(actor.sector);
        if (!gate.ok) {
          return NextResponse.json({ error: gate.error, code: gate.code }, { status: 403 });
        }
        const nativeDeliveryWorkId = nativeIdFromItemId(body.workItemId);
        const record = nativeDeliveryWorkId
          ? toClientDeliveryRecord(
              await deliverWorkDurable({ ...body, workItemId: nativeDeliveryWorkId })
            )
          : serverOperationalState.deliverWork(body);
        return NextResponse.json({
          ok: true,
          revision: serverOperationalState.getRevision(),
          record,
        });
      }
      case "archive_delivery": {
        assertBodySectorMatches(body.actorSectorId, actor.sector);
        const gate = validateDeliveryMutationActor(actor.sector);
        if (!gate.ok) {
          return NextResponse.json({ error: gate.error, code: gate.code }, { status: 403 });
        }
        const nativeArchived = await archiveDeliveryDurable(
          body.id,
          body.actorName ?? actor.displayName ?? actor.email
        );
        const record = nativeArchived
          ? toClientDeliveryRecord(nativeArchived)
          : serverOperationalState.archiveDelivery(
              body.id,
              body.actorName ?? actor.displayName ?? actor.email
            );
        if (!record) {
          return NextResponse.json(
            { error: "Entrega no encontrada.", code: "NOT_FOUND" },
            { status: 404 }
          );
        }
        return NextResponse.json({
          ok: true,
          revision: serverOperationalState.getRevision(),
          record,
        });
      }
      case "restore_delivery": {
        assertBodySectorMatches(body.actorSectorId, actor.sector);
        const gate = validateDeliveryMutationActor(actor.sector);
        if (!gate.ok) {
          return NextResponse.json({ error: gate.error, code: gate.code }, { status: 403 });
        }
        const nativeRestored = await restoreDeliveryDurable(body.id);
        const record = nativeRestored
          ? toClientDeliveryRecord(nativeRestored)
          : serverOperationalState.restoreDelivery(body.id);
        if (!record) {
          return NextResponse.json(
            { error: "Entrega no encontrada.", code: "NOT_FOUND" },
            { status: 404 }
          );
        }
        return NextResponse.json({
          ok: true,
          revision: serverOperationalState.getRevision(),
          record,
        });
      }
      case "annul_delivery": {
        assertBodySectorMatches(body.actorSectorId, actor.sector);
        const gate = validateDeliveryMutationActor(actor.sector);
        if (!gate.ok) {
          return NextResponse.json({ error: gate.error, code: gate.code }, { status: 403 });
        }
        const reason = normalizeOptionalReason(body.reason);
        const nativeAnnulled = await annulDeliveryDurable(
          body.id,
          reason,
          body.actorName ?? actor.displayName ?? actor.email
        );
        const record = nativeAnnulled
          ? toClientDeliveryRecord(nativeAnnulled)
          : serverOperationalState.annulDelivery(
              body.id,
              reason,
              body.actorName ?? actor.displayName ?? actor.email
            );
        if (!record) {
          return NextResponse.json(
            {
              error:
                "Entrega no encontrada, eliminada o archivada. Restaurá desde Archivados antes de anular.",
              code: "NOT_FOUND_OR_ARCHIVED",
            },
            { status: 404 }
          );
        }
        return NextResponse.json({
          ok: true,
          revision: serverOperationalState.getRevision(),
          record,
        });
      }
      case "delete_delivery_record": {
        assertBodySectorMatches(body.actorSectorId, actor.sector);
        const gate = validateDeliveryMutationActor(actor.sector);
        if (!gate.ok) {
          return NextResponse.json({ error: gate.error, code: gate.code }, { status: 403 });
        }
        const reason = normalizeOptionalReason(body.reason);
        const nativeDeleted = await deleteDeliveryRecordDurable(body.id, {
          reason,
          actorName: body.actorName ?? actor.displayName ?? actor.email,
        });
        const record = nativeDeleted
          ? toClientDeliveryRecord(nativeDeleted)
          : serverOperationalState.deleteDeliveryRecord(body.id, {
              reason,
              actorName: body.actorName ?? actor.displayName ?? actor.email,
            });
        if (!record) {
          return NextResponse.json(
            {
              error: "Entrega no encontrada o aún no archivada.",
              code: "NOT_FOUND_OR_MUST_ARCHIVE",
            },
            { status: 404 }
          );
        }
        return NextResponse.json({
          ok: true,
          revision: serverOperationalState.getRevision(),
          record,
        });
      }
      default:
        return NextResponse.json(
          { error: "Acción desconocida.", code: "UNKNOWN_ACTION" },
          { status: 400 }
        );
    }
  } catch (err) {
    if (err instanceof OrdersForbiddenError) {
      return NextResponse.json({ error: err.message, code: "ACTOR_FORBIDDEN" }, { status: 403 });
    }
    if (err instanceof Error) {
      const status = /restaur|conflict|cancelado|aprobad|rechazad/i.test(err.message)
        ? 409
        : 400;
      return NextResponse.json({ error: err.message, code: "OPERATION_FAILED" }, { status });
    }
    throw err;
  }
}
