import "server-only";

import { randomUUID } from "node:crypto";
import type { NextResponse } from "next/server";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { osNotifications } from "@/lib/db/schema";
import { getInventoryService, memoryInventoryRepo } from "./get-inventory-service";
import { ensureInventoryPersistenceReady } from "./http";
import { hydrateInventoryFromNeon, refreshMpInventoryFromNeon } from "./neon-persist";
import { ME_ALERT_NOTIFY_SECTORS } from "./rbac";

/** Hidrata el repo desde Neon y cablea notificaciones. Compartido por las rutas de inventario. */
export async function readyInventoryService(): Promise<
  { blocked: NextResponse } | { service: ReturnType<typeof getInventoryService> }
> {
  const blocked = ensureInventoryPersistenceReady();
  if (blocked) return { blocked } as const;
  await hydrateInventoryFromNeon(memoryInventoryRepo, { force: true });
  await refreshMpInventoryFromNeon(memoryInventoryRepo);
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
        deletedBy: [],
        createdAt: new Date(),
      });
    } catch (err) {
      console.warn("[inventory] notify failed", err);
    }
  });
  return { service } as const;
}
