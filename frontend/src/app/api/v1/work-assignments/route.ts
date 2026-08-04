import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { AuthUnauthorizedError } from "@/lib/auth/types";
import {
  assertProduccionActor,
  resolvePlanningActor,
} from "@/lib/planning/actor";
import {
  ensureNativePlanningReady,
  planningErrorResponse,
} from "@/lib/planning/http";
import type { PlanningSector } from "@/lib/planning/types";
import { PlanningValidationError } from "@/lib/planning/types";
import {
  logSanitizedError,
  sanitizePublicErrorMessage,
} from "@/lib/planning/sanitize-public-error";
import {
  assignWorkItemDurable,
  type WorkAssignmentInput,
} from "@/lib/planning/work-assignment-service";
import { projectNativeWorkItem } from "@/lib/planning/native-projector";
import { getPlanningService } from "@/lib/planning/get-planning-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SECTORS: PlanningSector[] = [
  "ELABORACION",
  "ENVASADO_MASIVO",
  "ENVASADO_PREMIUM",
  "CODIFICADO",
];

function parseBody(raw: unknown): WorkAssignmentInput {
  if (!raw || typeof raw !== "object") {
    throw new PlanningValidationError("Body JSON inválido.");
  }
  const body = raw as Record<string, unknown>;
  const sector = String(body.sector ?? "").trim().toUpperCase();
  if (!SECTORS.includes(sector as PlanningSector)) {
    throw new PlanningValidationError("Sector de asignación inválido.");
  }
  const idempotencyKey = String(
    body.idempotencyKey ?? body.idempotency_key ?? ""
  ).trim();
  return {
    sector: sector as PlanningSector,
    client: String(body.client ?? ""),
    product: String(body.product ?? ""),
    plannedQuantity: String(body.plannedQuantity ?? body.quantity ?? ""),
    unit: body.unit != null ? String(body.unit) : undefined,
    plannedDate: String(body.plannedDate ?? body.plannedDateFrom ?? ""),
    plannedDateTo:
      body.plannedDateTo != null ? String(body.plannedDateTo) : null,
    deliveryDate:
      body.deliveryDate != null ? String(body.deliveryDate) : null,
    line: body.line != null ? String(body.line) : null,
    branchOwner:
      body.branchOwner != null
        ? String(body.branchOwner)
        : body.ownerPerson != null
          ? String(body.ownerPerson)
          : null,
    notes: body.notes != null ? String(body.notes) : null,
    orderNumber:
      body.orderNumber != null
        ? String(body.orderNumber)
        : body.oeRef != null
          ? String(body.oeRef)
          : body.oaRef != null
            ? String(body.oaRef)
            : null,
    orderId: body.orderId != null ? String(body.orderId) : null,
    packagingLote:
      body.packagingLote != null ? String(body.packagingLote) : null,
    packagingVto:
      body.packagingVto != null ? String(body.packagingVto) : null,
    idempotencyKey,
  };
}

export async function GET(request: Request) {
  const blocked = ensureNativePlanningReady();
  if (blocked) return blocked;
  const operationId = randomUUID();
  try {
    const actor = await resolvePlanningActor(request);
    assertProduccionActor(actor);
    const items = await getPlanningService().listPublishedItems({
      sector: "PRODUCCION",
    });
    return NextResponse.json({
      operationId,
      workItems: items.map(projectNativeWorkItem),
      items,
    });
  } catch (err) {
    if (err instanceof AuthUnauthorizedError) {
      return NextResponse.json(
        {
          error: "Sesión vencida. Volvé a iniciar sesión.",
          code: "UNAUTHORIZED",
          operationId,
        },
        { status: 401 }
      );
    }
    return planningErrorResponse(err, operationId);
  }
}

export async function POST(request: Request) {
  const blocked = ensureNativePlanningReady();
  if (blocked) return blocked;

  const operationId =
    request.headers.get("x-genus-operation-id")?.trim() || randomUUID();

  try {
    const actor = await resolvePlanningActor(request);
    assertProduccionActor(actor);

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      throw new PlanningValidationError("Body JSON inválido.");
    }

    const input = parseBody(raw);
    const result = await assignWorkItemDurable(input, actor, operationId);

    return NextResponse.json(
      {
        ok: true,
        operationId: result.operationId,
        replayed: result.replayed,
        item: result.item,
        workItem: projectNativeWorkItem(result.item),
        order: result.order,
      },
      { status: result.replayed ? 200 : 201 }
    );
  } catch (err) {
    if (err instanceof AuthUnauthorizedError) {
      logSanitizedError(operationId, "work-assignments", err);
      return NextResponse.json(
        {
          error: "Sesión vencida. Volvé a iniciar sesión.",
          code: "UNAUTHORIZED",
          operationId,
        },
        { status: 401 }
      );
    }
    return planningErrorResponse(err, operationId);
  }
}
