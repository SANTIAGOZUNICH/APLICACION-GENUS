import { NextResponse } from "next/server";
import { getGranelesService } from "@/lib/graneles/graneles-service";
import type {
  CreateManualGranelInput,
  GranelStatus,
  UpsertGranelFromEnvasadoInput,
} from "@/lib/graneles/types";
import { GRANEL_STATUSES } from "@/lib/graneles/types";
import { isDatabaseConfigured } from "@/lib/db/client";
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

function isGranelStatus(value: string | null): value is GranelStatus {
  return Boolean(value) && (GRANEL_STATUSES as readonly string[]).includes(value as string);
}

/** Listado de sobrantes de granel (Depósito + sectores relacionados). */
export async function GET(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const url = new URL(request.url);
    const includeAnnulled = url.searchParams.get("includeAnnulled") === "1";
    const statusParam = url.searchParams.get("status");
    const status = isGranelStatus(statusParam) ? statusParam : undefined;
    const items = await getGranelesService().list(toActor(actor), { includeAnnulled, status });
    return NextResponse.json({
      items,
      persistenceReady: isDatabaseConfigured(),
      schemaPending: !isDatabaseConfigured(),
    });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}

/** Alta manual (Depósito) o upsert idempotente desde Envasado. */
export async function POST(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const body = (await request.json()) as {
      action?: "createManual" | "upsertFromEnvasado";
      actorSectorId?: string;
      record?: CreateManualGranelInput;
      envasado?: UpsertGranelFromEnvasadoInput;
    };

    assertBodyActorSector(body, actor.sector);

    const svc = getGranelesService();
    const mpActor = toActor(actor);

    if (body.action === "upsertFromEnvasado") {
      if (!body.envasado) {
        throw new OrdersValidationError("envasado es obligatorio para upsertFromEnvasado.");
      }
      const result = await svc.upsertFromEnvasado(mpActor, body.envasado);
      return NextResponse.json(
        { record: result.record, created: result.created, duplicated: result.duplicated },
        { status: result.created ? 201 : 200 }
      );
    }

    if (!body.record) {
      throw new OrdersValidationError("record es obligatorio para createManual.");
    }
    const record = await svc.createManual(mpActor, body.record);
    return NextResponse.json({ record }, { status: 201 });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
