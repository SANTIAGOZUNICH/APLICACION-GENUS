import { NextResponse } from "next/server";
import { canUseDriveAdapter } from "@/lib/api/bff-helpers";
import { getServerDataMode } from "@/lib/config/data-mode";
import { serverOperationalState } from "@/lib/live-sync/server-operational-state";
import { validateQualityDecisionActor } from "@/features/os/operational/lib/quality-decision-rbac";
import { validateWorkMutationActor } from "@/features/os/operational/lib/work-mutation-rbac";
import { validateDeliveryMutationActor } from "@/features/os/operational/lib/delivery-rbac";
import type { WorkItem } from "@/types/operational/work-item";
import type { SectorId } from "@/types/operational/sector";
import type { DeliveryRecord } from "@/features/os/operational/adapters/delivery-repository";

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
      /** Obligatorio: debe ser exactamente CALIDAD (no es auth server-side). */
      actorSectorId?: SectorId;
    }
  | {
      action: "cancel_work";
      itemId: string;
      reason: string;
      cancelledBy?: string;
      sector?: SectorId;
      /** Obligatorio: debe ser exactamente PRODUCCION. */
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

/** Mutaciones operativas — propagación inmediata vía SSE (sin esperar Sheets). */
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

  switch (body.action) {
    case "save_progress": {
      const record = serverOperationalState.saveProgress(body.itemId, {
        finishedQty: body.finishedQty,
        observation: body.observation,
        updatedBy: body.updatedBy,
        sector: body.sector,
      });
      return NextResponse.json({ ok: true, revision: serverOperationalState.getRevision(), record });
    }
    case "complete_work": {
      const result = serverOperationalState.completeWork(body.item, {
        finishedQty: body.finishedQty,
        observation: body.observation,
        completedBy: body.completedBy ?? "Operario",
      });
      return NextResponse.json({
        ok: true,
        revision: serverOperationalState.getRevision(),
        ...result,
      });
    }
    case "quality_decision": {
      // actorSectorId obligatorio y exactamente CALIDAD.
      // No reemplaza identidad autenticada server-side (el cliente podría falsificarlo).
      const gate = validateQualityDecisionActor(body.actorSectorId);
      if (!gate.ok) {
        return NextResponse.json(
          { error: gate.error, code: gate.code },
          { status: 403 }
        );
      }
      const record = serverOperationalState.decideQuality(body.itemId, body.status, {
        decidedBy: body.decidedBy,
        observation: body.observation,
      });
      return NextResponse.json({ ok: true, revision: serverOperationalState.getRevision(), record });
    }
    case "cancel_work": {
      const gate = validateWorkMutationActor(body.actorSectorId);
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
        cancelledBy: body.cancelledBy ?? "Producción",
        reason: body.reason.trim(),
        sector: body.sector,
      });
      return NextResponse.json({ ok: true, revision: serverOperationalState.getRevision(), record });
    }
    case "deliver_work": {
      const gate = validateDeliveryMutationActor(body.actorSectorId);
      if (!gate.ok) {
        return NextResponse.json({ error: gate.error, code: gate.code }, { status: 403 });
      }
      const record = serverOperationalState.deliverWork(body);
      return NextResponse.json({ ok: true, revision: serverOperationalState.getRevision(), record });
    }
    case "archive_delivery": {
      const gate = validateDeliveryMutationActor(body.actorSectorId);
      if (!gate.ok) {
        return NextResponse.json({ error: gate.error, code: gate.code }, { status: 403 });
      }
      const record = serverOperationalState.archiveDelivery(body.id, body.actorName);
      if (!record) {
        return NextResponse.json({ error: "Entrega no encontrada.", code: "NOT_FOUND" }, { status: 404 });
      }
      return NextResponse.json({ ok: true, revision: serverOperationalState.getRevision(), record });
    }
    case "restore_delivery": {
      const gate = validateDeliveryMutationActor(body.actorSectorId);
      if (!gate.ok) {
        return NextResponse.json({ error: gate.error, code: gate.code }, { status: 403 });
      }
      const record = serverOperationalState.restoreDelivery(body.id);
      if (!record) {
        return NextResponse.json({ error: "Entrega no encontrada.", code: "NOT_FOUND" }, { status: 404 });
      }
      return NextResponse.json({ ok: true, revision: serverOperationalState.getRevision(), record });
    }
    case "annul_delivery": {
      const gate = validateDeliveryMutationActor(body.actorSectorId);
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
        body.actorName
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
      return NextResponse.json({ ok: true, revision: serverOperationalState.getRevision(), record });
    }
    case "delete_delivery_record": {
      const gate = validateDeliveryMutationActor(body.actorSectorId);
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
        actorName: body.actorName,
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
      return NextResponse.json({ ok: true, revision: serverOperationalState.getRevision(), record });
    }
    default:
      return NextResponse.json({ error: "Acción desconocida.", code: "UNKNOWN_ACTION" }, { status: 400 });
  }
}
