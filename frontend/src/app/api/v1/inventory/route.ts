import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { osNotifications } from "@/lib/db/schema";
import { getInventoryService, memoryInventoryRepo } from "@/lib/inventory/get-inventory-service";
import {
  ensureInventoryPersistenceReady,
  inventoryErrorResponse,
  resolveInventoryActor,
} from "@/lib/inventory/http";
import { hydrateInventoryFromNeon, persistInventorySnapshot } from "@/lib/inventory/neon-persist";
import type { InventoryActor } from "@/lib/inventory/inventory-service";
import { ME_ALERT_NOTIFY_SECTORS } from "@/lib/inventory/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readyService() {
  const blocked = ensureInventoryPersistenceReady();
  if (blocked) return { blocked } as const;
  await hydrateInventoryFromNeon(memoryInventoryRepo);
  const service = getInventoryService();
  service.onNotify(async (payload) => {
    if (!isDatabaseConfigured()) return;
    try {
      const db = getDb();
      await db.insert(osNotifications).values({
        id: randomUUID(),
        kind: payload.kind,
        title: payload.title,
        message: payload.message,
        sectors: payload.sectors.length ? payload.sectors : ME_ALERT_NOTIFY_SECTORS,
        href: payload.href ?? null,
        orderId: null,
        readBy: [],
        dismissedBy: [],
        createdAt: new Date(),
      });
    } catch (err) {
      console.warn("[inventory] notify failed", err);
    }
  });
  return { service } as const;
}

export async function GET(request: Request) {
  try {
    const ready = await readyService();
    if ("blocked" in ready) return ready.blocked;
    const actor = resolveInventoryActor(request);
    const { searchParams } = new URL(request.url);
    const resource = searchParams.get("resource") ?? "me_ingresos";
    const data = await listResource(ready.service, actor, resource);
    return NextResponse.json({ data, persistence: true });
  } catch (err) {
    return inventoryErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ready = await readyService();
    if ("blocked" in ready) return ready.blocked;
    const actor = resolveInventoryActor(request);
    const body = (await request.json()) as {
      action: string;
      resource: string;
      payload?: Record<string, unknown>;
      id?: string;
      reason?: string;
    };

    if (body.resource === "semanas" && body.action !== "list") {
      ready.service.assertCanMutateSemanas(actor);
    }

    const result = await mutateResource(ready.service, actor, body);
    await persistInventorySnapshot(memoryInventoryRepo);
    return NextResponse.json({ data: result, persistence: true });
  } catch (err) {
    return inventoryErrorResponse(err);
  }
}

async function listResource(
  service: ReturnType<typeof getInventoryService>,
  actor: InventoryActor,
  resource: string
) {
  switch (resource) {
    case "me_ingresos":
      return service.listMeIngresos(actor);
    case "me_salidas":
      return service.listMeSalidas(actor);
    case "me_stock":
      return service.listMeMaterials(actor);
    case "me_avisos":
      return service.listMeAlerts(actor);
    case "mp_stock":
      return service.listMpStock(actor);
    case "mp_ingresos":
      return service.listMpIngresos(actor);
    case "mp_control":
      return service.listMpControl(actor);
    case "mp_compras":
      return service.listMpCompras(actor);
    default:
      throw Object.assign(new Error(`Recurso desconocido: ${resource}`), { status: 400 });
  }
}

async function mutateResource(
  service: ReturnType<typeof getInventoryService>,
  actor: InventoryActor,
  body: {
    action: string;
    resource: string;
    payload?: Record<string, unknown>;
    id?: string;
    reason?: string;
  }
) {
  const { action, resource, payload = {}, id, reason } = body;

  switch (`${resource}:${action}`) {
    case "me_ingresos:upsert":
      return service.upsertMeIngreso(actor, payload as never);
    case "me_ingresos:delete":
      return service.deleteMeIngreso(actor, id!, reason ?? "");
    case "me_salidas:upsert":
      return service.upsertMeSalida(actor, payload as never);
    case "me_salidas:delete":
      return service.deleteMeSalida(actor, id!, reason ?? "");
    case "me_stock:adjust":
      return service.adjustMeStock(
        actor,
        id!,
        Number(payload.cantidadNueva),
        String(payload.motivo ?? reason ?? "")
      );
    case "me_stock:thresholds":
      return service.updateMeThresholds(actor, id!, payload as never);
    case "me_avisos:create":
      return service.createManualAlert(actor, payload as never);
    case "me_avisos:patch":
      return service.patchMeAlert(actor, id!, payload as never);
    case "me_avisos:read":
      return service.markAlertRead(actor, id!);
    case "me_avisos:dismiss":
      return service.dismissAlertForUser(actor, id!);
    case "mp_stock:upsert":
      return service.upsertMpStock(actor, payload as never);
    case "mp_stock:delete":
      return service.deleteMpStock(actor, id!, reason ?? "");
    case "mp_stock:adjust":
      return service.adjustMpStock(
        actor,
        id!,
        Number(payload.cantidadNueva),
        String(payload.motivo ?? reason ?? "")
      );
    case "mp_ingresos:upsert":
      return service.upsertMpIngreso(actor, payload as never);
    case "mp_ingresos:delete":
      return service.deleteMpIngreso(actor, id!, reason ?? "");
    case "mp_control:upsert":
      return service.upsertMpControl(actor, payload as never);
    case "mp_control:delete":
      return service.deleteMpControl(actor, id!);
    case "mp_compras:upsert":
      return service.upsertMpCompra(actor, payload as never);
    case "mp_compras:delete":
      return service.deleteMpCompra(actor, id!);
    case "mp_compras:link_ingreso":
      return service.linkCompraToIngreso(actor, id!, String(payload.ingresoId));
    default:
      throw Object.assign(new Error(`Acción no soportada: ${resource}:${action}`), {
        status: 400,
      });
  }
}
