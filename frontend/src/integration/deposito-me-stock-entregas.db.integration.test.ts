/**
 * Depósito ME: INGRESOS (historial) vs STOCK (saldo) + Entregas Producción que descuentan stock, contra un Postgres de PRUEBA real.
 * Datos ficticios «IT-ST-*». Se SALTA sin base local marcada.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const dep = { email: "it-dep@laboratoriogenus.com.ar", sector: "DEPOSITO" as const, displayName: "IT Depósito" };
const prod = { email: "it-prod@laboratoriogenus.com.ar", sector: "PRODUCCION" as const, displayName: "IT Producción" };
const dir = { email: "it-dir@laboratoriogenus.com.ar", sector: "DIRECCION" as const, displayName: "IT Dirección" };
const COD = "IT-ST-CAJA";
const COD_OTRO = "IT-ST-CAJA-OTRO";
const COD_A = "IT-ST-AMB-A";
const COD_B = "IT-ST-AMB-B";
const CLI = "CLIENTE IT-ST";
const PROD = "Caja IT ST";

describe.skipIf(Boolean(PROBLEM))(`Depósito ME: ingresos, stock y entregas a Producción${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const clean = async () => {
    for (const t of ["inv_me_ingresos", "inv_me_salidas", "inv_me_materials"]) await q(`delete from ${t} where payload->>'codigo' like 'IT-ST-%'`);
    await q("delete from deposito_despachos where cliente like '%IT-ST%' or cliente like '%IT-AMB%'");
  };
  const request = async <T,>(fn: (s: import("@/lib/inventory/inventory-service").InventoryService) => T): Promise<T> => {
    const { memoryInventoryRepo } = await import("@/lib/inventory/memory-repo");
    const { hydrateInventoryFromNeon, persistInventorySnapshot } = await import("@/lib/inventory/neon-persist");
    const { getInventoryService } = await import("@/lib/inventory/get-inventory-service");
    await hydrateInventoryFromNeon(memoryInventoryRepo, { force: true });
    const out = fn(getInventoryService());
    await persistInventorySnapshot(memoryInventoryRepo);
    return out;
  };
  const stock = async (cod: string) => (await import("@/lib/inventory/me-planilla-db")).meStockByCodigoDb(cod);
  const historial = () => request((s) => s.listMeIngresosHistorial(dep).filter((r) => r.codigo.startsWith("IT-ST-")));
  const svc = async () => (await import("@/lib/despachos/despachos-service")).getDespachosService();
  const ing = (over: Record<string, unknown> = {}) => ({ codigo: COD, descripcionInsumo: PROD, cliente: CLI, proveedor: "PROV IT", unidad: "u", bultos: 1, cantidad: 5000, fecha: "2026-11-02", ...over });
  const salidasDe = (despachoId: string) => q("select payload from inv_me_salidas where payload->>'despachoId' = $1", [despachoId]);
  const mpCount = async () => (await q("select (select count(*) from inv_mp_stock)::int a, (select count(*) from inv_mp_ingresos)::int b"))[0];
  let mp0: Record<string, unknown> | undefined;
  let d1 = "";
  let d1Version = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
    await clean();
    mp0 = await mpCount();
  }, 60_000);
  afterAll(async () => {
    await clean().catch(() => undefined);
    await pool?.end();
  });

  it("1) un ingreso de 5.000 aumenta el stock a 5.000 y queda en Ingresos", async () => {
    await request((s) => s.upsertMeIngreso(dep, ing({ id: "a1111111-1111-4111-8111-111111111111" })));
    await request((s) => s.upsertMeIngreso(dep, ing({ codigo: COD_OTRO, cliente: "OTRO CLIENTE IT-ST", id: "a2222222-2222-4222-8222-222222222222", cantidad: 700 })));
    expect(await stock(COD)).toBe(5000);
    expect((await historial()).find((r) => r.codigo === COD)).toMatchObject({ total: 5000, anulado: false });
  });

  it("2) una Entrega a Producción de 1.200 descuenta stock (3.800); Ingresos sigue en 5.000; otro cliente no se mezcla", async () => {
    const r = await (await svc()).create(dep, { fecha: "2026-11-03", egreso: "B001", remito: "0001-77", cliente: CLI, producto: PROD, bultos: 12, cantidad: 100, idempotencyKey: "it-st-d1" });
    d1 = r.record.id;
    d1Version = r.record.updatedAt;
    expect(r.record.meStock).toMatchObject({ status: "VINCULADO", codigo: COD });
    expect(await stock(COD)).toBe(3800);
    expect(await stock(COD_OTRO)).toBe(700);
    expect((await historial()).find((x) => x.codigo === COD)).toMatchObject({ total: 5000 });
    const sal = await salidasDe(d1);
    expect(sal).toHaveLength(1);
    expect(sal[0]!.payload).toMatchObject({ total: 1200, codigo: COD, despachoId: d1, motivoSalida: "ENTREGA_PRODUCCION", descuentaStock: true, origen: "MANUAL", idempotencyKey: `despacho:${d1}` });
  });

  it("3) persiste tras recargar y reintentar/sincronizar NO duplica movimientos (idempotente)", async () => {
    vi.resetModules();
    expect(await stock(COD)).toBe(3800);
    const again = await (await svc()).create(dep, { fecha: "2026-11-03", egreso: "B001", remito: "0001-77", cliente: CLI, producto: PROD, bultos: 12, cantidad: 100, idempotencyKey: "it-st-d1" });
    expect(again.created).toBe(false);
    const { syncDespachoStock } = await import("@/lib/despachos/despacho-me-stock");
    await syncDespachoStock(dep, d1);
    await syncDespachoStock(dep, d1);
    expect(await salidasDe(d1)).toHaveLength(1);
    expect(await stock(COD)).toBe(3800);
  });

  it("4) una segunda entrega de 800 deja 3.000 y los Ingresos no cambian", async () => {
    const r = await (await svc()).create(dep, { fecha: "2026-11-04", egreso: "B002", cliente: CLI, producto: PROD, bultos: 8, cantidad: 100, idempotencyKey: "it-st-d2" });
    expect(r.record.meStock?.status).toBe("VINCULADO");
    expect(await stock(COD)).toBe(3000);
    expect((await historial()).filter((x) => x.codigo === COD).map((x) => x.total)).toEqual([5000]);
  });

  it("5) editar la cantidad de la entrega corrige LA MISMA salida (auditado), sin duplicar", async () => {
    const out = await (await svc()).patchCells(dep, [{ id: d1, field: "cantidad", value: 50, expectedVersion: d1Version }]);
    expect(out[0]!.ok).toBe(true);
    expect(await stock(COD)).toBe(5000 - 600 - 800);
    const sal = await salidasDe(d1);
    expect(sal).toHaveLength(1);
    expect(sal[0]!.payload).toMatchObject({ total: 600 });
    const aud = await q("select payload from inv_audit where payload->>'entityId' = $1", [String((sal[0]!.payload as { id: string }).id)]);
    expect(aud.length).toBeGreaterThanOrEqual(2);
  });

  it("6) la salida vinculada no se edita ni se anula desde Salidas ME (se corrige en la entrega)", async () => {
    const sal = (await salidasDe(d1))[0]!.payload as { id: string; updatedAt: string };
    const { patchMeSheetCells } = await import("@/lib/inventory/me-planilla-db");
    const err = await patchMeSheetCells(dep, "me_salidas", [{ id: sal.id, field: "cantidad", value: "1", expectedVersion: sal.updatedAt }]).catch((e) => e);
    expect(err.status ?? err.results?.[0]?.code).toBeTruthy();
    expect(await stock(COD)).toBe(3600);
    await request((s) => expect(() => s.anularMeSalida(dep, sal.id, "x")).toThrow(/Entregas Producción/));
  });

  it("7) eliminar la entrega ANULA la salida (se conserva con historial) y el stock vuelve; Ingresos intacto", async () => {
    const ok = await (await svc()).delete(dep, d1);
    expect(ok).toBe(true);
    const sal = await salidasDe(d1);
    expect(sal).toHaveLength(1);
    expect(sal[0]!.payload).toMatchObject({ reverted: true });
    expect(await stock(COD)).toBe(5000 - 800);
    expect((await historial()).find((x) => x.codigo === COD)).toMatchObject({ total: 5000 });
  });

  it("8) entrega sin material identificable: NO descuenta; se elige el material y entonces descuenta", async () => {
    const before = await stock(COD);
    const r = await (await svc()).create(dep, { fecha: "2026-11-05", egreso: "B003", cliente: CLI, producto: "Producto que no existe IT-ST", bultos: 1, cantidad: 300, idempotencyKey: "it-st-d3" });
    expect(r.record.meStock?.status).toBe("SIN_MATERIAL");
    expect(await stock(COD)).toBe(before);
    const { assignDespachoMaterial } = await import("@/lib/despachos/despacho-me-stock");
    await expect(assignDespachoMaterial(prod, r.record.id, COD)).rejects.toThrow();
    await expect(assignDespachoMaterial(dep, r.record.id, "IT-ST-NO-EXISTE")).rejects.toThrow(/no existe/);
    await assignDespachoMaterial(dep, r.record.id, COD);
    await assignDespachoMaterial(dep, r.record.id, COD); // reintento: sin duplicar
    expect(await salidasDe(r.record.id)).toHaveLength(1);
    expect(await stock(COD)).toBe(before - 300);
  });

  it("9) dos materiales del mismo cliente con la misma descripción: ambiguo → no se adivina, queda sin material", async () => {
    await request((s) => s.upsertMeIngreso(dep, ing({ codigo: COD_A, descripcionInsumo: "Ambiguo IT-ST", cliente: "CLIENTE IT-AMB", cantidad: 100, id: "a3333333-3333-4333-8333-333333333333" })));
    await request((s) => s.upsertMeIngreso(dep, ing({ codigo: COD_B, descripcionInsumo: "Ambiguo IT-ST", cliente: "CLIENTE IT-AMB", cantidad: 100, id: "a4444444-4444-4444-8444-444444444444" })));
    const r = await (await svc()).create(dep, { fecha: "2026-11-06", egreso: "B004", cliente: "CLIENTE IT-AMB", producto: "Ambiguo IT-ST", bultos: 1, cantidad: 10, idempotencyKey: "it-st-d4" });
    expect(r.record.meStock?.status).toBe("SIN_MATERIAL");
    expect(await stock(COD_A)).toBe(100);
    expect(await stock(COD_B)).toBe(100);
  });

  it("10) entregas anteriores (HISTORICO) no tocan el stock hasta aplicarlas; el informe las muestra y aplicar es idempotente", async () => {
    const hid = "b5555555-5555-4555-8555-555555555555";
    await q("insert into deposito_despachos (id, fecha, egreso, remito, cliente, producto, bultos, cantidad, cantidad_total, created_by, created_by_sector) values ($1,'2026-09-01','B000','','CLIENTE IT-ST','Caja IT ST',1,40,40,'hist','DEPOSITO')", [hid]);
    const before = await stock(COD);
    const { syncDespachoStock, despachoStockReport, applyHistoricoDespachos } = await import("@/lib/despachos/despacho-me-stock");
    await syncDespachoStock(dep, hid); // un sync normal NO la aplica
    expect(await stock(COD)).toBe(before);
    const rep = await despachoStockReport(prod); // Producción consulta
    expect(rep.rows.find((r) => r.id === hid)).toMatchObject({ status: "HISTORICO", accion: "DESCONTAR", codigo: COD });
    await expect(applyHistoricoDespachos(prod, [hid])).rejects.toThrow();
    const a1 = await applyHistoricoDespachos(dep, [hid]);
    expect(a1.aplicadas).toEqual([hid]);
    expect(await stock(COD)).toBe(before - 40);
    const a2 = await applyHistoricoDespachos(dep, [hid]);
    expect(a2.aplicadas).toEqual([]);
    expect(await salidasDe(hid)).toHaveLength(1);
    expect(await stock(COD)).toBe(before - 40);
    await expect(despachoStockReport({ email: "x", sector: "CODIFICADO" as never, displayName: "x" })).rejects.toThrow();
    expect((await despachoStockReport(dir)).resumen.vinculadas).toBeGreaterThan(0);
  });

  it("11) una salida manual descuenta por defecto; un REGISTRO sin descuento no; los Ingresos no cambian", async () => {
    const before = await stock(COD_OTRO);
    await request((s) => s.upsertMeSalida(dep, { codigo: COD_OTRO, cantidad: 100, cliente: "OTRO CLIENTE IT-ST", fecha: "2026-11-07" }));
    expect(await stock(COD_OTRO)).toBe(before - 100);
    await request((s) => s.upsertMeSalida(dep, { codigo: COD_OTRO, cantidad: 50, motivoSalida: "REGISTRO", fecha: "2026-11-07" }));
    expect(await stock(COD_OTRO)).toBe(before - 100);
    expect((await historial()).find((x) => x.codigo === COD_OTRO)).toMatchObject({ total: 700 });
  });

  it("12) OA + entrega manual de la misma OA: se descuenta max(entregado, usado) una sola vez; la OA descuenta solo la diferencia", async () => {
    const mat = await request((s) => s.listMeMaterials(dep).find((m) => m.codigo === COD_B)!);
    const base = await stock(COD_B);
    await request((s) => s.upsertMeSalida(dep, { codigo: COD_B, cantidad: 30, motivoSalida: "ENTREGA_OA", comentarios: "OA-2026-000777", fecha: "2026-11-08" }));
    expect(await stock(COD_B)).toBe(base - 30);
    await request((s) => s.createOaMeSalida(prod, { codigo: COD_B, descripcion: "Ambiguo IT-ST", cliente: "", unidad: "u", cantidad: 30, materialId: mat.id, oaId: "oa-it-st", oaNumber: "OA-2026-000777", oaVersion: 1, materialLineId: "l1", idempotencyKey: "oa-it-st:1:l1" }));
    expect(await stock(COD_B)).toBe(base - 30); // no dos veces
    await request((s) => s.createOaMeSalida(prod, { codigo: COD_B, descripcion: "Ambiguo IT-ST", cliente: "", unidad: "u", cantidad: 20, materialId: mat.id, oaId: "oa-it-st", oaNumber: "OA-2026-000777", oaVersion: 1, materialLineId: "l2", idempotencyKey: "oa-it-st:1:l2" }));
    expect(await stock(COD_B)).toBe(base - 50); // diferencia: 50 usados − 30 ya entregados
  });

  it("13) corregir un ingreso (anular) queda auditado, conserva la fila y ajusta el stock; MP no se toca; Producción solo consulta", async () => {
    const before = await stock(COD_OTRO);
    await request((s) => s.anularMeIngreso(dep, "a2222222-2222-4222-8222-222222222222", "carga errónea"));
    expect(await stock(COD_OTRO)).toBe(before - 700);
    expect((await historial()).find((x) => x.codigo === COD_OTRO)).toMatchObject({ anulado: true, total: 700, anuladoReason: "carga errónea" });
    const aud = await q("select 1 from inv_audit where payload->>'entityId' = 'a2222222-2222-4222-8222-222222222222' and payload->>'action' = 'anular'");
    expect(aud.length).toBe(1);
    await request((s) => expect(() => s.upsertMeSalida(prod, { codigo: COD, cantidad: 1 })).toThrow());
    await expect((await svc()).create(prod, { cliente: CLI, producto: PROD, bultos: 1, cantidad: 1 })).rejects.toThrow();
    expect(await mpCount()).toEqual(mp0);
  });

  it("14) el listado de entregas expone el vínculo con el stock (planilla de 11 columnas intacta)", async () => {
    const list = await (await svc()).list(prod);
    const vinculada = list.find((r) => r.meStock?.status === "VINCULADO");
    expect(vinculada?.meStock?.codigo).toBeTruthy();
  });
});
