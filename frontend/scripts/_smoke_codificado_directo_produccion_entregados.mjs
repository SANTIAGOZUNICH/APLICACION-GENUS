/**
 * Smoke E2E multi-PC/cold-start — los 3 bugs reportados en uso real:
 *  1) Producción → Codificado directo (sin pasar por Envasado) debe poder
 *     editarse/completarse en Codificado.
 *  2) Producción debe poder ver TODO lo que cargó Codificado (distribución
 *     de cajas, muestras, entregable, lote/VTO, OA, observaciones).
 *  3) Entregados NO debe mostrar un trabajo que Codificado finalizó pero
 *     que Producción todavía no entregó — solo aparece tras el ENTREGAR real.
 *
 * Cada paso es un proceso node separado (sin memoria compartida — misma
 * metodología que los demás scripts _smoke_*_coldstart.mjs de este repo).
 * No importa los módulos "server-only" (work-item-progress-repository.ts,
 * codificado-handoff-service.ts) — replica su SQL exacto (ya revisado en
 * el PR) y usa las funciones puras reales de producción sin server-only
 * para la proyección: projectNativeWorkItem, projectQualityItem.
 *
 * Uso:
 *   node --import tsx scripts/_smoke_codificado_directo_produccion_entregados.mjs assign
 *   node --import tsx scripts/_smoke_codificado_directo_produccion_entregados.mjs codificado_edit <id>
 *   node --import tsx scripts/_smoke_codificado_directo_produccion_entregados.mjs codificado_deliver <id>
 *   node --import tsx scripts/_smoke_codificado_directo_produccion_entregados.mjs produccion_view <id>
 *   node --import tsx scripts/_smoke_codificado_directo_produccion_entregados.mjs entregados_check <id> <before|after>
 *   node --import tsx scripts/_smoke_codificado_directo_produccion_entregados.mjs produccion_entrega <id>
 *   node --import tsx scripts/_smoke_codificado_directo_produccion_entregados.mjs cleanup <id>
 * Env: DATABASE_URL / DATABASE_URL_UNPOOLED.
 */
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { eq } from "drizzle-orm";
import ws from "ws";
import * as schema from "../src/lib/db/schema.ts";
import { projectNativeWorkItem, projectQualityItem } from "../src/lib/planning/native-projector.ts";
import { computePackagingClose } from "../src/lib/remitos/packing-math.ts";
import { canActOnWorkItemSector } from "../src/features/os/operational/lib/work-progress-rbac.ts";
import { canEditInCodificado } from "../src/features/os/operational/lib/work-transfer-labels.ts";
import { PRODUCTION_AGGREGATE_SECTOR_IDS } from "../src/lib/operational/work-item-filters.ts";

neonConfig.webSocketConstructor = ws;

const mode = process.argv[2];
const url = process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim();
if (!url) throw new Error("No DATABASE_URL");
const pool = new Pool({ connectionString: url });
const db = drizzle(pool, { schema });

const MARKER = "SMOKE-BUG3IN1";

function mondayOf(d) {
  const day = d.getUTCDay();
  const diff = (day === 0 ? -6 : 1) - day;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + diff);
  return monday.toISOString().slice(0, 10);
}

