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
let hydratePromise: Promise<void> | null = null;

export async function hydrateInventoryFromNeon(repo: MemoryInventoryRepo): Promise<void> {
  if (!isDatabaseConfigured()) return;
  if (hydrated) return;
  if (hydratePromise) {
    await hydratePromise;
    return;
  }
  hydratePromise = (async () => {
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
    repo.mpStock = mpStock.map((r) => normalizeMpStockPayload(r.payload));
    repo.mpIngresos = mpIngresos.map((r) => normalizeMpIngresoPayload(r.payload));
    repo.mpControl = mpControl.map((r) => r.payload as MpControlRow);
    repo.mpCompras = mpCompras.map((r) => r.payload as MpCompraRow);
    repo.ajustes = ajustes.map((r) => r.payload as StockAjuste);
    repo.audit = audit.map((r) => r.payload as InventoryAudit);
    hydrated = true;
  })();
  try {
    await hydratePromise;
  } finally {
    hydratePromise = null;
  }
}

function normalizeMpIngresoPayload(raw: unknown): MpIngresoRow {
  const r = raw as Partial<MpIngresoRow>;
  const status = r.status === "CONFIRMADO" || r.status === "ANULADO" || r.status === "BORRADOR"
    ? r.status
    : r.stockImpacted
      ? "CONFIRMADO"
      : "BORRADOR";
  return {
    id: String(r.id ?? ""),
    fecha: r.fecha ?? "",
    ingresoNro: r.ingresoNro ?? "",
    proveedor: r.proveedor ?? "",
    cliente: r.cliente ?? "",
    remitoNro: r.remitoNro ?? "",
    codigo: r.codigo ?? "",
    codigoPendiente: Boolean(r.codigoPendiente),
    producto: r.producto ?? "",
    descripcion: r.descripcion ?? "",
    bultos: r.bultos ?? null,
    cantidad: r.cantidad ?? null,
    total: r.total ?? null,
    ubicacion: r.ubicacion ?? "",
    lote: r.lote ?? "",
    vencimiento: r.vencimiento ?? "",
    stockLotId: r.stockLotId ?? null,
    status,
    stockImpacted: Boolean(r.stockImpacted),
    stockMessage: r.stockMessage,
    createdBy: r.createdBy ?? "",
    updatedBy: r.updatedBy ?? "",
    createdAt: r.createdAt ?? "",
    updatedAt: r.updatedAt ?? "",
  };
}

function normalizeMpStockPayload(raw: unknown): MpStockRow {
  const r = raw as Partial<MpStockRow>;
  return {
    id: String(r.id ?? ""),
    proveedor: r.proveedor ?? "",
    cliente: r.cliente ?? "",
    descripcion: r.descripcion ?? "",
    cantidadKg: r.cantidadKg ?? null,
    ubicacion: r.ubicacion ?? "",
    lote: r.lote ?? "",
    vencimiento: r.vencimiento ?? "",
    estadoStock: r.estadoStock ?? "",
    diasAlVence: r.diasAlVence ?? null,
    estadoVencimiento: r.estadoVencimiento ?? "",
    origen: r.origen ?? "",
    codigo: r.codigo ?? "",
    codigoPendiente: Boolean(r.codigoPendiente),
    productosAsociados: r.productosAsociados ?? "",
    createdBy: r.createdBy ?? "",
    updatedBy: r.updatedBy ?? "",
    createdAt: r.createdAt ?? "",
    updatedAt: r.updatedAt ?? "",
  };
}

/**
 * Relee solo MP stock + ingresos desde Neon en cada request.
 * Evita split-brain entre instancias serverless (tabla Stock UI vs Ingresos).
 */
export async function refreshMpInventoryFromNeon(
  repo: MemoryInventoryRepo
): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const db = getDb();
  const [mpStock, mpIngresos] = await Promise.all([
    db.select().from(invMpStock),
    db.select().from(invMpIngresos),
  ]);
  repo.mpStock = mpStock.map((r) => normalizeMpStockPayload(r.payload));
  repo.mpIngresos = mpIngresos.map((r) => normalizeMpIngresoPayload(r.payload));
}

export function resetInventoryHydrationFlag() {
  hydrated = false;
  hydratePromise = null;
}

/** Persiste un ingreso MP sin wipe-all (idempotente). */
export async function persistMpIngresoRow(row: MpIngresoRow): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const db = getDb();
  await db
    .insert(invMpIngresos)
    .values({ id: row.id, payload: row, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: invMpIngresos.id,
      set: { payload: row, updatedAt: new Date() },
    });
}

/** Persiste un lote de stock MP sin wipe-all. */
export async function persistMpStockRow(row: MpStockRow): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const db = getDb();
  await db
    .insert(invMpStock)
    .values({ id: row.id, payload: row, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: invMpStock.id,
      set: { payload: row, updatedAt: new Date() },
    });
}

/** Sincroniza todos los lotes MP en memoria (tras delta de ingreso). */
export async function persistMpStockSnapshot(rows: MpStockRow[]): Promise<void> {
  if (!isDatabaseConfigured() || rows.length === 0) return;
  const db = getDb();
  for (const row of rows) {
    await persistMpStockRow(row);
  }
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
