/**
 * Smoke de integración — simula Cliente A (Envasado escribe) y Cliente B
 * (Producción lee) como PROCESOS NODE SEPARADOS (sin memoria compartida —
 * equivale a "otra PC" y a un cold start real: cada invocación de `node`
 * acá es un proceso nuevo, sin ningún Map en RAM sobreviviendo entre pasos).
 *
 * No importa src/lib/db/client.ts ni work-item-progress-repository.ts
 * directamente porque llevan `import "server-only"`, que aborta fuera del
 * runtime react-server de Next — arma su propia conexión Drizzle (mismas
 * credenciales/tabla) y sí ejercita el projector real (native-projector.ts,
 * sin server-only) para que la lectura pase por el código de producción.
 *
 * Uso: node --import tsx scripts/_smoke_multipc_coldstart.mjs write
 *      node --import tsx scripts/_smoke_multipc_coldstart.mjs read <workItemId>
 *      node --import tsx scripts/_smoke_multipc_coldstart.mjs cleanup <workItemId>
 * Env: DATABASE_URL / DATABASE_URL_UNPOOLED.
 */
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { eq } from "drizzle-orm";
import ws from "ws";
import * as schema from "../src/lib/db/schema.ts";
import { projectNativeWorkItem } from "../src/lib/planning/native-projector.ts";

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

if (mode === "write") {
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
      client: "SMOKE Cliente A",
      product: "SMOKE Producto Multi-PC",
      plannedQuantity: "10000",
      unit: "KG",
      sector: "ENVASADO_MASIVO",
      line: "Línea 1",
      status: "PUBLICADO",
      createdBy: "smoke-test",
    })
    .returning();

  console.log(`[write] work_item creado: ${item.id}`);

  // Réplica exacta de lo que hace saveWorkProgressDurable() en producción.
  const [row] = await db
    .update(schema.workItems)
    .set({
      operationalStatus: "en_curso",
      finishedQty: "9750",
      operationalObservation: "SMOKE avance de prueba",
      progressUpdatedAt: new Date(),
      progressUpdatedBy: "operario-envasado-smoke",
      packagingLote: "SMOKE-L1",
      packagingVto: "2027-01-01",
      packagingTotalUnits: 9750,
      packingGroups: [{ cajas: 100, unidadesPorCaja: 96 }],
      updatedAt: new Date(),
    })
    .where(eq(schema.workItems.id, item.id))
    .returning();

  console.log(`[write] operational_status persistido: ${row.operationalStatus}`);
  console.log(`[write] OK — workItemId=${item.id}`);
  await pool.end();
  process.exit(0);
}

if (mode === "read") {
  const id = process.argv[3];
  if (!id) throw new Error("Falta workItemId");
  const [row] = await db.select().from(schema.workItems).where(eq(schema.workItems.id, id));
  if (!row) {
    console.log("[read] NOT FOUND");
    await pool.end();
    process.exit(1);
  }
  const record = {
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
  };
  // Código real de producción — el mismo que usa /api/v1/work-items.
  const projected = projectNativeWorkItem(record);
  const actual = {
    status: projected.status,
    finishedQty: projected.finishedQty,
    packagingLote: projected.packagingLote,
    packagingVto: projected.packagingVto,
    packagingTotalUnits: projected.packagingTotalUnits,
    packagingCajas: projected.packagingCajas,
    packagingUnidadesPorCaja: projected.packagingUnidadesPorCaja,
    operationalObservation: projected.operationalObservation,
  };
  console.log("[read] Cliente B (proceso nuevo, sin RAM compartida) ve:");
  console.log(JSON.stringify(actual, null, 2));
  const expected = {
    status: "en_curso",
    finishedQty: "9750",
    packagingLote: "SMOKE-L1",
    packagingVto: "2027-01-01",
    packagingTotalUnits: 9750,
    packagingCajas: 100,
    packagingUnidadesPorCaja: 96,
    operationalObservation: "SMOKE avance de prueba",
  };
  const match = JSON.stringify(expected) === JSON.stringify(actual);
  console.log(match ? "[read] MATCH — valores exactamente iguales." : "[read] MISMATCH.");
  await pool.end();
  process.exit(match ? 0 : 1);
}

if (mode === "cleanup") {
  const id = process.argv[3];
  if (!id) throw new Error("Falta workItemId");
  await db.delete(schema.workItems).where(eq(schema.workItems.id, id));
  console.log(`[cleanup] eliminado ${id}`);
  await pool.end();
  process.exit(0);
}

console.error("Modo desconocido. Usar write | read <id> | cleanup <id>.");
process.exit(1);