function toPlanningRecord(row) {
  return {
    id: row.id,
    planningWeekId: row.planningWeekId,
    plannedDate: String(row.plannedDate),
    plannedDateTo: row.plannedDateTo ? String(row.plannedDateTo) : null,
    client: row.client,
    product: row.product,
    plannedQuantity: row.plannedQuantity,
    unit: row.unit,
    sector: row.sector,
    line: row.line,
    branchOwner: row.branchOwner,
    priority: row.priority,
    notes: row.notes,
    packagingLote: row.packagingLote,
    packagingVto: row.packagingVto,
    packagingTotalUnits: row.packagingTotalUnits == null ? null : Number(row.packagingTotalUnits),
    packingGroups: row.packingGroups,
    orderId: row.orderId,
    orderNumber: row.orderNumber,
    deliveryDate: row.deliveryDate,
    status: row.status,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdBy: row.createdBy,
    source: row.source,
    originRef: row.originRef,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    viaCodificado: row.viaCodificado,
    sentToCodificadoAt: row.sentToCodificadoAt?.toISOString() ?? null,
    sentToCodificadoBy: row.sentToCodificadoBy ?? null,
    codificadoOriginSector: row.codificadoOriginSector,
    codificadoRevision: row.codificadoRevision,
    codificadoCancelledAt: row.codificadoCancelledAt?.toISOString() ?? null,
    deliveredFromCodificadoAt: row.deliveredFromCodificadoAt?.toISOString() ?? null,
    deliveredFromCodificadoBy: row.deliveredFromCodificadoBy ?? null,
    codificadoObservation: row.codificadoObservation ?? null,
    bulkRemainderKg: row.bulkRemainderKg == null ? null : Number(row.bulkRemainderKg),
    operationalStatus: row.operationalStatus,
    finishedQty: row.finishedQty,
    operationalObservation: row.operationalObservation,
    packingMismatchObservation: row.packingMismatchObservation,
    completedAt: row.completedAt?.toISOString() ?? null,
    completedBy: row.completedBy ?? null,
    qualityStatus: row.qualityStatus,
    qualityDecidedAt: row.qualityDecidedAt?.toISOString() ?? null,
    qualityDecidedBy: row.qualityDecidedBy ?? null,
    qualityDecidedBySector: row.qualityDecidedBySector ?? null,
    qualityObservation: row.qualityObservation ?? null,
    qualityChangeReason: row.qualityChangeReason ?? null,
    sampleUnits: row.sampleUnits ?? null,
    deliverableUnits: row.deliverableUnits == null ? null : Number(row.deliverableUnits),
    packagingClosedAt: row.packagingClosedAt?.toISOString() ?? null,
    packagingClosedBy: row.packagingClosedBy ?? null,
  };
}

async function fetchRow(id) {
  const [row] = await db.select().from(schema.workItems).where(eq(schema.workItems.id, id));
  return row;
}

if (mode === "assign") {
  const weekStart = mondayOf(new Date());
  const [week] = await db
    .insert(schema.planningWeeks)
    .values({ weekStart, label: `Semana ${weekStart}`, status: "PUBLISHED", createdBy: MARKER })
    .onConflictDoUpdate({ target: schema.planningWeeks.weekStart, set: { status: "PUBLISHED" } })
    .returning();

  const [item] = await db
    .insert(schema.workItems)
    .values({
      planningWeekId: week.id,
      plannedDate: weekStart,
      client: `${MARKER} Cliente`,
      product: `${MARKER} Producto`,
      plannedQuantity: "1002",
      unit: "un.",
      sector: "CODIFICADO",
      status: "PUBLICADO",
      createdBy: "smoke-produccion",
      packagingLote: "COD-001",
      packagingVto: "10/2028",
      packagingTotalUnits: 1002,
      orderNumber: "OA-2026-990099",
    })
    .returning();
  console.log(`[assign] Producción → Codificado DIRECTO: ${item.id} (sector=${item.sector}, viaCodificado=${item.viaCodificado})`);
  await pool.end();
  process.exit(0);
}

