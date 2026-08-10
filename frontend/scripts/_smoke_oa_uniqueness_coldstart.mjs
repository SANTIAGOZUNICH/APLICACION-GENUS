/**
 * Smoke — confirma contra Preview DB real que la regla "1 trabajo = 1 OA"
 * sigue sostenida a nivel de datos después de integrar main (OA auto-create)
 * dentro de stabilization: unique index en operational_orders.order_number,
 * y el UPDATE condicional (WHERE linked_work_item_id IS NULL) que usa
 * work-assignment-service.ts para vincular una sola vez.
 *
 * Uso: node --import tsx scripts/_smoke_oa_uniqueness_coldstart.mjs run
 *      node --import tsx scripts/_smoke_oa_uniqueness_coldstart.mjs cleanup
 */
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { eq, and, sql } from "drizzle-orm";
import ws from "ws";
import * as schema from "../src/lib/db/schema.ts";

neonConfig.webSocketConstructor = ws;

const mode = process.argv[2];
const url = process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim();
if (!url) throw new Error("No DATABASE_URL");
const pool = new Pool({ connectionString: url });
const db = drizzle(pool, { schema });

const MARKER = "OA-2099-000001";

if (mode === "run") {
  const [tmpl] = await db
    .insert(schema.orderTemplates)
    .values({
      type: "OA",
      productId: `smoke-oa-uniq-${Date.now()}`,
      productName: "SMOKE",
      productCode: "SMOKE",
      version: 1,
      status: "OBSOLETA",
      content: { kind: "OA", header: {} },
      createdBy: "smoke",
      updatedBy: "smoke",
    })
    .returning();

  const [order] = await db
    .insert(schema.operationalOrders)
    .values({
      orderNumber: MARKER,
      type: "OA",
      templateId: tmpl.id,
      templateVersion: 1,
      templateSnapshot: {},
      product: "SMOKE",
      client: "SMOKE",
      code: "SMOKE",
      lot: "SMOKE",
      assignedSector: "ENVASADO_MASIVO",
      formData: {},
      linkedWorkItemId: null,
      createdBy: "smoke",
      updatedBy: "smoke",
    })
    .returning();
  console.log(`[run] OA creada: ${order.orderNumber} (${order.id})`);

  // Réplica exacta del UPDATE condicional de work-assignment-service.ts.
  const [firstLink] = await db
    .update(schema.operationalOrders)
    .set({ linkedWorkItemId: "work-A", updatedBy: "smoke", version: sql`${schema.operationalOrders.version} + 1` })
    .where(
      and(
        eq(schema.operationalOrders.id, order.id),
        sql`(${schema.operationalOrders.linkedWorkItemId} IS NULL OR ${schema.operationalOrders.linkedWorkItemId} = '')`
      )
    )
    .returning();
  const ok1 = Boolean(firstLink);
  console.log(`[run] Vínculo work-A: ${ok1 ? "OK" : "FALLÓ (inesperado)"}`);

  const [secondLink] = await db
    .update(schema.operationalOrders)
    .set({ linkedWorkItemId: "work-B", updatedBy: "smoke", version: sql`${schema.operationalOrders.version} + 1` })
    .where(
      and(
        eq(schema.operationalOrders.id, order.id),
        sql`(${schema.operationalOrders.linkedWorkItemId} IS NULL OR ${schema.operationalOrders.linkedWorkItemId} = '')`
      )
    )
    .returning();
  const ok2 = !secondLink; // debe fallar: ya está vinculada a work-A
  console.log(`[run] Vínculo work-B (debe rechazarse): ${ok2 ? "OK — rechazado como se espera" : "FALLÓ — se vinculó dos veces!"}`);

  let rejected = false;
  let rejectErr = null;
  try {
    await db.insert(schema.operationalOrders).values({
      orderNumber: MARKER,
      type: "OA",
      templateId: tmpl.id,
      templateVersion: 1,
      templateSnapshot: {},
      product: "SMOKE2",
      client: "SMOKE2",
      code: "SMOKE2",
      lot: "SMOKE2",
      assignedSector: "ENVASADO_MASIVO",
      formData: {},
      createdBy: "smoke",
      updatedBy: "smoke",
    });
  } catch (err) {
    rejected = true;
    rejectErr = String(err?.message ?? err);
  }
  const [{ count }] = await db
    .select({ count: sql`count(*)`.mapWith(Number) })
    .from(schema.operationalOrders)
    .where(eq(schema.operationalOrders.orderNumber, MARKER));
  const uniqueOk = rejected && count === 1;
  console.log(
    `[run] Constraint único de order_number (debe rechazar duplicado): ${uniqueOk ? "OK" : "FALLÓ"} — rejected=${rejected} rowsWithNumber=${count}${rejectErr ? ` err="${rejectErr}"` : ""}`
  );

  const allOk = ok1 && ok2 && uniqueOk;
  console.log(allOk ? "[run] 1 trabajo = 1 OA — CONFIRMADO." : "[run] MISMATCH.");
  await pool.end();
  process.exit(allOk ? 0 : 1);
}

if (mode === "cleanup") {
  await db.delete(schema.operationalOrders).where(eq(schema.operationalOrders.orderNumber, MARKER));
  await db.delete(schema.orderTemplates).where(sql`${schema.orderTemplates.productId} LIKE 'smoke-oa-uniq-%'`);
  console.log("[cleanup] OK");
  await pool.end();
  process.exit(0);
}

console.error("Modo desconocido. Usar run | cleanup.");
process.exit(1);
