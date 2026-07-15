import { NextResponse } from "next/server";
import {
  resolvePlanningActor,
} from "@/lib/planning/actor";
import {
  ensureNativePlanningReady,
  planningErrorResponse,
} from "@/lib/planning/http";
import {
  completeNativeWork,
  decideNativeQuality,
  saveNativeProgress,
} from "@/lib/planning/progress-service";
import { toNativeWorkItemId } from "@/lib/planning/native-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body =
  | {
      action: "save_progress";
      itemId: string;
      finishedQty: string;
      observation?: string;
    }
  | {
      action: "complete_work";
      itemId: string;
      finishedQty: string;
      observation?: string;
    }
  | {
      action: "quality_decision";
      itemId: string;
      status: "aprobado" | "rechazado";
      observation?: string;
    };

/**
 * Mutaciones operativas persistidas en Postgres (source=native).
 * Avance · Entrega a Calidad · Aprobación/Rechazo.
 */
export async function POST(request: Request) {
  const blocked = ensureNativePlanningReady();
  if (blocked) return blocked;

  try {
    const actor = resolvePlanningActor(request);
    const body = (await request.json()) as Body;

    if (body.action === "save_progress") {
      const item = await saveNativeProgress(
        body.itemId,
        {
          finishedQty: body.finishedQty,
          observation: body.observation ?? "",
        },
        actor
      );
      return NextResponse.json({
        ok: true,
        item: { ...item, id: toNativeWorkItemId(item.id) },
      });
    }

    if (body.action === "complete_work") {
      const item = await completeNativeWork(
        body.itemId,
        {
          finishedQty: body.finishedQty,
          observation: body.observation ?? "",
        },
        actor
      );
      return NextResponse.json({
        ok: true,
        item: { ...item, id: toNativeWorkItemId(item.id) },
      });
    }

    if (body.action === "quality_decision") {
      if (body.status !== "aprobado" && body.status !== "rechazado") {
        return NextResponse.json(
          { error: "status inválido.", code: "VALIDATION_ERROR" },
          { status: 400 }
        );
      }
      const item = await decideNativeQuality(
        body.itemId,
        body.status,
        { observation: body.observation },
        actor
      );
      return NextResponse.json({
        ok: true,
        item: { ...item, id: toNativeWorkItemId(item.id) },
      });
    }

    return NextResponse.json(
      { error: "Acción no soportada.", code: "INVALID_ACTION" },
      { status: 400 }
    );
  } catch (err) {
    return planningErrorResponse(err);
  }
}
