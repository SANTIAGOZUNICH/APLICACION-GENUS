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
    // Caso real de producción: filas de Stock MP SIN CÓDIGO (antes el Control semanal las descartaba y mostraba 0).
    const HUM = `HUMECTANTE RW${RUN}`;
    for (const [d, kg] of [[HUM, 1.6], [`Humectante RW${RUN}`, 5], [HUM, 1], [`${HUM} VEGETAL`, 8.8], [`Humectante RW${RUN} vegetal`, 4], [`${HUM} VEGETAL`, 0.5], [`EXTRACTO HIDRO${HUM}`, 50]] as Array<[string, number]>) {
      await seedLot("", d, "Proveedor X", `RW-${kg}`, kg);
    }
    await seedFormula(`CREMA C WK ${RUN}`, [[HUM, `F-HUM${RUN}`, "10"], [AGUA, `F-AGUA${RUN}`, "90"]]);
    await seedFormula(`CREMA A WK ${RUN}`, [[AGUA, `F-AGUA${RUN}`, "78"], [GLI, `F-GLI${RUN}`, "12"], [`Perfume suave WK${RUN}`, `F-PERF${RUN}`, "10"]]);
    await seedFormula(`CREMA B WK ${RUN}`, [[AGUA, `F-AGUA${RUN}`, "88"], [GLI, `F-GLI${RUN}`, "12"]]);
    const [m] = await q("select count(*)::int n from mp_stock_movements");
    movsBefore = Number(m!.n);
  }, 90_000);

  afterAll(async () => {
    await q("update work_items set deleted_at = now() where notes = $1", [NOTE]).catch(() => undefined);
    await q("delete from inv_mp_stock where payload->>'createdBy' = $1", [NOTE]).catch(() => undefined);
    await q("delete from mp_stock_movements where idempotency_key like $1", [`it-wk-${RUN}-%`]).catch(() => undefined);
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

  it("un nombre solo parecido («Perfume suave» vs «Perfume») NO se suma solo: MP NO IDENTIFICADA con la sugerencia, sin asumir cero ni sumar el «floral»", async () => {
    const res = await avail();
    const p = rowOf(res, "Perfume suave")!;
    expect([p.stockUtilizable, p.requerido, p.estado]).toEqual([0, 10, "MP NO IDENTIFICADA"]);
    expect(p.related.map((r) => r.descripcion)).toEqual([PERF]);
    expect(res.rows.some((r) => r.materiaPrima === PERFUME_PARECIDO)).toBe(false);
  });

  it("CASO REAL: filas de Stock sin código se leen igual (7,6 kg exactos) y las descripciones parecidas se ofrecen sin sumarlas", async () => {
    const { lots } = await (await import("@/lib/mp-control/weekly-availability-service")).loadStockLots();
    expect(lots.filter((l) => l.codigo === "" && /humectante/i.test(l.descripcion))).toHaveLength(7);
    works.c = await assign(`CREMA C WK ${RUN}`, "100"); // humectante 10 kg
    const h = rowOf(await avail(), "HUMECTANTE")!;
    expect([h.stockFisico, h.stockUtilizable, h.requerido, h.estado, h.faltante]).toEqual([7.6, 7.6, 10, "FALTANTE", 2.4]);
    expect(h.related.map((r) => r.kg)).toEqual([13.3]); // «… VEGETAL» (8,8 + 4 + 0,5); el EXTRACTO HIDRO… nunca se ofrece
    const res = await avail();
    expect(res.stockRowsRead).toBeGreaterThanOrEqual(13);
  });

  it("al sumar la descripción «… VEGETAL» (una vez, por materia prima) quedan 20,9 kg y se recuerda", async () => {
    const svc = await import("@/lib/mp-control/weekly-availability-service");
    await svc.approveNameAlias({ formulaName: `HUMECTANTE RW${RUN}`, stockName: `HUMECTANTE RW${RUN} VEGETAL`, by: prod.email });
    const h = rowOf(await avail(), "HUMECTANTE")!;
    expect([h.stockUtilizable, h.estado, h.saldoProyectado, h.related.length]).toEqual([20.9, "SUFICIENTE", 10.9, 0]);
    expect(await sumLots([`HUMECTANTE RW${RUN}`])).toBe(20.9); // el inventario no se tocó (la prueba no modifica stock)
    await svc.removeNameAlias({ formulaName: `HUMECTANTE RW${RUN}`, stockName: `HUMECTANTE RW${RUN} VEGETAL` });
    expect(rowOf(await avail(), "HUMECTANTE")!.stockUtilizable).toBe(7.6);
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
    expect(c.lines[1]!.stockActual).toBe(0);
    expect(c.lines[1]!.estado).toBe("Sin stock");
    await q("delete from mp_weekly_controls where id = $1", [c.id]);
  });
  it("observaciones y gestión se guardan por MP y semana, sin mezclar semanas ni tocar stock/fórmula/necesidad", async () => {
    const { saveRowNote } = await import("@/lib/mp-control/weekly-availability-service");
    const before = rowOf(await avail(), "Glicerina")!;
    await saveRowNote({ week: WEEK, rowKey: before.key, label: before.materiaPrima, observacion: "Pedir al proveedor B", gestion: "comprar", by: prod.email });
    const after = rowOf(await avail(), "Glicerina")!;
    expect(after.state.observacion).toBe("Pedir al proveedor B");
    expect(after.state.gestion).toBe("comprar");
    expect(after.state.observacionBy).toBe(prod.email);
    expect([after.requerido, after.stockUtilizable, after.estado, after.saldoProyectado]).toEqual([before.requerido, before.stockUtilizable, before.estado, before.saldoProyectado]);
    const { getWeeklyAvailability } = await import("@/lib/mp-control/weekly-availability-service");
    const otra = await getWeeklyAvailability("2031-03-10");
    expect(otra.rows.every((r) => r.state.observacion === "")).toBe(true);
    await saveRowNote({ week: WEEK, rowKey: before.key, label: before.materiaPrima, observacion: "", gestion: "", by: prod.email });
    expect(rowOf(await avail(), "Glicerina")!.state.observacion).toBe("");
  });

  it("quitar una MP del control la oculta de forma persistente, no toca el inventario y, si aparece una necesidad nueva, vuelve marcada", async () => {
    const { excludeRowsByKeys, restoreRows } = await import("@/lib/mp-control/weekly-availability-service");
    const [lotsBefore] = await q("select count(*)::int n, coalesce(sum((payload->>'cantidadKg')::numeric),0)::float kg from inv_mp_stock where payload->>'createdBy' = $1", [NOTE]);
    const g = rowOf(await avail(), "Glicerina")!;
    expect(await excludeRowsByKeys(WEEK, [g.key], prod.email)).toBe(1);
    const res = await avail();
    expect(rowOf(res, "Glicerina")).toBeUndefined();
    expect(res.excludedRows.some((r) => r.key === g.key && r.state.excludedBy === prod.email)).toBe(true);
    // "Recargar": nueva lectura desde la base, sigue oculta.
    expect(rowOf(await avail(), "Glicerina")).toBeUndefined();
    const [lotsAfter] = await q("select count(*)::int n, coalesce(sum((payload->>'cantidadKg')::numeric),0)::float kg from inv_mp_stock where payload->>'createdBy' = $1", [NOTE]);
    expect(lotsAfter).toEqual(lotsBefore);
    const [m] = await q("select count(*)::int n from mp_stock_movements");
    expect(Number(m!.n)).toBe(movsBefore);
    // Una producción nueva con glicerina después de la exclusión: la necesidad NO se oculta en silencio.
    const nueva = await assign(`CREMA B WK ${RUN}`, "50");
    const res2 = await avail();
    const vuelve = rowOf(res2, "Glicerina");
    expect(vuelve?.state.exclusionToReview).toBe(true);
    await q("update work_items set deleted_at = now() where id = $1", [nueva.workId]);
    await restoreRows({ week: WEEK, rowKeys: [g.key] });
    const res3 = await avail();
    expect(rowOf(res3, "Glicerina")?.state.excluded).toBe(false);
  });

  it("eliminar/anular un control saca SOLO las necesidades de ese control, las otras producciones siguen y al restaurar vuelven", async () => {
    const { excludeProductionsForControl, restoreProductionsForControl } = await import("@/lib/mp-control/weekly-availability-service");
    const a = await assign(`CREMA A WK ${RUN}`, "100");
    const b = await assign(`CREMA B WK ${RUN}`, "100");
    const base = rowOf(await avail(), "Glicerina")!;
    const baseReq = base.requerido;
    const ctlId = randomUUID();
    const dropped = await excludeProductionsForControl({ id: ctlId, client: CLIENT, product: `CREMA A WK ${RUN}`, linkedOeId: a.orderId, quantityKg: 100, createdAt: `${WEEK}T10:00:00.000Z` }, prod.email);
    expect(dropped).toContain(a.workId);
    expect(dropped).not.toContain(b.workId);
    const res = await avail();
    expect(res.productions.some((p) => p.id === a.workId)).toBe(false);
    expect(res.productions.some((p) => p.id === b.workId)).toBe(true);
    const g = rowOf(res, "Glicerina")!;
    expect(g.requerido).toBeCloseTo(baseReq - 12, 6); // 12 % de 100 kg de la producción A
    expect(g.needs.every((n) => n.productionId !== a.workId)).toBe(true);
    // "Recargar": sigue sin aparecer.
    expect(rowOf(await avail(), "Glicerina")!.requerido).toBeCloseTo(baseReq - 12, 6);
    await restoreProductionsForControl(ctlId);
    expect(rowOf(await avail(), "Glicerina")!.requerido).toBeCloseTo(baseReq, 6);
    await q("update work_items set deleted_at = now() where id = any($1)", [[a.workId, b.workId]]);
  });

  it("eliminar un borrador desde el servicio de controles quita sus necesidades de la semana", async () => {
    const { getMpControlService } = await import("@/lib/mp-control/mp-control-service");
    const mp = { email: "it-wk-mp@laboratoriogenus.com.ar", sector: "MATERIA_PRIMA" as const };
    const a = await assign(`CREMA A WK ${RUN}`, "200");
    const baseReq = rowOf(await avail(), "Glicerina")!.requerido;
    const c = await getMpControlService().create(mp, {
      client: CLIENT,
      product: `CREMA A WK ${RUN}`,
      quantityKg: 200,
      snapshot: { client: CLIENT, product: `CREMA A WK ${RUN}`, source: "CACHE_NEON", capturedAt: new Date().toISOString(), materials: [{ materiaPrima: GLI, codigo: `F-GLI${RUN}`, formulaPct: 12 }] },
    });
    await q("update mp_weekly_controls set created_at = $2 where id = $1", [c.id, `${WEEK}T10:00:00.000Z`]);
    await getMpControlService().deleteDraft(mp, c.id);
    const res = await avail();
    expect(res.productions.some((p) => p.id === a.workId)).toBe(false);
    expect(rowOf(res, "Glicerina")!.requerido).toBeCloseTo(baseReq - 24, 6);
    const left = await q("select id from mp_weekly_controls where id = $1", [c.id]);
    expect(left).toHaveLength(0);
    await q("delete from mp_weekly_production_exclusions where work_item_id = $1", [a.workId]);
    await q("update work_items set deleted_at = now() where id = $1", [a.workId]);
  });
});
