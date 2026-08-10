/**
 * Smoke de integración — Calidad y Entregados, mismo criterio que
 * _smoke_multipc_coldstart.mjs: cada paso es un proceso Node separado (sin
 * memoria compartida), y solo usa código real de producción (native-projector,
 * projectQualityItem) para la proyección — no reimplementa la lógica.
 *
 * Uso:
 *   node --import tsx scripts/_smoke_calidad_entregas_coldstart.mjs setup
 *   node --import tsx scripts/_smoke_calidad_entregas_coldstart.mjs decide <workItemId>
 *   node --import tsx scripts/_smoke_calidad_entregas_coldstart.mjs read-decision <workItemId>
 *   node --import tsx scripts/_smoke_calidad_entregas_coldstart.mjs deliver <workItemId>
 *   node --import tsx scripts/_smoke_calidad_entregas_coldstart.mjs read-delivery <workItemId>
 *   node --import tsx scripts/_smoke_calidad_entregas_coldstart.mjs cleanup <workItemId>
 * Env: DATABASE_URL / DATABASE_URL_UNPOOLED.
 */
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { eq } from "drizzle-orm";
import ws from "ws";
import * as schema from "../src/lib/db/schema.ts";
import { projectQualityItem } from "../src/lib/planning/native-projector.ts";

neonConfig.webSocketConstructor = ws;

const mode = process.argv[2];
const url = process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim();
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

async function end() {
  await pool.end();
}

if (mode === "setup") {
  const weekStart = mondayOf(new Date());
  const [week] = await db
    .insert(schema.planningWeeks)
    .values({ weekStart, label: `Semana ${weekStart}`, status: "PUBLISHED", createdBy: "smoke-test" })
    .onConflictDoUpdate({ target: schema.planningWeeks.weekStart, set: { status: "PUBLISHED" } })
    .returning();

  const [item] = await db
    .insert(schema.workItems)
    .values({
      planningWeekId: week.id,
      plannedDate: weekStart,
      client: "SMOKE Calidad/Entregas",
      product: "SMOKE Producto QA",
      plannedQuantity: "500",
      unit: "KG",
      sector: "ENVASADO_PREMIUM",
      line: "Línea 1",
      status: "PUBLICADO",
      createdBy: "smoke-test",
      // Simula que Envasado ya terminó y está esperando revisión de Calidad.
      completedAt: new Date(),
      completedBy: "smoke-operario",
      operationalStatus: "revision",
      finishedQty: "480",
      operationalObservation: "SMOKE listo para Calidad",
    })
    .returning();

  console.log(`[setup] work_item creado en revision: ${item.id}`);
  await end();
  process.exit(0);
}

if (mode === "decide") {
  const id = process.argv[3];
  if (!id) throw new Error("Falta workItemId");
  const now = new Date();
  await db
    .update(schema.workItems)
    .set({
      qualityStatus: "aprobado",
      qualityDecidedAt: now,
      qualityDecidedBy: "smoke-calidad",
      qualityDecidedBySector: "CALIDAD",
      qualityObservation: "SMOKE aprobado sin objeciones",
      updatedAt: now,
    })
    .where(eq(schema.workItems.id, id));
  console.log(`[decide] Calidad aprobó ${id} (proceso separado del setup)`);
  await end();
  process.exit(0);
}

if (mode === "read-decision") {
  const id = process.argv[3];
  if (!id) throw new Error("Falta workItemId");
  const [row] = await db.select().from(schema.workItems).where(eq(schema.workItems.id, id));
  if (!row) {
    console.log("[read-decision] NOT FOUND");
    await end();
    process.exit(1);
  }
  const record = {
    id: row.id,
    planningWeekId: row.planningWeekId,
    plannedDate: String(row.plannedDate),
    client: row.client,
    product: row.product,
    plannedQuantity: row.plannedQuantity,
    unit: row.unit,
    sector: row.sector,
    line: row.line,
    branchOwner: row.branchOwner,
    priority: row.priority,
    notes: row.notes,
    status: row.status,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdBy: row.createdBy,
    source: row.source,
    originRef: row.originRef,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    orderNumber: row.orderNumber,
    finishedQty: row.finishedQty,
    operationalObservation: row.operationalObservation,
    completedAt: row.completedAt?.toISOString() ?? null,
    completedBy: row.completedBy,
    qualityStatus: row.qualityStatus,
    qualityObservation: row.qualityObservation,
    qualityDecidedBy: row.qualityDecidedBy,
  };
  // Código real de producción — el mismo que arma la cola de Calidad.
  const q = projectQualityItem(record);
  console.log("[read-decision] Producción (proceso nuevo) ve vía projectQualityItem:");
  console.log(JSON.stringify({ status: q.status, observation: q.observation, kind: q.kind }, null, 2));
  const match = q.status === "aprobado" && q.observation === "SMOKE aprobado sin objeciones";
  console.log(match ? "[read-decision] MATCH" : "[read-decision] MISMATCH");
  await end();
  process.exit(match ? 0 : 1);
}

if (mode === "deliver") {
  const id = process.argv[3];
  if (!id) throw new Error("Falta workItemId");
  const [row] = await db
    .insert(schema.workItemDeliveries)
    .values({
      workItemId: id,
      product: "SMOKE Producto QA",
      codigo: "SMOKE-COD-1",
      client: "SMOKE Calidad/Entregas",
      lote: "SMOKE-L9",
      sourceSector: "ENVASADO_PREMIUM",
      quantity: "480",
      unit: "KG",
      actualDeliveredAt: new Date(),
      remito: "SMOKE-REM-1",
      receivedBy: "SMOKE Recepcion",
      observations: "SMOKE entrega de prueba",
      status: "ENTREGADO",
      deliveredBy: "smoke-produccion",
      deliveredBySector: "PRODUCCION",
    })
    .returning();
  console.log(`[deliver] entrega creada: ${row.id}`);
  await end();
  process.exit(0);
}

if (mode === "read-delivery") {
  const id = process.argv[3];
  if (!id) throw new Error("Falta workItemId");
  const rows = await db
    .select()
    .from(schema.workItemDeliveries)
    .where(eq(schema.workItemDeliveries.workItemId, id));
  console.log("[read-delivery] Entregados (proceso nuevo) ve:", rows.length, "registro(s)");
  const row = rows[0];
  const match =
    Boolean(row) &&
    row.status === "ENTREGADO" &&
    row.remito === "SMOKE-REM-1" &&
    row.lote === "SMOKE-L9";
  if (row) {
    console.log(JSON.stringify({ status: row.status, remito: row.remito, lote: row.lote, quantity: row.quantity }, null, 2));
  }
  console.log(match ? "[read-delivery] MATCH" : "[read-delivery] MISMATCH");
  await end();
  process.exit(match ? 0 : 1);
}

if (mode === "cleanup") {
  const id = process.argv[3];
  if (!id) throw new Error("Falta workItemId");
  await db.delete(schema.workItemDeliveries).where(eq(schema.workItemDeliveries.workItemId, id));
  await db.delete(schema.workItems).where(eq(schema.workItems.id, id));
  console.log(`[cleanup] eliminado ${id} + entregas asociadas`);
  await end();
  process.exit(0);
}

console.error("Modo desconocido.");
process.exit(1);
