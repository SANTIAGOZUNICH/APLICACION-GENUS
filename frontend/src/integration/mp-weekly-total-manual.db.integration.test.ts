/**
 * CONTROL SEMANAL TOTAL — observaciones, reemplazo MANUAL de MP, exclusión/restauración y buscador libre, contra Postgres de PRUEBA real.
 * Se corre con `GENUS_E2E_VITEST_FILES=src/integration/mp-weekly-total-manual.db.integration.test.ts npm run test:e2e:semanas-priorities-db`.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const prod = { email: "it-wtm-prod@laboratoriogenus.com.ar", sector: "PRODUCCION", displayName: "IT Producción" };
const RUN = Date.now().toString().slice(-5);
const CLIENT = `IT WTM CLIENTE ${RUN}`;
const NOTE = `IT-WTM-${RUN}`;
const WEEK = "2033-03-07"; // lunes propio de esta prueba
const OE_BASE = 800000 + Math.floor(Math.random() * 3000) * 100;
let seq = 0;
const oeNumber = () => `OE-2026-${String(OE_BASE + ++seq).padStart(6, "0")}`;
const EMUL = `EMULSIONANTE X${RUN}`;
const EMUL_CODE = `WTM-EMX-${RUN}`;
const REAL = `EMULCARE EI ${RUN}`;
const REAL_CODE = `MP023-${RUN}`;

describe.skipIf(Boolean(PROBLEM))(`Control semanal total manual en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const svc = () => import("@/lib/mp-control/weekly-availability-service");

  const seedFormula = async (product: string, ingredients: Array<[string, string, string]>) => {
    const { normalizeSearchKey } = await import("@/lib/formulas/types");
    const productId = randomUUID();
    const versionId = randomUUID();
    await q(`insert into formula_products (id, normalized_client, normalized_product, display_client, display_product, product_code, active_version_id) values ($1,$2,$3,$4,$5,'PT-WTM',$6)`, [productId, normalizeSearchKey(CLIENT), normalizeSearchKey(product), CLIENT, product, versionId]);
    await q(`insert into formula_versions (id, product_id, version, status, source_hash, semantic_hash, validation_status, source_sheet) values ($1,$2,1,'VIGENTE',$3,$3,'OK','Hoja WTM')`, [versionId, productId, `hash-${versionId}`]);
    let i = 0;
    for (const [name, code, pct] of ingredients) await q(`insert into formula_ingredients (id, formula_version_id, position, material_name, material_code_or_phase, percentage) values ($1,$2,$3,$4,$5,$6)`, [randomUUID(), versionId, ++i, name, code, pct]);
    await q(`insert into formula_procedure_steps (id, formula_version_id, position, instruction) values ($1,$2,1,'Mezclar')`, [randomUUID(), versionId]);
  };
  const seedLot = async (codigo: string, descripcion: string, lote: string, kg: number) => {
    const id = randomUUID();
    const now = new Date().toISOString();
    await q(`insert into inv_mp_stock (id, payload) values ($1, $2::jsonb)`, [id, JSON.stringify({ id, codigo, descripcion, proveedor: "Prov", lote, cantidadKg: kg, vencimiento: "2040-12-31", estadoStock: "Stock OK", ubicacion: "Dep", origen: "manual", createdBy: NOTE, updatedBy: NOTE, createdAt: now, updatedAt: now })]);
  };
  const assign = async (product: string, qty: string) => {
    const { assignWorkItemDurable } = await import("@/lib/planning/work-assignment-service");
    const { prepareOeAfterWorkChange } = await import("@/lib/planning/oe-auto-prep");
    const input = { sector: "ELABORACION" as const, client: CLIENT, product, plannedQuantity: qty, unit: "kg", plannedDate: WEEK, branchOwner: "Cristian", orderNumber: oeNumber(), packagingLote: "IT-WTM-L", notes: NOTE, idempotencyKey: randomUUID() };
    const result = await assignWorkItemDurable(input as never, prod, randomUUID());
    if (result.order?.id) await prepareOeAfterWorkChange(result.order.id, prod, "Asignación IT");
  };
  const total = async () => (await svc()).getWeeklyTotal(WEEK);
  const rowOf = (res: Awaited<ReturnType<typeof total>>, codigoOrName: string) => res.rows.find((r) => r.codigo === codigoOrName.toUpperCase() || r.materiaPrima === codigoOrName);

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
    await seedLot(REAL_CODE, `${REAL} — Proveedor Z`, "R1", 20);
    await seedLot(`WTM-GLI-${RUN}`, `Glicerina WTM${RUN}`, "G1", 500);
    await seedFormula(`PROD A WTM ${RUN}`, [[EMUL, EMUL_CODE, "5"], [`Glicerina WTM${RUN}`, `WTM-GLI-${RUN}`, "10"]]);
    await seedFormula(`PROD B WTM ${RUN}`, [[EMUL, EMUL_CODE, "5"]]);
    await assign(`PROD A WTM ${RUN}`, "100");
    await assign(`PROD B WTM ${RUN}`, "100");
  }, 120_000);

  afterAll(async () => {
    await q("update work_items set deleted_at = now() where notes = $1", [NOTE]).catch(() => undefined);
    await q("delete from inv_mp_stock where payload->>'createdBy' = $1", [NOTE]).catch(() => undefined);
    await q("delete from mp_weekly_row_state where week_start = $1", [WEEK]).catch(() => undefined);
    await q("delete from mp_weekly_total_replacements where source_key like $1", [`%wtm%`]).catch(() => undefined);
    await pool?.end();
  });

  it("la MP de fórmula sin equivalente en el inventario aparece NO IDENTIFICADA y suma sus 10 kg de las dos OE", async () => {
    const r = await total();
    const row = r.rows.find((x) => x.materiaPrima.toLowerCase().startsWith("emulsionante x"));
    expect(row).toBeTruthy();
    expect(row).toMatchObject({ necesario: 10, identificada: false, stockDisponible: 0, faltante: 10 });
  });

  it("buscador libre: encuentra EMULCARE (nombre totalmente distinto) y por código; sin acentos/mayúsculas; sin resultados si no existe", async () => {
    const s = await svc();
    const porNombre = await s.searchInventoryMps("emulcare");
    expect(porNombre.map((h) => h.codigo)).toContain(REAL_CODE.toUpperCase());
    expect(porNombre.find((h) => h.codigo === REAL_CODE.toUpperCase())).toMatchObject({ materiaPrima: `${REAL}`, stockKg: 20 });
    expect((await s.searchInventoryMps("MP023")).map((h) => h.codigo)).toContain(REAL_CODE.toUpperCase());
    expect((await s.searchInventoryMps("  EMULCÁRE  ei")).length).toBeGreaterThan(0);
    expect(await s.searchInventoryMps("zzz-no-existe-zzz")).toHaveLength(0);
    expect((await s.searchInventoryMps("")).length).toBeGreaterThan(1); // sin texto lista el inventario
  });

  it("reemplazo MANUAL: EMULSIONANTE X → EMULCARE EI mantiene los kg, usa su stock y persiste (nueva lectura)", async () => {
    const s = await svc();
    const before = await total();
    const src = before.rows.find((x) => x.materiaPrima.toLowerCase().startsWith("emulsionante x"))!;
    await s.setTotalReplacement({ sourceKey: src.key, sourceLabel: src.materiaPrima, targetCode: REAL_CODE, by: "mp@test" });
    vi.resetModules(); // «recargar»: nada vive en memoria
    const after = await (await svc()).getWeeklyTotal(WEEK);
    expect(after.rows.find((x) => x.key === src.key)).toBeUndefined();
    const row = rowOf(after, REAL_CODE)!;
    expect(row).toMatchObject({ materiaPrima: REAL, necesario: 10, stockDisponible: 20, faltante: 0, identificada: true, estado: "SUFICIENTE" });
    expect(row.reemplazos).toHaveLength(1);
    expect(row.reemplazos[0]).toMatchObject({ sourceKey: src.key, kg: 10 });
    expect(row.needs.every((n) => /emulsionante x/i.test(n.origen ?? ""))).toBe(true);
    expect(after.replacements.some((x) => x.sourceKey === src.key && x.targetCode === REAL_CODE.toUpperCase())).toBe(true);
    // No toca fórmulas ni inventario.
    const ing = await q("select count(*)::int n from formula_ingredients where material_name = $1", [EMUL]);
    expect(Number(ing[0]!.n)).toBe(2);
    const stock = await q("select sum((payload->>'cantidadKg')::float) s from inv_mp_stock where payload->>'codigo' = $1", [REAL_CODE]);
    expect(Number(stock[0]!.s)).toBe(20);
  });

  it("un reemplazo hacia un código inexistente se rechaza", async () => {
    await expect((await svc()).setTotalReplacement({ sourceKey: "name:x", sourceLabel: "x", targetCode: "NO-EXISTE-999", by: "mp@test" })).rejects.toThrow(/no existe/);
  });

  it("observación: se guarda, persiste tras recargar, se modifica y se borra", async () => {
    let s = await svc();
    const row = rowOf(await total(), REAL_CODE)!;
    await s.saveTotalNote({ week: WEEK, rowKey: row.key, label: row.materiaPrima, observacion: "Pedir 20 kg a proveedor", by: "mp@test" });
    vi.resetModules();
    s = await svc();
    expect(rowOf(await s.getWeeklyTotal(WEEK), REAL_CODE)!.observacion).toBe("Pedir 20 kg a proveedor");
    await s.saveTotalNote({ week: WEEK, rowKey: row.key, label: row.materiaPrima, observacion: "Cambiado", by: "mp@test" });
    expect(rowOf(await s.getWeeklyTotal(WEEK), REAL_CODE)!.observacion).toBe("Cambiado");
    await s.saveTotalNote({ week: WEEK, rowKey: row.key, label: row.materiaPrima, observacion: "", by: "mp@test" });
    expect(rowOf(await s.getWeeklyTotal(WEEK), REAL_CODE)!.observacion).toBe("");
  });

  it("excluir varias MP: no vuelven al actualizar, no se borra nada maestro y se pueden restaurar", async () => {
    let s = await svc();
    const rows = (await s.getWeeklyTotal(WEEK)).rows;
    expect(rows.length).toBeGreaterThanOrEqual(2);
    await s.excludeTotalRows({ week: WEEK, rows: rows.map((r) => ({ rowKey: r.key, label: r.materiaPrima })), by: "mp@test" });
    vi.resetModules();
    s = await svc();
    const after = await s.getWeeklyTotal(WEEK);
    expect(after.rows).toHaveLength(0);
    expect(after.excluidas.map((e) => e.key).sort()).toEqual(rows.map((r) => r.key).sort());
    expect(after.summary).toMatchObject({ total: 0, necesarioKg: 0 });
    // Inventario, OE y fórmulas intactos.
    expect(Number((await q("select count(*)::int n from inv_mp_stock where payload->>'createdBy' = $1", [NOTE]))[0]!.n)).toBe(2);
    expect(Number((await q("select count(*)::int n from work_items where notes = $1 and deleted_at is null", [NOTE]))[0]!.n)).toBe(2);
    await s.restoreTotalRows({ week: WEEK, rowKeys: [rows[0]!.key] });
    const restored = await s.getWeeklyTotal(WEEK);
    expect(restored.rows.map((r) => r.key)).toEqual([rows[0]!.key]);
    expect(restored.excluidas).toHaveLength(rows.length - 1);
  });

  it("deshacer el reemplazo devuelve la MP a su identificación automática", async () => {
    const s = await svc();
    const rep = (await s.getWeeklyTotal(WEEK)).replacements.find((x) => x.targetCode === REAL_CODE.toUpperCase())!;
    await s.removeTotalReplacement(rep.sourceKey);
    await s.restoreTotalRows({ week: WEEK, rowKeys: (await s.getWeeklyTotal(WEEK)).excluidas.map((e) => e.key) });
    const r = await s.getWeeklyTotal(WEEK);
    expect(r.rows.some((x) => x.materiaPrima.toLowerCase().startsWith("emulsionante x") && !x.identificada)).toBe(true);
  });
});
