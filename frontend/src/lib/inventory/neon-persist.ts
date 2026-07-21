/**
 * Hidrata / persiste el MemoryInventoryRepo en tablas Neon (payload JSON).
 */
import "server-only";

import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import {
  invAjustes,
  invAudit,
  invMeAlertReads,
  invMeAlerts,
  invMeIngresos,
  invMeMaterials,
  invMeSalidas,
  invMpCompras,
  invMpControl,
  invMpIngresos,
  invMpStock,
} from "@/lib/db/schema";
import type { MemoryInventoryRepo, StockAjuste } from "./memory-repo";
import type {
  InventoryAudit,
  MeAlert,
  MeAlertRead,
  MeIngresoRow,
  MeMaterial,
  MeSalidaRow,
  MpCompraRow,
  MpControlRow,
  MpIngresoRow,
  MpStockRow,
} from "./types";

let hydrated = false;

export async function hydrateInventoryFromNeon(repo: MemoryInventoryRepo): Promise<void> {
  if (!isDatabaseConfigured() || hydrated) return;
  const db = getDb();

  const [
    ingresos,
    salidas,
    materials,
    alerts,
    reads,
    mpStock,
    mpIngresos,
    mpControl,
    mpCompras,
    ajustes,
    audit,
  ] = await Promise.all([
    db.select().from(invMeIngresos),
    db.select().from(invMeSalidas),
    db.select().from(invMeMaterials),
    db.select().from(invMeAlerts),
    db.select().from(invMeAlertReads),
    db.select().from(invMpStock),
    db.select().from(invMpIngresos),
    db.select().from(invMpControl),
    db.select().from(invMpCompras),
    db.select().from(invAjustes),
    db.select().from(invAudit),
  ]);

  repo.reset();
  repo.meIngresos = ingresos.map((r) => r.payload as MeIngresoRow);
  repo.meSalidas = salidas.map((r) => r.payload as MeSalidaRow);
  repo.meMaterials = materials.map((r) => r.payload as MeMaterial);
  repo.meAlerts = alerts.map((r) => r.payload as MeAlert);
  repo.meAlertReads = reads.map((r) => r.payload as MeAlertRead);
  repo.mpStock = mpStock.map((r) => r.payload as MpStockRow);
  repo.mpIngresos = mpIngresos.map((r) => r.payload as MpIngresoRow);
  repo.mpControl = mpControl.map((r) => r.payload as MpControlRow);
  repo.mpCompras = mpCompras.map((r) => r.payload as MpCompraRow);
  repo.ajustes = ajustes.map((r) => r.payload as StockAjuste);
  repo.audit = audit.map((r) => r.payload as InventoryAudit);
  hydrated = true;
}

export function resetInventoryHydrationFlag() {
  hydrated = false;
}

export async function persistInventorySnapshot(repo: MemoryInventoryRepo): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const db = getDb();

  await db.delete(invMeIngresos);
  await db.delete(invMeSalidas);
  await db.delete(invMeMaterials);
  await db.delete(invMeAlerts);
  await db.delete(invMeAlertReads);
  await db.delete(invMpStock);
  await db.delete(invMpIngresos);
  await db.delete(invMpControl);
  await db.delete(invMpCompras);
  await db.delete(invAjustes);
  await db.delete(invAudit);

  if (repo.meIngresos.length) {
    await db.insert(invMeIngresos).values(
      repo.meIngresos.map((r) => ({ id: r.id, payload: r, updatedAt: new Date() }))
    );
  }
  if (repo.meSalidas.length) {
    await db.insert(invMeSalidas).values(
      repo.meSalidas.map((r) => ({ id: r.id, payload: r, updatedAt: new Date() }))
    );
  }
  if (repo.meMaterials.length) {
    await db.insert(invMeMaterials).values(
      repo.meMaterials.map((r) => ({ id: r.id, payload: r, updatedAt: new Date() }))
    );
  }
  if (repo.meAlerts.length) {
    await db.insert(invMeAlerts).values(
      repo.meAlerts.map((r) => ({ id: r.id, payload: r, updatedAt: new Date() }))
    );
  }
  if (repo.meAlertReads.length) {
    await db.insert(invMeAlertReads).values(
      repo.meAlertReads.map((r) => ({
        alertId: r.alertId,
        actorEmail: r.actorEmail,
        payload: r,
        updatedAt: new Date(),
      }))
    );
  }
  if (repo.mpStock.length) {
    await db.insert(invMpStock).values(
      repo.mpStock.map((r) => ({ id: r.id, payload: r, updatedAt: new Date() }))
    );
  }
  if (repo.mpIngresos.length) {
    await db.insert(invMpIngresos).values(
      repo.mpIngresos.map((r) => ({ id: r.id, payload: r, updatedAt: new Date() }))
    );
  }
  if (repo.mpControl.length) {
    await db.insert(invMpControl).values(
      repo.mpControl.map((r) => ({ id: r.id, payload: r, updatedAt: new Date() }))
    );
  }
  if (repo.mpCompras.length) {
    await db.insert(invMpCompras).values(
      repo.mpCompras.map((r) => ({ id: r.id, payload: r, updatedAt: new Date() }))
    );
  }
  if (repo.ajustes.length) {
    await db.insert(invAjustes).values(
      repo.ajustes.map((r) => ({ id: r.id, payload: r, createdAt: new Date(r.createdAt) }))
    );
  }
  if (repo.audit.length) {
    await db.insert(invAudit).values(
      repo.audit.map((r) => ({ id: r.id, payload: r, createdAt: new Date(r.createdAt) }))
    );
  }
}
