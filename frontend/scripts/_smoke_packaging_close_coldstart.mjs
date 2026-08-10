/**
 * Smoke E2E — PARTE A (cierre físico de acondicionamiento) contra Preview DB.
 * Reproduce el escenario exacto del usuario como PROCESOS NODE SEPARADOS
 * (misma metodología que _smoke_multipc_coldstart.mjs: cada invocación acá
 * es un proceso nuevo, sin RAM compartida — equivale a otra PC / cold start).
 *
 * No importa work-item-progress-repository.ts / codificado-handoff-service.ts
 * (llevan `import "server-only"`, que aborta fuera del runtime react-server
 * de Next) — arma su propia conexión Drizzle y replica exactamente la
 * lógica ya revisada de esos archivos. Sí importa directamente las
 * funciones puras reales de producción sin server-only: projectNativeWorkItem,
 * computePackagingClose, resolveRemitoInputFromQuality.
 *
 * Escenario:
 *  1. assign   — Producción crea el trabajo: 1002 un., Lote ABC123, VTO 10/2028.
 *  2. envasado_read — Envasado (proceso nuevo) ve Lote/VTO sin re-tipearlos.
 *  3. envasado_close — Envasado carga 10x25 + 15x50, Muestras=2, cierra
 *     (replica handoffToCodificadoDurable: packingGroups/sampleUnits/
 *     deliverableUnits/packagingClosedAt/By — Lote/VTO permanecen intocados).
 *  4. coldstart_read — proceso nuevo, cold start: misma distribución exacta.
 *  5. remito_check — resolveRemitoInputFromQuality debe tomar 1000 (deliverable),
 *     nunca 1002 (packagingTotalUnits/finishedQty).
 *  6. cleanup.
 *
 * Uso: node --import tsx scripts/_smoke_packaging_close_coldstart.mjs assign
 *      node --import tsx scripts/_smoke_packaging_close_coldstart.mjs envasado_read <id>
 *      node --import tsx scripts/_smoke_packaging_close_coldstart.mjs envasado_close <id>
 *      node --import tsx scripts/_smoke_packaging_close_coldstart.mjs coldstart_read <id>
 *      node --import tsx scripts/_smoke_packaging_close_coldstart.mjs remito_check <id>
 *      node --import tsx scripts/_smoke_packaging_close_coldstart.mjs cleanup <id>
 * Env: DATABASE_URL / DATABASE_URL_UNPOOLED.
 */
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { eq } from "drizzle-orm";
import ws from "ws";
import * as schema from "../src/lib/db/schema.ts";
import { projectNativeWorkItem } from "../src/lib/planning/native-projector.ts";
import { computePackagingClose } from "../src/lib/remitos/packing-math.ts";
import { resolveRemitoInputFromQuality } from "../src/lib/remitos/from-quality.ts";

neonConfig.webSocketConstructor = ws;

const mode = process.argv[2];
const url =
  process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim();
if (!url) throw new Error("No DATABASE_URL");
const pool = new Pool({ connectionString: url });
const db = drizzle(pool, { schema });

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
    plannedDateTo: null,
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
    codificadoRevision: row.codificadoRevision,
    operationalStatus: row.operationalStatus,
    finishedQty: row.finishedQty,
    operationalObservation: row.operationalObservation,
    packingMismatchObservation: row.packingMismatchObservation,
    qualityStatus: row.qualityStatus,
    sampleUnits: row.sampleUnits ?? null,
    deliverableUnits: row.deliverableUnits == null ? null : Number(row.deliverableUnits),
    packagingClosedAt: row.packagingClosedAt ? row.packagingClosedAt.toISOString() : null,
    packagingClosedBy: row.packagingClosedBy ?? null,
  };
}

if (mode === "assign") {
  const weekStart = mondayOf(new Date());
  const [week] = await db
    .insert(schema.planningWeeks)
    .values({ weekStart, label: `Semana ${weekStart}`, status: "PUBLISHED", createdBy: "smoke-parte-a" })
    .onConflictDoUpdate({ target: schema.planningWeeks.weekStart, set: { status: "PUBLISHED" } })
    .returning();

  // Réplica exacta de assignWorkItemDurable: Producción fija Lote/VTO al asignar.
  const [item] = await db
    .insert(schema.workItems)
    .values({
      planningWeekId: week.id,
      plannedDate: weekStart,
      client: "SMOKE Cliente PARTE-A",
      product: "SMOKE Producto Cierre",
      plannedQuantity: "1002",
      unit: "un.",
      sector: "ENVASADO_MASIVO",
      line: "Línea 1",
      status: "PUBLICADO",
      createdBy: "smoke-produccion",
      packagingLote: "ABC123",
      packagingVto: "10/2028",
      packagingTotalUnits: 1002,
    })
    .returning();

  console.log(`[assign] work_item creado por Producción: ${item.id}`);
  console.log(`[assign] Lote=${item.packagingLote} VTO=${item.packagingVto} cantidad=1002`);
  await pool.end();
  process.exit(0);
}

if (mode === "envasado_read") {
  const id = process.argv[3];
  if (!id) throw new Error("Falta workItemId");
  const [row] = await db.select().from(schema.workItems).where(eq(schema.workItems.id, id));
  if (!row) { console.log("[envasado_read] NOT FOUND"); await pool.end(); process.exit(1); }
  const projected = projectNativeWorkItem(toPlanningRecord(row));
  const ok = projected.packagingLote === "ABC123" && projected.packagingVto === "10/2028";
  console.log(`[envasado_read] Envasado (proceso nuevo) ve Lote=${projected.packagingLote} VTO=${projected.packagingVto} — sin re-tipear.`);
  console.log(ok ? "[envasado_read] MATCH — fuente única confirmada." : "[envasado_read] MISMATCH.");
  await pool.end();
  process.exit(ok ? 0 : 1);
}

