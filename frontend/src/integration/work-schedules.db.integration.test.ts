/** Programaciones de una misma OE/OA en varios días contra Postgres de PRUEBA real. */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const prod = { email: "it-ws-prod@laboratoriogenus.com.ar", sector: "PRODUCCION", displayName: "IT Producción" };
const RUN = Date.now().toString().slice(-6);
const CLIENT = `IT WS CLIENTE ${RUN}`;
const NOTE = `IT-WS-${RUN}`;
const D1 = "2031-07-07"; // lunes
const D2 = "2031-07-08";
const D3 = "2031-07-09";
const W2 = "2031-07-14"; // lunes de la semana siguiente
const OA = `OA-2026-${String(900000 + Math.floor(Math.random() * 90000)).padStart(6, "0")}`;
const OE = `OE-2026-${String(900000 + Math.floor(Math.random() * 90000)).padStart(6, "0")}`;
const LAN = `Lanolina WS${RUN}`;

describe.skipIf(Boolean(PROBLEM))(`Programaciones de una misma OE/OA en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
  }, 60_000);

  afterAll(async () => {
    await q("update work_items set deleted_at = now() where notes = $1", [NOTE]).catch(() => undefined);
    await q("delete from inv_mp_stock where payload->>'createdBy' = $1", [NOTE]).catch(() => undefined);
    await pool?.end();
  });

  const sched = () => import("@/lib/planning/work-schedules-service");

  it("OA de 5.000 u.: lunes 2.000, martes 1.500, miércoles 1.500 — la MISMA OA, sin órdenes, pedidos, stock ni entregas nuevos", async () => {
    const { assignWorkItemDurable } = await import("@/lib/planning/work-assignment-service");
    const r = await assignWorkItemDurable({ sector: "ENVASADO_MASIVO", client: CLIENT, product: `Crema Facial WS${RUN}`, plannedQuantity: "5000", unit: "u", plannedDate: D1, line: "Línea 1", orderNumber: OA, packagingLote: "IT-WS", notes: NOTE, idempotencyKey: randomUUID() } as never, prod, randomUUID());
    const rootId = r.item.id as string;
    const orderId = r.order!.id as string;
    const before = {
      orders: Number((await q("select count(*)::int n from operational_orders"))[0]!.n),
      movs: Number((await q("select count(*)::int n from mp_stock_movements"))[0]!.n),
      deliveries: Number((await q("select count(*)::int n from work_item_deliveries"))[0]!.n),
      pedidos: Number((await q("select count(*)::int n from production_pedidos"))[0]!.n),
    };
    const { addSchedulesDurable, listSchedulesDurable, removeScheduleDurable } = await sched();
    const key = `ws-${RUN}-1`;
    const out = await addSchedulesDurable({ sourceId: rootId, items: [{ plannedDate: D2, quantity: "1500" }, { plannedDate: D3, quantity: "1500" }], rebalanceSource: true, idempotencyKey: key }, prod);
    expect(out.created).toHaveLength(2);
    expect(out.schedules.map((s) => [s.plannedDate, s.quantity])).toEqual([[D1, "2000"], [D2, "1500"], [D3, "1500"]]);
    const rows = await q("select id, order_id, order_number, schedule_root_id, planned_quantity, planned_date::text d from work_items where id = $1 or schedule_root_id = $1 order by planned_date", [rootId]);
    expect(rows.every((x) => x.order_id === orderId && x.order_number === OA)).toBe(true);
    expect(rows.filter((x) => x.schedule_root_id === rootId)).toHaveLength(2);
    // Nada duplicado.
    expect(Number((await q("select count(*)::int n from operational_orders"))[0]!.n)).toBe(before.orders);
    expect(Number((await q("select count(*)::int n from mp_stock_movements"))[0]!.n)).toBe(before.movs);
    expect(Number((await q("select count(*)::int n from work_item_deliveries"))[0]!.n)).toBe(before.deliveries);
    expect(Number((await q("select count(*)::int n from production_pedidos"))[0]!.n)).toBe(before.pedidos);
    expect(Number((await q("select count(*)::int n from operational_orders where order_number = $1", [OA]))[0]!.n)).toBe(1);
    // Doble clic / reintento: misma clave = misma operación.
    const again = await addSchedulesDurable({ sourceId: rootId, items: [{ plannedDate: D2, quantity: "1500" }, { plannedDate: D3, quantity: "1500" }], rebalanceSource: true, idempotencyKey: key }, prod);
    expect(again.replayed).toBe(true);
    expect((await listSchedulesDurable(rootId))!.schedules).toHaveLength(3);
    // Validaciones.
    await expect(addSchedulesDurable({ sourceId: rootId, items: [{ plannedDate: D2, quantity: "10" }], idempotencyKey: `ws-${RUN}-2` }, prod)).rejects.toThrow(/ya tiene una programación/);
    await expect(addSchedulesDurable({ sourceId: rootId, items: [{ plannedDate: "2031-07-10", quantity: "100" }], idempotencyKey: `ws-${RUN}-3` }, prod)).rejects.toThrow(/superar la cantidad/);
    await expect(addSchedulesDurable({ sourceId: rootId, items: [{ plannedDate: "2031-07-10", quantity: "100" }], idempotencyKey: `ws-${RUN}-4` }, { ...prod, sector: "ELABORACION" })).rejects.toThrow(/Solo Producción/);
    // Quitar una programación: la orden y las demás se mantienen; la original no se puede quitar mientras haya otras.
    await expect(removeScheduleDurable(rootId, prod)).rejects.toThrow(/original/);
    const third = out.created.find((s) => s.plannedDate === D3)!;
    await removeScheduleDurable(third.id, prod);
    expect((await listSchedulesDurable(rootId))!.schedules.map((s) => s.plannedDate)).toEqual([D1, D2]);
    expect(Number((await q("select count(*)::int n from operational_orders where order_number = $1 and deleted_at is null", [OA]))[0]!.n)).toBe(1);
    // El borrado masivo tampoco deja a las demás sin raíz.
    const { bulkDeleteWorkItemsDurable } = await import("@/lib/planning/bulk-delete-works-service");
    const dry = await bulkDeleteWorkItemsDurable({ ids: [`native:${rootId}`], reason: "x", actorEmail: prod.email, dryRun: true });
    expect(dry.verdicts[0]!.code).toBe("BLOCKED_HAS_SCHEDULES");
    // Auditoría.
    const ev = await q("select type from operational_events where work_item_id = any($1::uuid[]) and type like 'SCHEDULE_%'", [[rootId, ...out.created.map((c) => c.id)]]);
    expect(ev.map((e) => e.type).sort()).toEqual(["SCHEDULE_ADDED", "SCHEDULE_ADDED", "SCHEDULE_REBALANCED", "SCHEDULE_REMOVED"]);
  });

  it("OE de 1.000 kg en 300 / 400 / 300 repartida en dos semanas: la necesidad de MP suma UNA vez (no se duplica por semana)", async () => {
    const { normalizeSearchKey } = await import("@/lib/formulas/types");
    const productId = randomUUID();
    const versionId = randomUUID();
    const product = `CREMA LANO WS${RUN}`;
    await q(`insert into formula_products (id, normalized_client, normalized_product, display_client, display_product, product_code, active_version_id) values ($1,$2,$3,$4,$5,'PT-WS',$6)`, [productId, normalizeSearchKey(CLIENT), normalizeSearchKey(product), CLIENT, product, versionId]);
    await q(`insert into formula_versions (id, product_id, version, status, source_hash, semantic_hash, validation_status, source_sheet) values ($1,$2,1,'VIGENTE',$3,$3,'OK','Hoja WS')`, [versionId, productId, `hash-${versionId}`]);
    await q(`insert into formula_ingredients (id, formula_version_id, position, material_name, material_code_or_phase, percentage) values ($1,$2,1,$3,$4,'25')`, [randomUUID(), versionId, LAN, `F-LAN${RUN}`]);
    await q(`insert into formula_ingredients (id, formula_version_id, position, material_name, material_code_or_phase, percentage) values ($1,$2,2,$3,$4,'75')`, [randomUUID(), versionId, `Agua WS${RUN}`, `F-AGU${RUN}`]);
    await q(`insert into formula_procedure_steps (id, formula_version_id, position, instruction) values ($1,$2,1,'Mezclar')`, [randomUUID(), versionId]);
    const sid = randomUUID();
    const now = new Date().toISOString();
    await q(`insert into inv_mp_stock (id, payload) values ($1, $2::jsonb)`, [sid, JSON.stringify({ id: sid, codigo: `WS-LAN${RUN}`, descripcion: LAN, proveedor: "P", lote: "L1", cantidadKg: 1000, vencimiento: "2032-12-31", estadoStock: "Stock OK", origen: "manual", createdBy: NOTE, updatedBy: NOTE, createdAt: now, updatedAt: now })]);
    const { assignWorkItemDurable } = await import("@/lib/planning/work-assignment-service");
    const { prepareOeAfterWorkChange } = await import("@/lib/planning/oe-auto-prep");
    const a = await assignWorkItemDurable({ sector: "ELABORACION", client: CLIENT, product, plannedQuantity: "1000", unit: "kg", plannedDate: D1, branchOwner: "Cristian", orderNumber: OE, packagingLote: "IT-WS", notes: NOTE, idempotencyKey: randomUUID() } as never, prod, randomUUID());
    if (a.order?.id) await prepareOeAfterWorkChange(a.order.id, prod, "Asignación IT");
    const { addSchedulesDurable } = await sched();
    await addSchedulesDurable({ sourceId: a.item.id as string, items: [{ plannedDate: D2, quantity: "400" }, { plannedDate: W2, quantity: "300" }], rebalanceSource: true, idempotencyKey: `ws-${RUN}-oe` }, prod);
    const { getWeeklyAvailability } = await import("@/lib/mp-control/weekly-availability-service");
    const w1 = await getWeeklyAvailability(D1);
    const w2 = await getWeeklyAvailability(W2);
    const row = (res: Awaited<ReturnType<typeof getWeeklyAvailability>>) => res.rows.find((x) => x.materiaPrima.toLowerCase().startsWith("lanolina ws"));
    // 25 % de 700 kg (300 + 400 de la 1.ª semana) = 175; 25 % de 300 kg (2.ª semana) = 75; total 250 = 25 % de 1.000 kg, UNA vez.
    expect(row(w1)?.requerido).toBeCloseTo(175, 3);
    expect(row(w2)?.requerido).toBeCloseTo(75, 3);
    expect((row(w1)?.requerido ?? 0) + (row(w2)?.requerido ?? 0)).toBeCloseTo(250, 3);
    const [oes] = await q("select count(*)::int n from operational_orders where order_number = $1", [OE]);
    expect(Number(oes!.n)).toBe(1);
  });
});
