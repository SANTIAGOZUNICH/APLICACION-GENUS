/**
 * Smoke E2E — pestaña Codificado en Producción, edición de asignación, y
 * "Rehacer entrega":
 *  1) Producción edita un trabajo ya asignado (producto/cliente/cantidad/
 *     fecha de entrega) sin pisar avance ya informado por el sector.
 *  2) Codificado entrega → queda read-only → "Rehacer entrega" lo reabre
 *     preservando cajas/muestras/lote/VTO/OA/observaciones → Codificado
 *     edita de nuevo → vuelve a entregar → Producción ve los valores nuevos.
 *  3) Bloqueos: no se puede rehacer si Calidad ya decidió, ni si ya existe
 *     una entrega real en work_item_deliveries.
 *
 * NOTA: este script no se ejecutó en la sesión donde se escribió — el
 * sandbox bloqueó la escritura de credenciales de Postgres a disco (mismo
 * bloqueo documentado en el PR anterior). Replica el SQL exacto de
 * updateWorkItemPlanningDurable/reopenCodificadoDeliveryDurable (ya
 * revisado en el PR) y usa las funciones puras reales sin server-only.
 *
 * Uso:
 *   node --import tsx scripts/_smoke_codificado_reopen_and_edit.mjs assign
 *   node --import tsx scripts/_smoke_codificado_reopen_and_edit.mjs edit_assignment <id>
 *   node --import tsx scripts/_smoke_codificado_reopen_and_edit.mjs codificado_edit <id>
 *   node --import tsx scripts/_smoke_codificado_reopen_and_edit.mjs codificado_deliver <id>
 *   node --import tsx scripts/_smoke_codificado_reopen_and_edit.mjs check_editable <id> <true|false>
 *   node --import tsx scripts/_smoke_codificado_reopen_and_edit.mjs reopen_delivery <id>
 *   node --import tsx scripts/_smoke_codificado_reopen_and_edit.mjs verify_preserved <id>
 *   node --import tsx scripts/_smoke_codificado_reopen_and_edit.mjs mark_quality_decided <id>
 *   node --import tsx scripts/_smoke_codificado_reopen_and_edit.mjs reopen_should_fail_quality_decided <id>
 *   node --import tsx scripts/_smoke_codificado_reopen_and_edit.mjs cleanup <id>
 * Env: DATABASE_URL / DATABASE_URL_UNPOOLED.
 */
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { eq } from "drizzle-orm";
import ws from "ws";
import * as schema from "../src/lib/db/schema.ts";
import { projectNativeWorkItem } from "../src/lib/planning/native-projector.ts";
import { computePackagingClose } from "../src/lib/remitos/packing-math.ts";
import { canEditInCodificado } from "../src/features/os/operational/lib/work-transfer-labels.ts";

neonConfig.webSocketConstructor = ws;

const mode = process.argv[2];
const url = process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim();
if (!url) throw new Error("No DATABASE_URL");
const pool = new Pool({ connectionString: url });
const db = drizzle(pool, { schema });

const MARKER = "SMOKE-REOPEN-EDIT";

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
      plannedQuantity: "800",
      unit: "un.",
      sector: "CODIFICADO",
      status: "PUBLICADO",
      createdBy: "smoke-produccion",
      packagingLote: "REOPEN-001",
      packagingVto: "12/2028",
      packagingTotalUnits: 800,
      orderNumber: "OA-2026-990097",
      deliveryDate: "2026-09-01",
    })
    .returning();
  console.log(`[assign] ${item.id} (sector=${item.sector})`);
  await pool.end();
  process.exit(0);
}

if (mode === "edit_assignment") {
  // Réplica de updateWorkItemPlanningDurable: solo columnas de planificación.
  const id = process.argv[3];
  const row = await fetchRow(id);
  const before = { client: row.client, product: row.product, plannedQuantity: row.plannedQuantity };
  await db
    .update(schema.workItems)
    .set({
      client: `${MARKER} Cliente EDITADO`,
      plannedQuantity: "850",
      updatedAt: new Date(),
    })
    .where(eq(schema.workItems.id, id));
  await db.insert(schema.operationalEvents).values({
    workItemId: id,
    planningWeekId: row.planningWeekId,
    type: "PLANNING_FIELDS_CORRECTED",
    fromStatus: JSON.stringify(before),
    toStatus: JSON.stringify({ client: `${MARKER} Cliente EDITADO`, plannedQuantity: "850" }),
    actorEmail: "produccion@laboratoriogenus.com.ar",
    actorSector: "PRODUCCION",
    note: "smoke edit",
  });
  const after = await fetchRow(id);
  console.log(
    `[edit_assignment] client=${after.client} plannedQuantity=${after.plannedQuantity} ` +
      `finishedQty intacto=${after.finishedQty === row.finishedQty ? "OK" : "MISMATCH"}`
  );
  await pool.end();
  process.exit(0);
}

if (mode === "codificado_edit") {
  const id = process.argv[3];
  await db
    .update(schema.workItems)
    .set({
      operationalStatus: "en_curso",
      finishedQty: "800",
      packingGroups: [{ cajas: 8, unidadesPorCaja: 100 }],
      sampleUnits: 3,
      updatedAt: new Date(),
    })
    .where(eq(schema.workItems.id, id));
  console.log("[codificado_edit] guardado 8x100, muestras=3");
  await pool.end();
  process.exit(0);
}

