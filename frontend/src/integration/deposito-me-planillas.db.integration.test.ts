/**
 * Etapa 2 — Planillas de Depósito ME contra un Postgres de PRUEBA real (mismo SQL que Neon):
 * persistencia tras recargar, recálculo de stock, salidas manuales sin doble descuento, ajustes con concurrencia,
 * negativos visibles y corregibles, duplicados, ediciones simultáneas y permisos.
 * Se SALTA sin base local marcada. Se corre con `npm run test:e2e:produccion-edicion-db`.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const deposito = { email: "it-dep@laboratoriogenus.com.ar", sector: "DEPOSITO" as const, displayName: "IT Depósito" };
const produccion = { email: "it-prod@laboratoriogenus.com.ar", sector: "PRODUCCION" as const, displayName: "IT Producción" };
const envasado = { email: "it-env@laboratoriogenus.com.ar", sector: "ENVASADO_MASIVO" as const, displayName: "IT Envasado" };
const T = "2026-10-01T10:00:00.000Z";

describe.skipIf(Boolean(PROBLEM))(`Depósito ME: planillas editables en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const mod = async () => import("@/lib/inventory/me-planilla-db");
  const ids = { mat: randomUUID(), matDup: randomUUID(), ing1: randomUUID(), ing2: randomUUID(), salOa: randomUUID(), salMan: randomUUID(), salMan2: randomUUID() };
  const COD = "IT-ME-TAPA";
  const payload = async (table: string, id: string) => (await q(`select payload from ${table} where id = $1`, [id]))[0]!.payload as Record<string, unknown>;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
    for (const t of ["inv_me_ingresos", "inv_me_salidas", "inv_me_materials"]) await q(`delete from ${t} where payload->>'codigo' like 'IT-ME-%'`);
    await q("delete from inv_ajustes where payload->>'motivo' like 'IT %'");
    const mat = (id: string) => ({ id, codigo: COD, descripcion: "Tapas IT", cliente: "CLIENTE IT", ubicacion: "A1", unidad: "u", cantidadPorBulto: null, stockActual: 0, stockMinimo: null, puntoReposicion: null, responsable: "", observacion: "", updatedAt: T, archived: false });
    const ingreso = (id: string, nro: string, total: number) => ({ id, fecha: "2026-10-01", ingresoNro: nro, proveedor: "PROV IT", cliente: "CLIENTE IT", remitoNro: `R-${nro}`, codigo: COD, descripcionInsumo: "Tapas IT", bultos: 1, cantidad: total, total, ubicacion: "A1", materialId: ids.mat, anulado: false, createdBy: "it", updatedBy: "it", createdAt: T, updatedAt: T });
    const salida = (id: string, over: Record<string, unknown>) => ({ id, fecha: "2026-10-02", egresoNro: `E-${id.slice(0, 4)}`, cliente: "CLIENTE IT", remitoNro: "", descripcion: "Tapas IT", bultos: null, cantidad: 0, total: 0, control: false, entregado: false, comentarios: "", materialId: ids.mat, codigo: COD, unidad: "u", origen: "MANUAL", oaId: null, oaNumber: null, oaVersion: null, materialLineId: null, idempotencyKey: null, reverted: false, revertedAt: null, revertReason: null, createdBy: "it", updatedBy: "it", createdAt: T, updatedAt: T, ...over });
    await q("insert into inv_me_materials (id, payload) values ($1,$2),($3,$4)", [ids.mat, mat(ids.mat), ids.matDup, { ...mat(ids.matDup), archived: true }]);
    await q("insert into inv_me_ingresos (id, payload) values ($1,$2),($3,$4)", [ids.ing1, ingreso(ids.ing1, "IT-1", 100), ids.ing2, ingreso(ids.ing2, "IT-2", 50)]);
    await q("insert into inv_me_salidas (id, payload) values ($1,$2),($3,$4),($5,$6)", [
      ids.salOa, salida(ids.salOa, { origen: "OA", cantidad: 40, total: 40, oaId: "oa-it", oaNumber: "OA-2026-000999", comentarios: "Salida automática OA" }),
      ids.salMan, salida(ids.salMan, { cantidad: 40, total: 40, comentarios: "Entregado para OA-2026-000999" }), // histórica: no descuenta
      ids.salMan2, salida(ids.salMan2, { cantidad: 5, total: 5, comentarios: "Rotura en estantería" }),
    ]);
  }, 60_000);

  afterAll(async () => {
    for (const t of ["inv_me_ingresos", "inv_me_salidas", "inv_me_materials"]) await q(`delete from ${t} where payload->>'codigo' like 'IT-ME-%'`).catch(() => undefined);
    await q("delete from inv_ajustes where payload->>'motivo' like 'IT %'").catch(() => undefined);
    await pool?.end();
  });

  it("stock calculado: ingresos − salida OA (la entrega manual de la misma OA NO descuenta otra vez)", async () => {
    const { meStockByCodigoDb } = await mod();
    expect(await meStockByCodigoDb(COD)).toBe(100 + 50 - 40);
  });

  it("editar la cantidad de un ingreso: persiste (otra instancia la lee), recalcula TOTAL y stock, y queda auditado", async () => {
    const { patchMeSheetCells } = await mod();
    const before = await payload("inv_me_ingresos", ids.ing1);
    await patchMeSheetCells(deposito, "me_ingresos", [{ id: ids.ing1, field: "cantidad", value: "120", expectedVersion: String(before.updatedAt), reason: "IT recuento" }]);
    vi.resetModules(); // «recargar»
    const after = await payload("inv_me_ingresos", ids.ing1);
    expect(after).toMatchObject({ cantidad: 120, total: 120, updatedBy: deposito.email });
    expect(await (await mod()).meStockByCodigoDb(COD)).toBe(120 + 50 - 40);
    const audit = await q("select payload from inv_audit where payload->>'entityId' = $1 and payload->>'action' = 'cell_edit'", [ids.ing1]);
    expect(audit[0]!.payload).toMatchObject({ actorSector: "DEPOSITO", reason: "IT recuento", before: { cantidad: 100, total: 100 }, after: { cantidad: 120, total: 120 } });
  });

  it("salida manual: «descuenta stock» con motivo propio resta; si menciona una OA se rechaza (no descuenta dos veces)", async () => {
    const { patchMeSheetCells, meStockByCodigoDb, MeSheetPatchError } = await mod();
    const s2 = await payload("inv_me_salidas", ids.salMan2);
    await patchMeSheetCells(deposito, "me_salidas", [{ id: ids.salMan2, field: "motivoSalida", value: "DESCARTE", expectedVersion: String(s2.updatedAt) }]);
    expect(await payload("inv_me_salidas", ids.salMan2)).toMatchObject({ motivoSalida: "DESCARTE", descuentaStock: true });
    expect(await meStockByCodigoDb(COD)).toBe(120 + 50 - 40 - 5);
    const s1 = await payload("inv_me_salidas", ids.salMan);
    const err = await patchMeSheetCells(deposito, "me_salidas", [{ id: ids.salMan, field: "descuentaStock", value: "Sí", expectedVersion: String(s1.updatedAt) }]).catch((e) => e);
    expect(err).toBeInstanceOf(MeSheetPatchError);
    expect(err.message).toMatch(/dos veces/);
    expect(await meStockByCodigoDb(COD)).toBe(125);
    // la salida automática de la OA no se edita desde la planilla
    const so = await payload("inv_me_salidas", ids.salOa);
    const errOa = await patchMeSheetCells(deposito, "me_salidas", [{ id: ids.salOa, field: "cantidad", value: "1", expectedVersion: String(so.updatedAt) }]).catch((e) => e);
    expect(errOa.status).toBe(403);
  });

  it("dos ediciones simultáneas de la misma celda: una gana, la otra CONFLICTO (nada se pisa)", async () => {
    const { patchMeSheetCells } = await mod();
    const v = String((await payload("inv_me_ingresos", ids.ing2)).updatedAt);
    const res = await Promise.allSettled([
      patchMeSheetCells(deposito, "me_ingresos", [{ id: ids.ing2, field: "cantidad", value: "60", expectedVersion: v }]),
      patchMeSheetCells(deposito, "me_ingresos", [{ id: ids.ing2, field: "cantidad", value: "70", expectedVersion: v }]),
    ]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = res.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason.status).toBe(409);
    expect([60, 70]).toContain((await payload("inv_me_ingresos", ids.ing2)).total);
  });

  it("duplicados: un ingreso no puede quedar igual a otro (mismo remito, código, cantidad y fecha)", async () => {
    const { patchMeSheetCells } = await mod();
    const i1 = await payload("inv_me_ingresos", ids.ing1);
    const i2 = await payload("inv_me_ingresos", ids.ing2);
    const v = String(i2.updatedAt);
    const err = await patchMeSheetCells(deposito, "me_ingresos", [
      { id: ids.ing2, field: "remitoNro", value: String(i1.remitoNro), expectedVersion: v },
      { id: ids.ing2, field: "cantidad", value: String(i1.cantidad), expectedVersion: v },
    ]).catch((e) => e);
    expect(err.results.some((r: { code?: string }) => r.code === "DUPLICATE")).toBe(true);
    expect((await payload("inv_me_ingresos", ids.ing2)).remitoNro).toBe(i2.remitoNro); // nada se escribió
  });

  it("stock negativo por error de registro: se ve negativo, NO se lleva a 0 solo; se corrige con ajuste (motivo) o corrigiendo el movimiento", async () => {
    const { patchMeSheetCells, adjustMeStockDb, meStockByCodigoDb, meMovementsDb } = await mod();
    // caso real: la OA consumió 300 antes de que se cargue bien el ingreso (se tipeó 1 en vez de 120)
    const oaLate = randomUUID();
    await q("insert into inv_me_salidas (id, payload) values ($1, $2)", [oaLate, { id: oaLate, fecha: "2026-10-03", egresoNro: "E-LATE", cliente: "", remitoNro: "", descripcion: "Tapas IT", bultos: null, cantidad: 300, total: 300, control: false, entregado: true, comentarios: "Salida automática OA", materialId: ids.mat, codigo: COD, unidad: "u", origen: "OA", oaId: "oa-late", oaNumber: "OA-2026-001000", oaVersion: 1, materialLineId: "l", idempotencyKey: "oa-late:1:l", reverted: false, revertedAt: null, revertReason: null, createdBy: "it", updatedBy: "it", createdAt: T, updatedAt: T }]);
    const i1 = await payload("inv_me_ingresos", ids.ing1);
    await patchMeSheetCells(deposito, "me_ingresos", [{ id: ids.ing1, field: "cantidad", value: "1", expectedVersion: String(i1.updatedAt) }]);
    const neg = await meStockByCodigoDb(COD);
    expect(neg).toBeLessThan(0);
    const { movimientos, stockActual } = await meMovementsDb(produccion, ids.mat);
    expect(stockActual).toBe(neg); // se muestra negativo, no se oculta ni se lleva a 0
    expect(movimientos.at(-1)!.saldo).toBe(neg);
    // corrección del movimiento de origen (el ingreso real era de 420) → el saldo vuelve solo, sin forzar nada
    const i1b = await payload("inv_me_ingresos", ids.ing1);
    await patchMeSheetCells(deposito, "me_ingresos", [{ id: ids.ing1, field: "cantidad", value: "420", expectedVersion: String(i1b.updatedAt), reason: "IT corrección de registro" }]);
    expect(await meStockByCodigoDb(COD)).toBe(neg + 419);
    expect(await meStockByCodigoDb(COD)).toBeGreaterThan(0);
    void adjustMeStockDb;
  });

  it("ajuste de inventario: stock esperado (409 si cambió), motivo obligatorio, historial; dos ajustes simultáneos → uno gana", async () => {
    const { adjustMeStockDb, meStockByCodigoDb, meMovementsDb } = await mod();
    const current = await meStockByCodigoDb(COD);
    await expect(adjustMeStockDb(produccion, { materialId: ids.mat, expectedStock: current, newStock: 10, motivo: "corto", tipo: "CONTEO_FISICO" })).rejects.toThrow(/motivo/);
    await expect(adjustMeStockDb(produccion, { materialId: ids.mat, expectedStock: current + 1, newStock: 10, motivo: "IT conteo físico", tipo: "CONTEO_FISICO" })).rejects.toMatchObject({ status: 409 });
    const res = await Promise.allSettled([
      adjustMeStockDb(produccion, { materialId: ids.mat, expectedStock: current, newStock: current - 3, motivo: "IT conteo físico A", tipo: "CONTEO_FISICO" }),
      adjustMeStockDb(deposito, { materialId: ids.mat, expectedStock: current, newStock: current - 7, motivo: "IT conteo físico B", tipo: "CONTEO_FISICO" }),
    ]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const after = await meStockByCodigoDb(COD);
    expect([current - 3, current - 7]).toContain(after);
    const movs = (await meMovementsDb(deposito, ids.mat)).movimientos.filter((m) => m.tipo === "AJUSTE");
    expect(movs).toHaveLength(1);
    expect(movs[0]!.detalle).toMatch(/IT conteo físico/);
    // un ajuste sobre un material DUPLICADO (mismo código) también cuenta en el stock del código
    await q("insert into inv_ajustes (id, payload) values ($1, $2)", [randomUUID(), { id: randomUUID(), module: "ME", entityId: ids.matDup, cantidadAnterior: 0, cantidadNueva: 0, diferencia: 2, motivo: "IT ajuste duplicado", actor: "it", actorSector: "DEPOSITO", createdAt: new Date().toISOString() }]);
    expect(await meStockByCodigoDb(COD)).toBe(after + 2);
  });

  it("permisos: Producción no edita ingresos; Envasado no ajusta ni edita; Producción sí edita umbrales del inventario", async () => {
    const { patchMeSheetCells, adjustMeStockDb } = await mod();
    const i2 = await payload("inv_me_ingresos", ids.ing2);
    await expect(patchMeSheetCells(produccion, "me_ingresos", [{ id: ids.ing2, field: "cantidad", value: "1", expectedVersion: String(i2.updatedAt) }])).rejects.toMatchObject({ status: 403 });
    await expect(adjustMeStockDb(envasado, { materialId: ids.mat, expectedStock: 0, newStock: 1, motivo: "IT intento envasado", tipo: "OTRO" })).rejects.toMatchObject({ status: 403 });
    const m = await payload("inv_me_materials", ids.mat);
    await patchMeSheetCells(produccion, "me_inventario", [{ id: ids.mat, field: "stockMinimo", value: "30", expectedVersion: String(m.updatedAt) }]);
    expect((await payload("inv_me_materials", ids.mat)).stockMinimo).toBe(30);
  });

  it("cambiar el código de un ingreso mueve su stock al código nuevo (crea el material si no existía)", async () => {
    const { patchMeSheetCells, meStockByCodigoDb } = await mod();
    const before = await meStockByCodigoDb(COD);
    const i2 = await payload("inv_me_ingresos", ids.ing2);
    await patchMeSheetCells(deposito, "me_ingresos", [{ id: ids.ing2, field: "codigo", value: "it-me-tapa-b", expectedVersion: String(i2.updatedAt) }]);
    const moved = Number((await payload("inv_me_ingresos", ids.ing2)).total);
    expect(await meStockByCodigoDb(COD)).toBe(before - moved);
    expect(await meStockByCodigoDb("IT-ME-TAPA-B")).toBe(moved);
    expect((await q("select count(*)::int n from inv_me_materials where payload->>'codigo' = 'IT-ME-TAPA-B'"))[0]!.n).toBe(1);
  });
});