if (mode === "envasado_close") {
  const id = process.argv[3];
  if (!id) throw new Error("Falta workItemId");
  const groups = [
    { cajas: 10, unidadesPorCaja: 25 },
    { cajas: 15, unidadesPorCaja: 50 },
  ];
  const sampleUnits = 2;
  const close = computePackagingClose({ finishedQty: 1002, sampleUnits, groups });
  console.log(`[envasado_close] computePackagingClose → enCajas=${close.enCajas} muestras=${close.muestras} total=${close.totalAcondicionado} diferencia=${close.diferencia} valido=${close.isValid}`);
  if (!close.isValid) { console.log("[envasado_close] FAIL — la distribución no cierra."); await pool.end(); process.exit(1); }

  const [existing] = await db
    .select({ packagingLote: schema.workItems.packagingLote, packagingVto: schema.workItems.packagingVto })
    .from(schema.workItems)
    .where(eq(schema.workItems.id, id));

  // Réplica exacta de handoffToCodificadoDurable tras el fix PARTE A:
  // packagingLote/Vto se RE-ESCRIBEN CON EL VALOR EXISTENTE (row.*), nunca
  // con un input del cliente — acá no hay ningún campo "nuevo lote" en el
  // update, precisamente porque el código real ya no lo acepta.
  const now = new Date();
  const [row] = await db
    .update(schema.workItems)
    .set({
      packagingLote: existing.packagingLote,
      packagingVto: existing.packagingVto,
      packingGroups: groups,
      sampleUnits,
      finishedQty: "1002",
      packagingTotalUnits: 1002,
      deliverableUnits: close.enCajas,
      packagingClosedAt: now,
      packagingClosedBy: "operario-envasado-smoke",
      updatedAt: now,
    })
    .where(eq(schema.workItems.id, id))
    .returning();

  console.log(`[envasado_close] Persistido — deliverableUnits=${row.deliverableUnits} sampleUnits=${row.sampleUnits} Lote=${row.packagingLote} VTO=${row.packagingVto}`);
  await pool.end();
  process.exit(0);
}

if (mode === "coldstart_read") {
  const id = process.argv[3];
  if (!id) throw new Error("Falta workItemId");
  const [row] = await db.select().from(schema.workItems).where(eq(schema.workItems.id, id));
  if (!row) { console.log("[coldstart_read] NOT FOUND"); await pool.end(); process.exit(1); }
  const projected = projectNativeWorkItem(toPlanningRecord(row));
  const actual = {
    packagingLote: projected.packagingLote,
    packagingVto: projected.packagingVto,
    packingGroups: projected.packingGroups,
    sampleUnits: projected.sampleUnits,
    deliverableUnits: projected.deliverableUnits,
  };
  const expected = {
    packagingLote: "ABC123",
    packagingVto: "10/2028",
    packingGroups: [
      { cajas: 10, unidadesPorCaja: 25 },
      { cajas: 15, unidadesPorCaja: 50 },
    ],
    sampleUnits: 2,
    deliverableUnits: 1000,
  };
  console.log("[coldstart_read] proceso nuevo (cold start) ve:");
  console.log(JSON.stringify(actual, null, 2));
  const match = JSON.stringify(expected) === JSON.stringify(actual);
  console.log(match ? "[coldstart_read] MATCH — misma distribución exacta." : "[coldstart_read] MISMATCH.");
  await pool.end();
  process.exit(match ? 0 : 1);
}

if (mode === "remito_check") {
  const id = process.argv[3];
  if (!id) throw new Error("Falta workItemId");
  const [row] = await db.select().from(schema.workItems).where(eq(schema.workItems.id, id));
  if (!row) { console.log("[remito_check] NOT FOUND"); await pool.end(); process.exit(1); }
  const wi = projectNativeWorkItem(toPlanningRecord(row));
  const qualityItem = {
    id: `qc:${id}`,
    kind: "salida",
    status: "aprobado",
    product: wi.product ?? "Producto",
    client: wi.client ?? "Cliente",
    // projectQualityItem() real usa `native:${item.id}` (el mismo id que
    // WorkItem.id proyectado) — no el uuid crudo de la fila.
    relatedWorkItemId: wi.id,
    deliveryDate: "2026-08-15",
    lote: null,
    oe: null,
    oa: null,
    line: null,
    quantity: "1002",
    dayLabel: "Hoy",
  };
  const input = resolveRemitoInputFromQuality(qualityItem, [wi]);
  console.log(`[remito_check] totalUnits para remito = ${input?.totalUnits} (esperado: 1000, nunca 1002)`);
  const ok = input?.totalUnits === 1000;
  console.log(ok ? "[remito_check] MATCH — remito usa deliverableUnits, excluye muestras." : "[remito_check] MISMATCH.");
  await pool.end();
  process.exit(ok ? 0 : 1);
}

if (mode === "cleanup") {
  const id = process.argv[3];
  if (!id) throw new Error("Falta workItemId");
  await db.delete(schema.workItems).where(eq(schema.workItems.id, id));
  console.log(`[cleanup] eliminado ${id}`);
  await pool.end();
  process.exit(0);
}

console.error("Modo desconocido. Usar assign | envasado_read <id> | envasado_close <id> | coldstart_read <id> | remito_check <id> | cleanup <id>.");
process.exit(1);
