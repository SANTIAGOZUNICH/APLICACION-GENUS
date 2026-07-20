import { NextResponse } from "next/server";
import { canUseDriveAdapter } from "@/lib/api/bff-helpers";
import { getServerDataMode } from "@/lib/config/data-mode";
import { serverOperationalState } from "@/lib/live-sync/server-operational-state";
import { validateQualityDecisionActor } from "@/features/os/operational/lib/quality-decision-rbac";
import type { WorkItem } from "@/types/operational/work-item";
import type { SectorId } from "@/types/operational/sector";

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
    default:
      return NextResponse.json({ error: "Acción desconocida.", code: "UNKNOWN_ACTION" }, { status: 400 });
  }
}
