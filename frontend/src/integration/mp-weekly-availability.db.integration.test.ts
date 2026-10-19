/**
 * Control semanal de MP contra un Postgres de PRUEBA real: el stock sale de `inv_mp_stock` (la misma tabla que el
 * inventario de Materias Primas), las producciones de `work_items`/OE reales y los consumos del libro mayor.
 * Se SALTA sin base local marcada. Se corre con `npm run test:e2e:produccion-edicion-db`.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const prod = { email: "it-wk-prod@laboratoriogenus.com.ar", sector: "PRODUCCION", displayName: "IT Producción" };
const RUN = Date.now().toString().slice(-5);
const CLIENT = `IT WK CLIENTE ${RUN}`;
const NOTE = `IT-WK-${RUN}`;
const WEEK = "2031-03-03"; // lunes: semana propia de esta prueba
const OE_BASE = 600000 + Math.floor(Math.random() * 3000) * 100;
let seq = 0;
const oeNumber = () => `OE-2026-${String(OE_BASE + ++seq).padStart(6, "0")}`;
const GLI = `Glicerina WK${RUN}`;
const AGUA = `Agua WK${RUN}`;
const PERF = `Perfume WK${RUN}`;
const PERFUME_PARECIDO = `Perfume floral WK${RUN}`;

describe.skipIf(Boolean(PROBLEM))(`Control semanal de MP en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const products: string[] = [];
  const works: Record<string, { workId: string; orderId: string }> = {};

  const seedFormula = async (product: string, rows: Array<[string, string, string]>) => {
    const { normalizeSearchKey } = await import("@/lib/formulas/types");
    const productId = randomUUID();
    const versionId = randomUUID();
    await q(`insert into formula_products (id, normalized_client, normalized_product, display_client, display_product, product_code, active_version_id) values ($1,$2,$3,$4,$5,'PT-WK',$6)`, [productId, normalizeSearchKey(CLIENT), normalizeSearchKey(product), CLIENT, product, versionId]);
    await q(`insert into formula_versions (id, product_id, version, status, source_hash, semantic_hash, validation_status, source_sheet) values ($1,$2,1,'VIGENTE',$3,$3,'OK','Hoja WK')`, [versionId, productId, `hash-${versionId}`]);
    let pos = 0;
    for (const [name, code, pct] of rows) await q(`insert into formula_ingredients (id, formula_version_id, position, material_name, material_code_or_phase, percentage) values ($1,$2,$3,$4,$5,$6)`, [randomUUID(), versionId, ++pos, name, code, pct]);
    await q(`insert into formula_procedure_steps (id, formula_version_id, position, instruction) values ($1,$2,1,'Mezclar')`, [randomUUID(), versionId]);
    products.push(product);
  };
  const seedLot = async (codigo: string, descripcion: string, proveedor: string, lote: string, kg: number, extra: Record<string, unknown> = {}) => {
    const id = randomUUID();
    const now = new Date().toISOString();
    await q(`insert into inv_mp_stock (id, payload) values ($1, $2::jsonb)`, [id, JSON.stringify({ id, codigo, descripcion, proveedor, lote, cantidadKg: kg, vencimiento: "2032-12-31", estadoStock: "Stock OK", ubicacion: "Dep", origen: "manual", createdBy: NOTE, updatedBy: NOTE, createdAt: now, updatedAt: now, ...extra })]);
    return id;
  };
  const assign = async (product: string, qty: string, over: Record<string, unknown> = {}) => {
    const { assignWorkItemDurable } = await import("@/lib/planning/work-assignment-service");
    const { prepareOeAfterWorkChange } = await import("@/lib/planning/oe-auto-prep");
    const input = { sector: "ELABORACION" as const, client: CLIENT, product, plannedQuantity: qty, unit: "kg", plannedDate: WEEK, branchOwner: "Cristian", orderNumber: oeNumber(), packagingLote: "IT-WK-L", notes: NOTE, idempotencyKey: randomUUID(), ...over };
    const result = await assignWorkItemDurable(input as never, prod, randomUUID());
    if (result.order?.id) await prepareOeAfterWorkChange(result.order.id, prod, "Asignación IT");
    return { workId: result.item.id as string, orderId: result.order!.id as string };
  };
  const avail = async () => (await import("@/lib/mp-control/weekly-availability-service")).getWeeklyAvailability(WEEK);
  const rowOf = (res: Awaited<ReturnType<typeof avail>>, name: string) => res.rows.find((r) => r.materiaPrima.toLowerCase().startsWith(name.toLowerCase()));
  const sumLots = async (names: string[]) => {
    const rows = await q(`select payload from inv_mp_stock where payload->>'createdBy' = $1`, [NOTE]);
    return rows.filter((r) => names.some((n) => String((r.payload as { descripcion: string }).descripcion).toLowerCase().startsWith(n.toLowerCase()))).reduce((s, r) => s + Number((r.payload as { cantidadKg: number }).cantidadKg), 0);
  };
  let movsBefore = 0;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
    // Glicerina: tres proveedores (30 kg en total, más 6 kg vencidos y 5 bloqueados que NO se pueden usar).
    await seedLot(`WK-GLI-A${RUN}`, `${GLI} — Proveedor A`, "Proveedor A", "A1", 10);
    await seedLot(`WK-GLI-A${RUN}`, `${GLI} — Proveedor A`, "Proveedor A", "A2", 0);
    await seedLot(`WK-GLI-B${RUN}`, `${GLI} — Proveedor B`, "Proveedor B", "B1", 8);
    await seedLot(`WK-GLI-C${RUN}`, `${GLI} — Proveedor C`, "Proveedor C", "C1", 12);
    await seedLot(`WK-GLI-B${RUN}`, `${GLI} — Proveedor B`, "Proveedor B", "B-VENC", 6, { vencimiento: "2020-01-01" });
    await seedLot(`WK-GLI-C${RUN}`, `${GLI} — Proveedor C`, "Proveedor C", "C-BLOQ", 5, { estadoStockManual: "Bloqueado" });
    await seedLot(`WK-AGUA${RUN}`, AGUA, "Aguas SA", "AG1", 500);
    // Dos perfumes de nombre parecido que NO son equivalentes.
    await seedLot(`WK-PERF-1${RUN}`, PERF, "Esencias SA", "P1", 3);
    await seedLot(`WK-PERF-2${RUN}`, PERFUME_PARECIDO, "Esencias SA", "P2", 40);
    await seedFormula(`CREMA A WK ${RUN}`, [[AGUA, `F-AGUA${RUN}`, "78"], [GLI, `F-GLI${RUN}`, "12"], [`Perfume suave WK${RUN}`, `F-PERF${RUN}`, "10"]]);
    await seedFormula(`CREMA B WK ${RUN}`, [[AGUA, `F-AGUA${RUN}`, "88"], [GLI, `F-GLI${RUN}`, "12"]]);
    const [m] = await q("select count(*)::int n from mp_stock_movements");
    movsBefore = Number(m!.n);
  }, 90_000);

  afterAll(async () => {
    await q("update work_items set deleted_at = now() where notes = $1", [NOTE]).catch(() => undefined);
    await q("delete from inv_mp_stock where payload->>'createdBy' = $1", [NOTE]).catch(() => undefined);
    await q("delete from mp_stock_movements where idempotency_key like $1", [`it-wk-${RUN}-%`]).catch(() => undefined);
    await q("delete from mp_master_links where approved_by = $1", [prod.email]).catch(() => undefined);
    await pool?.end();
  });

  it("suma los tres proveedores de glicerina (30 kg utilizables) y no cuenta vencidos ni bloqueados; coincide con el inventario", async () => {
    works.a = await assign(`CREMA A WK ${RUN}`, "100"); // glicerina 12 kg
    const res = await avail();
    const g = rowOf(res, "Glicerina")!;
    expect(g.stockUtilizable).toBe(30);
    expect(g.stockFisico).toBe(41); // 30 + 6 vencidos + 5 bloqueados
    expect(g.requerido).toBe(12);
    expect([g.saldoProyectado, g.estado]).toEqual([18, "SUFICIENTE"]);
    expect(g.proveedores.map((p) => p.proveedor).sort()).toEqual(["Proveedor A", "Proveedor B", "Proveedor C"]);
    expect(g.lotes.some((l) => !l.usable && l.motivo === "Vencido")).toBe(true);
    expect(g.lotes.some((l) => !l.usable && /Bloqueado/.test(l.motivo))).toBe(true);
    // Totales del control = inventario real
    expect(g.stockFisico).toBe(await sumLots([GLI]));
    expect(res.stockSource).toBe("inv_mp_stock");
  });

  it("varias producciones se suman ANTES de comparar contra el stock (12 + 30 = 42 > 30 → faltan 12)", async () => {
    works.b = await assign(`CREMA B WK ${RUN}`, "250"); // glicerina 30 kg
    const g = rowOf(await avail(), "Glicerina")!;
    expect(g.requerido).toBe(42);
    expect(g.needs).toHaveLength(2);
    expect([g.estado, g.faltante, g.saldoProyectado]).toEqual(["FALTANTE", 12, -12]);
  });

  it("un trabajo de varios días cuenta UNA vez", async () => {
    await q("update work_items set planned_date_to = $2 where id = $1", [works.b!.workId, "2031-03-06"]);
    const g = rowOf(await avail(), "Glicerina")!;
    expect(g.requerido).toBe(42);
  });

  it("un perfume de nombre parecido NO se une solo: queda pendiente de vincular, sin asumir stock cero, y se recuerda al confirmar", async () => {
    let res = await avail();
    const p = res.rows.find((r) => r.estado === "PENDIENTE DE VINCULAR" && r.materiaPrima.toLowerCase().startsWith("perfume"))!;
    expect(p).toBeTruthy();
    expect(p.requerido).toBe(10);
    expect(p.candidates.map((c) => c.descripcion)).toEqual(expect.arrayContaining([PERF, PERFUME_PARECIDO]));
    const svc = await import("@/lib/mp-control/weekly-availability-service");
    await svc.approveMpLink({ kind: "formula_name", key: p.formulaNames[0]!, masterCode: `WK-PERF-1${RUN}`, by: prod.email });
    res = await avail();
    const linked = rowOf(res, "Perfume WK")!;
    expect(linked.match).toBe("aprobada");
    expect([linked.stockUtilizable, linked.requerido, linked.estado, linked.faltante]).toEqual([3, 10, "FALTANTE", 7]);
    // el perfume parecido (40 kg) NO se sumó
    expect(res.rows.some((r) => r.materiaPrima === PERFUME_PARECIDO)).toBe(false);
  });

  it("hojas por tambor no duplican la necesidad (la OE se cuenta una vez)", async () => {
    const [o] = await q("select form_data from operational_orders where id = $1", [works.a!.orderId]);
    const fd = o!.form_data as { sheets?: unknown[] };
    const before = rowOf(await avail(), "Agua")!.requerido;
    const { createSheet } = await import("@/lib/orders/oe-sheets");
    const content = o!.form_data as never;
    fd.sheets = [createSheet(content, { kind: "tambor", kg: 50, by: "it" }), createSheet(content, { kind: "tambor", kg: 50, by: "it" })];
    await q("update operational_orders set form_data = $2::jsonb where id = $1", [works.a!.orderId, JSON.stringify(fd)]);
    expect(rowOf(await avail(), "Agua")!.requerido).toBe(before);
  });

  it("lo ya consumido por la OE (libro mayor) se resta de la necesidad pendiente", async () => {
    const before = rowOf(await avail(), "Glicerina")!.requerido;
    await q(
      `insert into mp_stock_movements (codigo, kind, quantity, reason, ref_type, ref_id, actor_email, actor_sector, idempotency_key) values ($1,'CONSUMO_OE',-12,'IT consumo','oe',$2,$3,'ELABORACION',$4)`,
      [`WK-GLI-A${RUN}`, works.a!.orderId, prod.email, `it-wk-${RUN}-consumo`]
    );
    const g = rowOf(await avail(), "Glicerina")!;
    // la OE de CREMA A ya consumió 12 kg de glicerina: sólo queda pendiente la de CREMA B (30 kg)
    expect(before - g.requerido).toBe(12);
    expect(g.requerido).toBe(30);
    await q("delete from mp_stock_movements where idempotency_key = $1", [`it-wk-${RUN}-consumo`]);
  });

  it("los cambios de stock se ven al actualizar y las pruebas no tocaron movimientos del libro mayor", async () => {
    await seedLot(`WK-GLI-C${RUN}`, `${GLI} — Proveedor C`, "Proveedor C", "C2", 20);
    const g = rowOf(await avail(), "Glicerina")!;
    expect(g.stockUtilizable).toBe(50);
    expect([g.estado, g.saldoProyectado]).toEqual(["SUFICIENTE", 8]);
    const [m] = await q("select count(*)::int n from mp_stock_movements");
    expect(Number(m!.n)).toBe(movsBefore);
  });

  it("la planilla de control individual usa el stock consolidado de todos los proveedores (antes mostraba 0 por código)", async () => {
    const { getMpControlService } = await import("@/lib/mp-control/mp-control-service");
    const mp = { email: "it-wk-mp@laboratoriogenus.com.ar", sector: "MATERIA_PRIMA" as const };
    const c = await getMpControlService().create(mp, {
      client: CLIENT,
      product: `CREMA A WK ${RUN}`,
      quantityKg: 100,
      snapshot: { client: CLIENT, product: `CREMA A WK ${RUN}`, source: "CACHE_NEON", capturedAt: new Date().toISOString(), materials: [{ materiaPrima: GLI, codigo: `F-GLI${RUN}`, formulaPct: 12 }, { materiaPrima: "Producto inexistente XYZ", codigo: "F-NADA", formulaPct: 1 }] },
    });
    expect(c.lines[0]!.stockActual).toBe(50);
    expect(c.lines[0]!.estado).toBe("Disponible");
    expect(c.lines[1]!.stockActual).toBeNull();
    expect(c.lines[1]!.estado).toBe("Sin vincular");
    await q("delete from mp_weekly_controls where id = $1", [c.id]);
  });
});
