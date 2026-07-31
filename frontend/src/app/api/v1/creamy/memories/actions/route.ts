import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";
import { getCreamyMemoryService } from "@/lib/creamy-memory/get-creamy-memory-service";
import {
  CreamyMemoryForbiddenError,
  CreamyMemoryNotFoundError,
  CreamyMemoryValidationError,
  type CorrectOperationalMemoryPatch,
} from "@/lib/creamy-memory/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MemoryActionKind = "confirm" | "correct" | "forget" | "validate" | "revoke";

interface MemoryActionBody {
  action: MemoryActionKind;
  memoryId: string;
  patch?: CorrectOperationalMemoryPatch;
  reason?: string;
}

const VALID_ACTIONS: ReadonlySet<string> = new Set(["confirm", "correct", "forget", "validate", "revoke"]);

function badRequest(error: string, code: string) {
  return NextResponse.json({ error, code }, { status: 400 });
}

function errorResponse(err: unknown) {
  if (err instanceof CreamyMemoryForbiddenError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  }
  if (err instanceof CreamyMemoryNotFoundError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  }
  if (err instanceof CreamyMemoryValidationError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  }
  if (err instanceof OrdersForbiddenError || err instanceof OrdersValidationError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  }
  console.error("[creamy-memory-actions] error inesperado:", err);
  return NextResponse.json(
    { error: "Error inesperado al procesar la acción.", code: "CREAMY_MEMORY_UNEXPECTED" },
    { status: 500 }
  );
}

/**
 * Acciones sobre memoria de Creamy (personal y operativa).
 * Auth vía header x-genus-actor-email (mismo patrón que /api/v1/orders — resolveOrdersActor).
 * Toda acción queda auditada en creamy_memory_audit_events (o su equivalente en memoria
 * de proceso mientras la migración 0015 no esté aplicada).
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Body JSON inválido.", "INVALID_JSON");
  }

  const record = body as Partial<MemoryActionBody> | null;
  if (!record || typeof record !== "object") {
    return badRequest("Body inválido.", "INVALID_BODY");
  }
  if (typeof record.action !== "string" || !VALID_ACTIONS.has(record.action)) {
    return badRequest("action inválida (confirm|correct|forget|validate|revoke).", "INVALID_ACTION");
  }
  if (typeof record.memoryId !== "string" || !record.memoryId.trim()) {
    return badRequest("memoryId es obligatorio.", "MEMORY_ID_REQUIRED");
  }

  try {
    const ordersActor = resolveOrdersActor(request);
    const memoryActor = { email: ordersActor.email, sector: ordersActor.sector };
    const service = getCreamyMemoryService();
    const memoryId = record.memoryId.trim();

    switch (record.action as MemoryActionKind) {
      case "confirm": {
        const memory = await service.confirmUserMemory(memoryActor, memoryId);
        return NextResponse.json({ memory });
      }
      case "forget": {
        const memory = await service.softDeleteUserMemory(memoryActor, memoryActor.email, memoryId);
        return NextResponse.json({ memory });
      }
      case "validate": {
        const memory = await service.validateOperationalMemory(memoryActor, memoryId);
        return NextResponse.json({ memory });
      }
      case "revoke": {
        const memory = await service.revokeOperationalMemory(memoryActor, memoryId, record.reason);
        return NextResponse.json({ memory });
      }
      case "correct": {
        const memory = await service.correctOperationalMemory(memoryActor, memoryId, record.patch ?? {});
        return NextResponse.json({ memory });
      }
      default:
        return badRequest("action inválida.", "INVALID_ACTION");
    }
  } catch (err) {
    return errorResponse(err);
  }
}
