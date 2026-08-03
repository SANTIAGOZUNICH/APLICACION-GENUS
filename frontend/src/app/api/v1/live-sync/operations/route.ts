import { NextResponse } from "next/server";
import { canUseDriveAdapter } from "@/lib/api/bff-helpers";
import { getServerDataMode } from "@/lib/config/data-mode";
import { serverOperationalState } from "@/lib/live-sync/server-operational-state";
import { validateQualityDecisionActor } from "@/features/os/operational/lib/quality-decision-rbac";
import { validateWorkMutationActor } from "@/features/os/operational/lib/work-mutation-rbac";
import { validateDeliveryMutationActor } from "@/features/os/operational/lib/delivery-rbac";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";
import type { WorkItem } from "@/types/operational/work-item";
import type { SectorId } from "@/types/operational/sector";
import type { DeliveryRecord } from "@/features/os/operational/adapters/delivery-repository";
import { notifyEnvasadoForApproval } from "@/lib/notifications/approval-envasado-notify";

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
    }
  | {
      action: "complete_work";
      item: WorkItem;
      finishedQty: string;
      observation: string;
      completedBy?: string;
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
        const record = serverOperationalState.decideQuality(body.itemId, body.status, {
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
        if (!body.reason?.trim()) {
          return NextResponse.json(
            { error: "Motivo obligatorio para anular la decisión.", code: "REASON_REQUIRED" },
            { status: 400 }
          );
        }
        const record = serverOperationalState.annulQualityDecision(body.itemId, {
          reason: body.reason.trim(),
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
      case "cancel_work": {
        assertBodySectorMatches(body.actorSectorId, actor.sector);
        const gate = validateWorkMutationActor(actor.sector);
        if (!gate.ok) {
          return NextResponse.json({ error: gate.error, code: gate.code }, { status: 403 });
        }
        if (!body.reason?.trim()) {
          return NextResponse.json(
            { error: "El motivo de cancelación es obligatorio.", code: "REASON_REQUIRED" },
            { status: 400 }
          );
        }
        const record = serverOperationalState.cancelWork(body.itemId, {
          cancelledBy: body.cancelledBy ?? actor.displayName ?? actor.email,
          reason: body.reason.trim(),
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
        const record = serverOperationalState.restoreCancelledWork(body.itemId, {
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
      case "deliver_work": {
        assertBodySectorMatches(body.actorSectorId, actor.sector);
        const gate = validateDeliveryMutationActor(actor.sector);
        if (!gate.ok) {
          return NextResponse.json({ error: gate.error, code: gate.code }, { status: 403 });
        }
        const record = serverOperationalState.deliverWork(body);
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
        const record = serverOperationalState.archiveDelivery(
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
        const record = serverOperationalState.restoreDelivery(body.id);
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
        if (!body.reason?.trim()) {
          return NextResponse.json(
            { error: "El motivo de anulación es obligatorio.", code: "REASON_REQUIRED" },
            { status: 400 }
          );
        }
        const record = serverOperationalState.annulDelivery(
          body.id,
          body.reason.trim(),
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
        if (!body.reason?.trim()) {
          return NextResponse.json(
            { error: "El motivo de eliminación es obligatorio.", code: "REASON_REQUIRED" },
            { status: 400 }
          );
        }
        const record = serverOperationalState.deleteDeliveryRecord(body.id, {
          reason: body.reason.trim(),
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
