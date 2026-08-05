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

export async function hydrateInventoryFromNeon(
  repo: MemoryInventoryRepo,
  options: { force?: boolean } = {}
): Promise<void> {
  if (!isDatabaseConfigured()) return;
  if (hydrated && !options.force) return;
  if (hydratePromise) {
    await hydratePromise;
    if (hydrated && !options.force) return;
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
    repo.meMaterials = materials.map((r) => {
      const p = r.payload as MeMaterial;
      return {
        ...p,
        archived: Boolean(p.archived),
        archivedAt: p.archivedAt ?? null,
        archivedBy: p.archivedBy ?? null,
        archivedReason: p.archivedReason ?? null,
      };
    });
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
    pccMeNro: r.pccMeNro ?? "",
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
    archived: Boolean(r.archived),
    archivedAt: r.archivedAt ?? null,
    archivedBy: r.archivedBy ?? null,
    archivedReason: r.archivedReason ?? null,
    createdBy: r.createdBy ?? "",
    updatedBy: r.updatedBy ?? "",
    createdAt: r.createdAt ?? "",
    updatedAt: r.updatedAt ?? "",
  };
}

/**
 * Relee MP stock + ingresos desde Neon.
 * Deduplica requests concurrentes (sin TTL temporal) para no reintroducir
 * split-brain entre lambdas tras un ingreso MP.
 */
let mpRefreshInFlight: Promise<void> | null = null;

export async function refreshMpInventoryFromNeon(
  repo: MemoryInventoryRepo,
  options?: { force?: boolean }
): Promise<void> {
  if (!isDatabaseConfigured()) return;
  if (!options?.force && mpRefreshInFlight) {
    await mpRefreshInFlight;
    return;
  }
  const run = (async () => {
    const db = getDb();
    const [mpStock, mpIngresos] = await Promise.all([
      db.select().from(invMpStock),
      db.select().from(invMpIngresos),
    ]);
    repo.mpStock = mpStock.map((r) => normalizeMpStockPayload(r.payload));
    repo.mpIngresos = mpIngresos.map((r) => normalizeMpIngresoPayload(r.payload));
  })();
  mpRefreshInFlight = run;
  try {
    await run;
  } finally {
    if (mpRefreshInFlight === run) mpRefreshInFlight = null;
  }
}

export function resetInventoryHydrationFlag() {
  hydrated = false;
  hydratePromise = null;
  mpRefreshInFlight = null;
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

/**
 * Persiste snapshot sin wipe-and-replace.
 * Solo upsert por id — soft-delete/archive queda en payload.
 * Evita que un POST concurrente reinstale o borre filas ajenas.
 */
export async function persistInventorySnapshot(repo: MemoryInventoryRepo): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const db = getDb();
  const now = new Date();

  async function upsertIdPayload(
    table:
      | typeof invMeIngresos
      | typeof invMeSalidas
      | typeof invMeMaterials
      | typeof invMeAlerts
      | typeof invMpStock
      | typeof invMpIngresos
      | typeof invMpControl
      | typeof invMpCompras,
    rows: Array<{ id: string }>
  ) {
    for (const row of rows) {
      await db
        .insert(table)
        .values({ id: row.id, payload: row, updatedAt: now } as never)
        .onConflictDoUpdate({
          target: table.id,
          set: { payload: row as never, updatedAt: now },
        });
    }
  }

  await upsertIdPayload(invMeIngresos, repo.meIngresos);
  await upsertIdPayload(invMeSalidas, repo.meSalidas);
  await upsertIdPayload(invMeMaterials, repo.meMaterials);
  await upsertIdPayload(invMeAlerts, repo.meAlerts);
  await upsertIdPayload(invMpStock, repo.mpStock);
  await upsertIdPayload(invMpIngresos, repo.mpIngresos);
  await upsertIdPayload(invMpControl, repo.mpControl);
  await upsertIdPayload(invMpCompras, repo.mpCompras);

  for (const row of repo.meAlertReads) {
    await db
      .insert(invMeAlertReads)
      .values({
        alertId: row.alertId,
        actorEmail: row.actorEmail,
        payload: row,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [invMeAlertReads.alertId, invMeAlertReads.actorEmail],
        set: { payload: row, updatedAt: now },
      });
  }

  for (const row of repo.ajustes) {
    await db
      .insert(invAjustes)
      .values({ id: row.id, payload: row, createdAt: new Date(row.createdAt) })
      .onConflictDoUpdate({
        target: invAjustes.id,
        set: { payload: row },
      });
  }
  for (const row of repo.audit) {
    await db
      .insert(invAudit)
      .values({ id: row.id, payload: row, createdAt: new Date(row.createdAt) })
      .onConflictDoUpdate({
        target: invAudit.id,
        set: { payload: row },
      });
  }
}
