import { NextResponse } from "next/server";
import { getAsignacionLotesService } from "@/lib/asignacion-lotes/asignacion-lotes-service";
import type {
  AsignacionLoteUpsertInput,
} from "@/lib/asignacion-lotes/types";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toActor(actor: Awaited<ReturnType<typeof resolveOrdersActor>>) {
  return {
    email: actor.email,
    sector: actor.sector,
    displayName: actor.displayName,
  };
}

function assertBodyActorSector(body: { actorSectorId?: string }, actorSector: string): void {
  if (body.actorSectorId && body.actorSectorId !== actorSector) {
    throw new OrdersForbiddenError("El sector enviado no coincide con la sesión del actor.");
  }
}

/** Listado de asignaciones (sectores Calidad, Producción, Codificado). */
export async function GET(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const url = new URL(request.url);
    const includeArchived = url.searchParams.get("includeArchived") === "1";
    const items = getAsignacionLotesService().list(toActor(actor), { includeArchived });
    return NextResponse.json({
      items,
      persistenceReady: false,
      schemaPending: true,
    });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}

/** Upsert, importación masiva o sync completo. */
export async function POST(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const body = (await request.json()) as {
      action?: "upsert" | "import" | "sync";
      actorSectorId?: string;
      record?: AsignacionLoteUpsertInput;
      rows?: AsignacionLoteUpsertInput[];
      records?: unknown[];
    };

    assertBodyActorSector(body, actor.sector);

    const svc = getAsignacionLotesService();
    const mpActor = toActor(actor);

    if (body.action === "import") {
      const rows = body.rows ?? [];
      const result = svc.import(mpActor, rows);
      return NextResponse.json({ result }, { status: 201 });
    }

    if (body.action === "sync") {
      const count = svc.replaceAll(mpActor, body.records ?? []);
      const items = svc.list(mpActor, { includeArchived: true });
      return NextResponse.json({ ok: true, count, items });
    }

    if (!body.record) {
      throw new OrdersValidationError("record es obligatorio para upsert.");
    }

    const item = svc.upsert(mpActor, {
      ...body.record,
      updatedBy: body.record.updatedBy || actor.displayName,
      createdBy: body.record.createdBy ?? actor.displayName,
    });
    return NextResponse.json({ item }, { status: body.record.id ? 200 : 201 });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
