/**
 * CONTROL SEMANAL TOTAL de MP contra un Postgres de PRUEBA real: OE y trabajos de Elaboración reales, stock real de `inv_mp_stock`.
 * Se corre con `GENUS_E2E_VITEST_FILES=src/integration/mp-weekly-total.db.integration.test.ts npm run test:e2e:semanas-priorities-db`.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const prod = { email: "it-wt-prod@laboratoriogenus.com.ar", sector: "PRODUCCION", displayName: "IT Producción" };
const RUN = Date.now().toString().slice(-5);
const CLIENT = `IT WT CLIENTE ${RUN}`;
const NOTE = `IT-WT-${RUN}`;
const WEEK = "2032-03-01"; // lunes propio de esta prueba
const NEXT_WEEK = "2032-03-08";
const OE_BASE = 700000 + Math.floor(Math.random() * 3000) * 100;
let seq = 0;
const oeNumber = () => `OE-2026-${String(OE_BASE + ++seq).padStart(6, "0")}`;
const CARB = `Carbopol WT${RUN}`;
const CODE = `WT-CAR-${RUN}`;

describe.skipIf(Boolean(PROBLEM))(`Control semanal total en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const works: Record<string, { workId: string; orderId: string }> = {};

  const seedFormula = async (product: string, pct: string) => {
    const { normalizeSearchKey } = await import("@/lib/formulas/types");
    const productId = randomUUID();
    const versionId = randomUUID();
    await q(`insert into formula_products (id, normalized_client, normalized_product, display_client, display_product, product_code, active_version_id) values ($1,$2,$3,$4,$5,'PT-WT',$6)`, [productId, normalizeSearchKey(CLIENT), normalizeSearchKey(product), CLIENT, product, versionId]);
    await q(`insert into formula_versions (id, product_id, version, status, source_hash, semantic_hash, validation_status, source_sheet) values ($1,$2,1,'VIGENTE',$3,$3,'OK','Hoja WT')`, [versionId, productId, `hash-${versionId}`]);
    await q(`insert into formula_ingredients (id, formula_version_id, position, material_name, material_code_or_phase, percentage) values ($1,$2,1,$3,$4,$5)`, [randomUUID(), versionId, CARB, CODE, pct]);
    await q(`insert into formula_ingredients (id, formula_version_id, position, material_name, material_code_or_phase, percentage) values ($1,$2,2,'Agua',$3,$4)`, [randomUUID(), versionId, `WT-AGUA-${RUN}`, String(100 - Number(pct))]);
    await q(`insert into formula_procedure_steps (id, formula_version_id, position, instruction) values ($1,$2,1,'Mezclar')`, [randomUUID(), versionId]);
  };
  const seedLot = async (codigo: string, descripcion: string, lote: string, kg: number) => {
    const id = randomUUID();
    const now = new Date().toISOString();
    await q(`insert into inv_mp_stock (id, payload) values ($1, $2::jsonb)`, [id, JSON.stringify({ id, codigo, descripcion, proveedor: "Prov", lote, cantidadKg: kg, vencimiento: "2040-12-31", estadoStock: "Stock OK", ubicacion: "Dep", origen: "manual", createdBy: NOTE, updatedBy: NOTE, createdAt: now, updatedAt: now })]);
  };
  const assign = async (product: string, over: Record<string, unknown> = {}) => {
    const { assignWorkItemDurable } = await import("@/lib/planning/work-assignment-service");
    const { prepareOeAfterWorkChange } = await import("@/lib/planning/oe-auto-prep");
    const input = { sector: "ELABORACION" as const, client: CLIENT, product, plannedQuantity: "100", unit: "kg", plannedDate: WEEK, branchOwner: "Cristian", orderNumber: oeNumber(), packagingLote: "IT-WT-L", notes: NOTE, idempotencyKey: randomUUID(), ...over };
    const result = await assignWorkItemDurable(input as never, prod, randomUUID());
    if (result.order?.id) await prepareOeAfterWorkChange(result.order.id, prod, "Asignación IT");
    return { workId: result.item.id as string, orderId: result.order!.id as string };
  };
  const total = async (week: string = WEEK) => (await import("@/lib/mp-control/weekly-availability-service")).getWeeklyTotal(week);
  const carb = (res: Awaited<ReturnType<typeof total>>) => res.rows.find((r) => r.codigo === CODE.toUpperCase());

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
    await seedLot(CODE, CARB, "C1", 7);
    await seedLot(CODE, CARB, "C2", 5); // 12 kg en total, dos lotes
    await seedLot(`WT-AGUA-${RUN}`, "Agua", "A1", 900);
    for (const [name, pct] of [["A", "3"], ["B", "5"], ["C", "3"], ["D", "6"], ["E", "1"], ["X", "9"], ["Y", "8"], ["Z", "4"]] as const) await seedFormula(`PROD ${name} WT ${RUN}`, pct);
  }, 90_000);

  afterAll(async () => {
    await q("update work_items set deleted_at = now() where notes = $1", [NOTE]).catch(() => undefined);
    await q("delete from inv_mp_stock where payload->>'createdBy' = $1", [NOTE]).catch(() => undefined);
    await pool?.end();
  });

  it("cinco OE con el mismo Carbopol (3+5+3+6+1) se consolidan en UNA fila de 18 kg; stock 12 → faltante 6; coincide con inventario", async () => {
    for (const n of ["A", "B", "C", "D", "E"]) works[n] = await assign(`PROD ${n} WT ${RUN}`);
    const res = await total();
    const rows = res.rows.filter((r) => r.codigo === CODE.toUpperCase());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ necesario: 18, teorico: 18, consumido: 0, stockDisponible: 12, stockFisico: 12, faltante: 6, oeCount: 5, estado: "FALTANTE" });
    expect(rows[0]!.needs).toHaveLength(5);
    expect(rows[0]!.needs.every((n) => n.lotKg === 100 && n.client === CLIENT)).toBe(true);
    const inv = await q(`select sum((payload->>'cantidadKg')::float) s from inv_mp_stock where payload->>'codigo' = $1`, [CODE]);
    expect(Number(inv[0]!.s)).toBe(rows[0]!.stockDisponible);
  });

  it("trabajos cancelados y OE ya completadas NO suman (el total no cambia)", async () => {
    works.X = await assign(`PROD X WT ${RUN}`); // se cancelará
    works.Y = await assign(`PROD Y WT ${RUN}`); // OE completada
    await q("update work_items set operational_status = 'cancelado' where id = $1", [works.X!.workId]);
    await q("update operational_orders set status = 'COMPLETA' where id = $1", [works.Y!.orderId]);
    const res = await total();
    expect(carb(res)!.necesario).toBe(18);
    expect(res.omitted.map((o) => o.note).join(" ")).toMatch(/Cancelado/);
    expect(res.omitted.map((o) => o.note).join(" ")).toMatch(/finalizado/);
    expect(res.summary.oeCount).toBe(5);
  });

  it("OE sin fecha: no entra a la semana actual; aparece solo en «Sin fecha»", async () => {
    works.Z = await assign(`PROD Z WT ${RUN}`, { plannedDate: undefined });
    const week = await total();
    expect(carb(week)!.necesario).toBe(18);
    const sin = await total("sin-fecha");
    expect(sin.mode).toBe("sin-fecha");
    const r = sin.rows.find((x) => x.codigo === CODE.toUpperCase())!;
    expect(r.needs.some((n) => n.productionId === works.Z!.workId && n.days === "Sin fecha" && n.pendiente === 4)).toBe(true);
    expect(sin.rows.every((x) => x.needs.every((n) => n.days === "Sin fecha"))).toBe(true);
  });

  it("cambiar de semana cambia el resultado; la semana siguiente (vacía) no tiene esta MP", async () => {
    const next = await total(NEXT_WEEK);
    expect(carb(next)).toBeUndefined();
    works.W = await assign(`PROD A WT ${RUN}`, { plannedDate: NEXT_WEEK, orderNumber: oeNumber() });
    expect(carb(await total(NEXT_WEEK))!.necesario).toBe(3);
    expect(carb(await total(WEEK))!.necesario).toBe(18);
  });

  it("no genera movimientos de stock ni modifica el inventario", async () => {
    const before = await q("select count(*)::int n from mp_stock_movements");
    const lotsBefore = await q(`select sum((payload->>'cantidadKg')::float) s from inv_mp_stock where payload->>'createdBy' = $1`, [NOTE]);
    await total();
    await total("sin-fecha");
    const after = await q("select count(*)::int n from mp_stock_movements");
    const lotsAfter = await q(`select sum((payload->>'cantidadKg')::float) s from inv_mp_stock where payload->>'createdBy' = $1`, [NOTE]);
    expect(after[0]!.n).toBe(before[0]!.n);
    expect(lotsAfter[0]!.s).toBe(lotsBefore[0]!.s);
  });
});