if (mode === "codificado_edit") {
  const id = process.argv[3];
  const row = await fetchRow(id);
  if (!row) { console.log("[codificado_edit] NOT FOUND"); await pool.end(); process.exit(1); }

  // BUG 1 — RBAC: replica canActOnWorkItemSector (código real, sin mock).
  const rbacOk = canActOnWorkItemSector("CODIFICADO", row.sector);
  console.log(`[codificado_edit] RBAC Codificado sobre sector=${row.sector}: ${rbacOk ? "OK" : "RECHAZADO"}`);
  if (!rbacOk) { await pool.end(); process.exit(1); }

  // BUG 1 — UI gate: replica canEditInCodificado sobre el status proyectado real.
  const projected = projectNativeWorkItem(toPlanningRecord(row));
  const editable = canEditInCodificado({
    status: projected.status,
    sector: projected.sector,
    viaCodificado: projected.viaCodificado,
    deliveredFromCodificadoAt: projected.deliveredFromCodificadoAt,
  });
  console.log(`[codificado_edit] canEditInCodificado(status=${projected.status}, viaCodificado=${projected.viaCodificado}): ${editable ? "EDITABLE" : "BLOQUEADO"}`);
  if (!editable) { await pool.end(); process.exit(1); }

  // Réplica exacta de saveWorkProgressDurable tras el fix.
  await db
    .update(schema.workItems)
    .set({
      operationalStatus: "en_curso",
      finishedQty: "1002",
      operationalObservation: "TEST CODIFICADO COMPLETO",
      packingGroups: [
        { cajas: 10, unidadesPorCaja: 25 },
        { cajas: 15, unidadesPorCaja: 50 },
      ],
      sampleUnits: 2,
      progressUpdatedAt: new Date(),
      progressUpdatedBy: "Codificado (smoke)",
      updatedAt: new Date(),
    })
    .where(eq(schema.workItems.id, id));
  console.log("[codificado_edit] Guardado OK — 10x25 + 15x50, muestras=2");
  await pool.end();
  process.exit(0);
}

if (mode === "codificado_deliver") {
  const id = process.argv[3];
  const row = await fetchRow(id);
  const groups = row.packingGroups;
  const close = computePackagingClose({ finishedQty: 1002, sampleUnits: row.sampleUnits, groups });
  const now = new Date();
  await db
    .update(schema.workItems)
    .set({
      deliveredFromCodificadoAt: now,
      deliveredFromCodificadoBy: "Codificado (smoke)",
      packagingLote: row.packagingLote,
      packagingVto: row.packagingVto,
      deliverableUnits: close.canValidate ? close.enCajas : row.deliverableUnits,
      packagingClosedAt: now,
      packagingClosedBy: "Codificado (smoke)",
      codificadoObservation: "TEST CODIFICADO COMPLETO",
      completedAt: row.completedAt ?? now,
      completedBy: row.completedBy ?? "Codificado (smoke)",
      operationalStatus:
        row.operationalStatus === "entregado" || row.operationalStatus === "cancelado"
          ? row.operationalStatus
          : "revision",
      updatedAt: now,
    })
    .where(eq(schema.workItems.id, id));
  console.log(`[codificado_deliver] Codificado finaliza y entrega a Calidad — deliverableUnits=${close.enCajas} diferencia=${close.diferencia}`);
  await pool.end();
  process.exit(0);
}

