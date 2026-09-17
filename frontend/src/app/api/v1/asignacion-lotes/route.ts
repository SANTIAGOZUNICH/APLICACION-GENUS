import { after, NextResponse } from "next/server";
import { getAsignacionLotesService } from "@/lib/asignacion-lotes/asignacion-lotes-service";
import type {
  AsignacionLoteUpsertInput,
} from "@/lib/asignacion-lotes/types";
import { isDatabaseConfigured } from "@/lib/db/client";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";
import { getAsignacionLoteSourcesService } from "@/lib/asignacion-lotes/asignacion-lote-sources-service";
import { isDueForOpportunisticSync, syncSource } from "@/lib/asignacion-lotes/asignacion-lotes-sync-service";

/**
 * Sync oportunista (pedido #6): en vez de un cron cada pocos minutos
 * (Vercel Cron en plan Hobby solo permite 1 vez/día), cada vez que alguien
 * abre/refresca Asignación de Lotes se aprovecha ese request para
 * sincronizar las fuentes que ya pasaron su intervalo mínimo — con
 * `after()` para no demorar la respuesta al usuario. Best-effort: un fallo
 * acá nunca puede romper el listado que ya se está devolviendo.
 */
const OPPORTUNISTIC_SYNC_MIN_INTERVAL_MS = 3 * 60 * 1000;

function scheduleOpportunisticSync(): void {
  // `after()` lanza sincrónicamente fuera de un request real de Next.js
  // (por ejemplo, al invocar el handler directo en un test unitario) — eso
  // nunca puede tumbar el listado que esta misma función ya devolvió.
  try {
    after(async () => {
      try {
        const sources = await getAsignacionLoteSourcesService().listEnabledForSync();
        const due = sources.filter((s) => isDueForOpportunisticSync(s, OPPORTUNISTIC_SYNC_MIN_INTERVAL_MS));
        for (const source of due) {
          await syncSource(source, "opportunistic", "opportunistic");
        }
      } catch {
        // No-op: el listado ya se respondió; la próxima carga vuelve a intentar.
      }
    });
  } catch {
    // No-op: fuera de request scope (tests, invocación directa del handler).
  }
}

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
    const items = await getAsignacionLotesService().list(toActor(actor), { includeArchived });
    scheduleOpportunisticSync();
    return NextResponse.json({
      items,
      persistenceReady: isDatabaseConfigured(),
      schemaPending: !isDatabaseConfigured(),
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
      const result = await svc.import(mpActor, rows);
      return NextResponse.json({ result }, { status: 201 });
    }

    if (body.action === "sync") {
      const count = await svc.replaceAll(mpActor, body.records ?? []);
      const items = await svc.list(mpActor, { includeArchived: true });
      return NextResponse.json({ ok: true, count, items });
    }

    if (!body.record) {
      throw new OrdersValidationError("record es obligatorio para upsert.");
    }

    const item = await svc.upsert(mpActor, {
      ...body.record,
      updatedBy: body.record.updatedBy || actor.displayName,
      createdBy: body.record.createdBy ?? actor.displayName,
    });
    return NextResponse.json({ item }, { status: body.record.id ? 200 : 201 });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