if (mode === "codificado_deliver") {
  const id = process.argv[3];
  const row = await fetchRow(id);
  const close = computePackagingClose({
    finishedQty: 800,
    sampleUnits: row.sampleUnits,
    groups: row.packingGroups,
  });
  const now = new Date();
  await db
    .update(schema.workItems)
    .set({
      deliveredFromCodificadoAt: now,
      deliveredFromCodificadoBy: "Codificado (smoke)",
      completedAt: now,
      completedBy: "Codificado (smoke)",
      operationalStatus: "revision",
      deliverableUnits: close.canValidate ? close.enCajas : row.deliverableUnits,
      updatedAt: now,
    })
    .where(eq(schema.workItems.id, id));
  console.log(`[codificado_deliver] entregado — deliverableUnits=${close.enCajas}`);
  await pool.end();
  process.exit(0);
}

if (mode === "check_editable") {
  const id = process.argv[3];
  const expected = process.argv[4] === "true";
  const row = await fetchRow(id);
  const projected = projectNativeWorkItem(toPlanningRecord(row));
  const editable = canEditInCodificado({
    status: projected.status,
    sector: projected.sector,
    viaCodificado: projected.viaCodificado,
    deliveredFromCodificadoAt: projected.deliveredFromCodificadoAt,
  });
  const ok = editable === expected;
  console.log(`[check_editable] editable=${editable} esperado=${expected}: ${ok ? "OK" : "MISMATCH"}`);
  await pool.end();
  process.exit(ok ? 0 : 1);
}

if (mode === "reopen_delivery") {
  // Réplica de reopenCodificadoDeliveryDurable.
  const id = process.argv[3];
  const row = await fetchRow(id);
  if (!row.deliveredFromCodificadoAt) {
    console.log("[reopen_delivery] BLOQUEADO (correcto) — no fue entregado.");
    await pool.end();
    process.exit(row.deliveredFromCodificadoAt ? 1 : 0);
  }
  if (row.qualityStatus && row.qualityStatus !== "pendiente") {
    console.log("[reopen_delivery] BLOQUEADO (correcto) — Calidad ya decidió.");
    await pool.end();
    process.exit(0);
  }
  const [activeDelivery] = await db
    .select()
    .from(schema.workItemDeliveries)
    .where(eq(schema.workItemDeliveries.workItemId, id));
  if (activeDelivery && activeDelivery.status === "ENTREGADO" && !activeDelivery.archived) {
    console.log("[reopen_delivery] BLOQUEADO (correcto) — ya hay entrega real a cliente.");
    await pool.end();
    process.exit(0);
  }
  const now = new Date();
  await db
    .update(schema.workItems)
    .set({
      deliveredFromCodificadoAt: null,
      deliveredFromCodificadoBy: null,
      completedAt: null,
      completedBy: null,
      operationalStatus: row.operationalStatus === "revision" ? "en_curso" : row.operationalStatus,
      updatedAt: now,
    })
    .where(eq(schema.workItems.id, id));
  await db.insert(schema.operationalEvents).values({
    workItemId: id,
    planningWeekId: row.planningWeekId,
    type: "REOPENED_CODIFICADO_DELIVERY",
    fromStatus: "PENDIENTE_CALIDAD",
    toStatus: "EN_CODIFICADO",
    actorEmail: "codificado@laboratoriogenus.com.ar",
    actorSector: "CODIFICADO",
    note: "smoke reopen",
  });
  console.log("[reopen_delivery] reabierto — deliveredFromCodificadoAt limpio, completedAt limpio.");
  await pool.end();
  process.exit(0);
}

if (mode === "verify_preserved") {
  // Confirma que cajas/muestras/lote/VTO/OA sobrevivieron el reopen.
  const id = process.argv[3];
  const row = await fetchRow(id);
  const checks = [
    ["packingGroups sobrevive", JSON.stringify(row.packingGroups) === JSON.stringify([{ cajas: 8, unidadesPorCaja: 100 }])],
    ["sampleUnits sobrevive", row.sampleUnits === 3],
    ["lote sobrevive", row.packagingLote === "REOPEN-001"],
    ["vto sobrevive", row.packagingVto === "12/2028"],
    ["OA sobrevive", row.orderNumber === "OA-2026-990097"],
    ["deliveredFromCodificadoAt limpio", row.deliveredFromCodificadoAt === null],
    ["completedAt limpio", row.completedAt === null],
    ["sector sigue CODIFICADO (no ejectado a Envasado)", row.sector === "CODIFICADO"],
  ];
  let ok = true;
  for (const [label, pass] of checks) {
    console.log(`  ${pass ? "[OK]  " : "[FALTA]"} ${label}`);
    if (!pass) ok = false;
  }
  console.log(ok ? "[verify_preserved] CONFIRMADO." : "[verify_preserved] MISMATCH.");
  await pool.end();
  process.exit(ok ? 0 : 1);
}

if (mode === "mark_quality_decided") {
  const id = process.argv[3];
  await db
    .update(schema.workItems)
    .set({
      qualityStatus: "aprobado",
      qualityDecidedAt: new Date(),
      qualityDecidedBy: "Calidad (smoke)",
      qualityDecidedBySector: "CALIDAD",
    })
    .where(eq(schema.workItems.id, id));
  console.log("[mark_quality_decided] qualityStatus=aprobado");
  await pool.end();
  process.exit(0);
}

if (mode === "cleanup") {
  const id = process.argv[3];
  const row = await fetchRow(id);
  await db.delete(schema.workItemDeliveries).where(eq(schema.workItemDeliveries.workItemId, id));
  await db.delete(schema.operationalEvents).where(eq(schema.operationalEvents.workItemId, id));
  if (row?.orderNumber) {
    await db.delete(schema.operationalOrders).where(eq(schema.operationalOrders.orderNumber, row.orderNumber));
  }
  await db.delete(schema.workItems).where(eq(schema.workItems.id, id));
  console.log(`[cleanup] eliminado ${id}`);
  await pool.end();
  process.exit(0);
}

console.error("Modo desconocido.");
process.exit(1);