if (mode === "produccion_view") {
  const id = process.argv[3];
  const row = await fetchRow(id);
  const projected = projectNativeWorkItem(toPlanningRecord(row));

  // BUG 2 — sector CODIFICADO debe estar en la vista agregada de Producción.
  const inAggregate = PRODUCTION_AGGREGATE_SECTOR_IDS.includes("CODIFICADO");
  console.log(`[produccion_view] CODIFICADO en PRODUCTION_AGGREGATE_SECTOR_IDS: ${inAggregate ? "SÍ" : "NO (bug)"}`);

  const checks = [
    ["producto", projected.product === `${MARKER} Producto`],
    ["cliente", projected.client === `${MARKER} Cliente`],
    ["lote", projected.packagingLote === "COD-001"],
    ["vto", projected.packagingVto === "10/2028"],
    ["OA", projected.oaRef === "OA-2026-990099"],
    ["cantidad final (finishedQty)", projected.finishedQty === "1002"],
    ["distribución cajas", JSON.stringify(projected.packingGroups) === JSON.stringify([
      { cajas: 10, unidadesPorCaja: 25 },
      { cajas: 15, unidadesPorCaja: 50 },
    ])],
    ["muestras", projected.sampleUnits === 2],
    ["entregable", projected.deliverableUnits === 1000],
    ["observación", projected.operationalObservation === "TEST CODIFICADO COMPLETO"],
    ["realizado por", projected.packagingClosedBy === "Codificado (smoke)"],
    ["finalizado (fecha)", Boolean(projected.packagingClosedAt)],
    ["estado", projected.status === "codificado_completo"],
  ];
  let allOk = inAggregate;
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? "[OK]  " : "[FALTA]"} ${label}`);
    if (!ok) allOk = false;
  }
  console.log(allOk ? "[produccion_view] Producción ve TODO lo cargado por Codificado — CONFIRMADO." : "[produccion_view] MISMATCH.");
  await pool.end();
  process.exit(allOk ? 0 : 1);
}

if (mode === "entregados_check") {
  const id = process.argv[3];
  const expect = process.argv[4]; // "before" | "after"
  const rows = await db
    .select()
    .from(schema.workItemDeliveries)
    .where(eq(schema.workItemDeliveries.workItemId, id));
  const activeDeliveries = rows.filter((r) => r.status === "ENTREGADO" && !r.archived);
  const present = activeDeliveries.length > 0;
  const expected = expect === "after";
  const ok = present === expected;
  console.log(
    `[entregados_check:${expect}] work_item_deliveries activas para este trabajo: ${activeDeliveries.length} — esperado ${expected ? "presente" : "ausente"}: ${ok ? "OK" : "MISMATCH (bug 3)"}`
  );
  await pool.end();
  process.exit(ok ? 0 : 1);
}

if (mode === "produccion_entrega") {
  const id = process.argv[3];
  const row = await fetchRow(id);
  const [delivery] = await db
    .insert(schema.workItemDeliveries)
    .values({
      workItemId: id,
      product: row.product,
      client: row.client,
      lote: row.packagingLote,
      sourceSector: "CODIFICADO",
      quantity: String(row.deliverableUnits ?? row.finishedQty ?? ""),
      unit: row.unit,
      plannedDeliveryDate: row.deliveryDate,
      actualDeliveredAt: new Date(),
      remito: "REM-SMOKE-0001",
      receivedBy: "Cliente Smoke",
      observations: "Entrega real de prueba",
      status: "ENTREGADO",
      deliveredBy: "Producción (smoke)",
      deliveredBySector: "PRODUCCION",
    })
    .returning();
  await db
    .update(schema.workItems)
    .set({ operationalStatus: "entregado", progressUpdatedAt: new Date(), progressUpdatedBy: "Producción (smoke)" })
    .where(eq(schema.workItems.id, id));
  console.log(`[produccion_entrega] Entrega real creada: ${delivery.id} (quantity=${delivery.quantity})`);
  await pool.end();
  process.exit(0);
}

if (mode === "calidad_view") {
  const id = process.argv[3];
  const row = await fetchRow(id);
  const projected = projectQualityItem(toPlanningRecord(row));
  const checks = [
    ["producto", projected.product === `${MARKER} Producto`],
    ["cliente", projected.client === `${MARKER} Cliente`],
    ["lote", projected.lote === "COD-001"],
    ["OA", projected.oa === "OA-2026-990099"],
    ["cantidad", projected.quantity === "1002"],
    ["observación", projected.observation === "TEST CODIFICADO COMPLETO"],
  ];
  let ok = true;
  for (const [label, pass] of checks) {
    console.log(`  ${pass ? "[OK]  " : "[FALTA]"} ${label}`);
    if (!pass) ok = false;
  }
  console.log(ok ? "[calidad_view] Calidad recibe el trabajo completo — CONFIRMADO." : "[calidad_view] MISMATCH.");
  await pool.end();
  process.exit(ok ? 0 : 1);
}

if (mode === "cleanup") {
  const id = process.argv[3];
  await db.delete(schema.workItemDeliveries).where(eq(schema.workItemDeliveries.workItemId, id));
  await db.delete(schema.operationalEvents).where(eq(schema.operationalEvents.workItemId, id));
  await db.delete(schema.operationalOrders).where(eq(schema.operationalOrders.orderNumber, "OA-2026-990099"));
  await db.delete(schema.workItems).where(eq(schema.workItems.id, id));
  console.log(`[cleanup] eliminado ${id}`);
  await pool.end();
  process.exit(0);
}

console.error("Modo desconocido.");
process.exit(1);
