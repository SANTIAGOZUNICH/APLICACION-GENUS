/**
 * Stock MP — edición completa tipo Excel contra un Postgres de PRUEBA real: corrección de código (lote + ingresos +
 * libro mayor en UNA transacción, alias para OE viejas, historia intacta), «Stock código» por ajuste, kg de un lote de
 * ingreso y concurrencia. Se SALTA sin base local marcada. Se corre con `npm run test:e2e:produccion-edicion-db`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const mp = { email: "it-mp@laboratoriogenus.com.ar", sector: "MATERIA_PRIMA" as const, displayName: "IT Materia Prima" };
const prod = { email: "it-prod@laboratoriogenus.com.ar", sector: "PRODUCCION" as const };

describe.skipIf(Boolean(PROBLEM))(`Stock MP: edición completa en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const db = async () => import("@/lib/inventory/mp-planilla-db");
  const ledger = async () => (await import("@/lib/mp-stock/mp-stock-ledger")).getMpStockLedger();
  const balance = async (c: string) => Number((await q("select stock_actual from mp_stock_balances where codigo = $1", [c]))[0]?.stock_actual ?? 0);
  const lotById = async (id: string) => (await q("select payload from inv_mp_stock where id = $1", [id]))[0]!.payload as Record<string, unknown>;
  const movs = async (c: string) => q("select id, kind, quantity, balance_after, idempotency_key, reversed from mp_stock_movements where codigo = $1 order by created_at, id", [c]);
  const cleanup = async () => {
    await q("delete from inv_mp_ingresos where payload->>'codigo' like 'IT-RC-%' or payload->>'codigoRecibido' like 'IT-RC-%'");
    await q("delete from inv_mp_stock where payload->>'codigo' like 'IT-RC-%'");
    await q("delete from mp_stock_movements where codigo like 'IT-RC-%'");
    await q("delete from mp_stock_balances where codigo like 'IT-RC-%'");
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
    await cleanup();
  }, 60_000);
  afterAll(async () => {
    await cleanup().catch(() => undefined);
    await pool?.end();
  });

  let lotId = "";
  let ingresoId = "";

  it("corregir el CÓDIGO de un lote de ingreso confirmado: lote + ingreso + libro mayor en una transacción, historia intacta", async () => {
    const { runMpInventoryOp, patchMpStockCells } = await db();
    const ing = await runMpInventoryOp(mp, ({ service }) =>
      service.upsertMpIngreso(mp, { fecha: "2026-10-01", remitoNro: "IT-RC-R1", codigo: "IT-RC-OLD", producto: "CREMA RC", descripcion: "Glicerina RC", lote: "L1", cantidad: 40 })
    );
    ingresoId = ing.id;
    lotId = String(ing.stockLotId);
    await (await ledger()).applyOeConsumption(prod, { oeId: "it-rc-oe1", oeVersion: 1, oeStatus: "COMPLETA", lines: [{ lineId: "a", codigo: "IT-RC-OLD", kgReal: 10 }], allowNegative: true });
    expect(await balance("IT-RC-OLD")).toBe(30);
    const historia = await movs("IT-RC-OLD");
    const lot = await lotById(lotId);

    await expect(patchMpStockCells(mp, [{ id: lotId, field: "codigo", value: "IT-RC-NEW", expectedVersion: String(lot.updatedAt) }])).rejects.toThrow(/motivo/);
    await patchMpStockCells(mp, [{ id: lotId, field: "codigo", value: "it-rc-new", expectedVersion: String(lot.updatedAt), reason: "Código de proveedor mal cargado" }]);

    expect(await lotById(lotId)).toMatchObject({ codigo: "IT-RC-NEW", cantidadKg: 40, codigosAnteriores: ["IT-RC-OLD"], productosAsociados: "CREMA RC" });
    const ingAfter = (await q("select payload from inv_mp_ingresos where id = $1", [ingresoId]))[0]!.payload as Record<string, unknown>;
    expect(ingAfter).toMatchObject({ codigo: "IT-RC-NEW", codigoRecibido: "IT-RC-OLD", status: "CONFIRMADO", cantidad: 40 });
    // Saldo traspasado completo; el viejo queda en 0 con alias al nuevo.
    expect(await balance("IT-RC-OLD")).toBe(0);
    expect(await balance("IT-RC-NEW")).toBe(30);
    expect((await q("select payload from mp_stock_balances where codigo = 'IT-RC-OLD'"))[0]!.payload).toMatchObject({ reclasificadoA: "IT-RC-NEW" });
    // Historia: los movimientos anteriores siguen idénticos; solo se agregó el par de reclasificación.
    const despues = await movs("IT-RC-OLD");
    expect(despues.slice(0, historia.length)).toEqual(historia);
    expect(despues.slice(historia.length).map((m) => [m.kind, m.quantity])).toEqual([["RECLASIFICACION", -30]]);
    expect((await movs("IT-RC-NEW")).map((m) => [m.kind, m.quantity])).toEqual([["RECLASIFICACION", 30]]);
    // Auditoría del lote y del ingreso.
    expect(await q("select 1 from inv_audit where payload->>'entityId' = $1 and payload->>'action' = 'reclasificacion_codigo'", [lotId])).toHaveLength(1);
    expect(await q("select 1 from inv_audit where payload->>'entityId' = $1 and payload->>'action' = 'reclasificacion_codigo'", [ingresoId])).toHaveLength(1);
  });

  it("después de corregir el código: el reverso de la OE vieja y un ingreso con el código viejo caen en el código nuevo", async () => {
    const { runMpInventoryOp } = await db();
    await (await ledger()).reverseOeConsumption(prod, "it-rc-oe1");
    expect(await balance("IT-RC-NEW")).toBe(40);
    expect(await balance("IT-RC-OLD")).toBe(0);
    const nuevo = await runMpInventoryOp(mp, ({ service }) =>
      service.upsertMpIngreso(mp, { fecha: "2026-10-02", remitoNro: "IT-RC-R2", codigo: "IT-RC-OLD", descripcion: "Glicerina RC", lote: "L2", cantidad: 5 })
    );
    expect(nuevo).toMatchObject({ codigo: "IT-RC-NEW", codigoRecibido: "IT-RC-OLD", stockLotId: lotId });
    expect((await lotById(lotId)).cantidadKg).toBe(45);
    expect(await balance("IT-RC-NEW")).toBe(45);
    expect(await balance("IT-RC-OLD")).toBe(0);
    expect(await q("select 1 from inv_mp_stock where payload->>'codigo' = 'IT-RC-OLD'")).toHaveLength(0);
  });

  it("«Stock código»: ajuste por la diferencia con motivo; saldo cambiado → 409; dos ediciones simultáneas → una gana", async () => {
    const { patchMpStockCells } = await db();
    const v = String((await lotById(lotId)).updatedAt);
    await patchMpStockCells(mp, [{ id: lotId, field: "stockLibroMayor", value: "50", expectedVersion: v, reason: "Conteo físico RC", expectedValue: "45" }]);
    expect(await balance("IT-RC-NEW")).toBe(50);
    const aj = await q("select kind, quantity, ref_type, reason from mp_stock_movements where codigo = 'IT-RC-NEW' and ref_type = 'mp_saldo_codigo'");
    expect(aj).toEqual([expect.objectContaining({ kind: "AJUSTE", quantity: 5 })]);
    expect((await lotById(lotId)).cantidadKg).toBe(45); // el lote no se toca: «Stock código» es el saldo del código
    // Valor visto viejo → conflicto, nada cambia.
    await expect(patchMpStockCells(mp, [{ id: lotId, field: "stockLibroMayor", value: "1", expectedVersion: v, reason: "Conteo físico RC", expectedValue: "45" }])).rejects.toMatchObject({ status: 409 });
    expect(await balance("IT-RC-NEW")).toBe(50);
    const r = await Promise.allSettled([
      patchMpStockCells(mp, [{ id: lotId, field: "stockLibroMayor", value: "60", expectedVersion: v, reason: "Conteo físico A", expectedValue: "50" }]),
      patchMpStockCells(mp, [{ id: lotId, field: "stockLibroMayor", value: "70", expectedVersion: v, reason: "Conteo físico B", expectedValue: "50" }]),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect([60, 70]).toContain(await balance("IT-RC-NEW"));
    expect(await q("select 1 from mp_stock_movements where codigo = 'IT-RC-NEW' and ref_type = 'mp_saldo_codigo'")).toHaveLength(2);
  });

  it("kg de un lote de ingreso en la celda: ajuste del lote y mismo delta en el libro mayor", async () => {
    const { patchMpStockCells } = await db();
    const before = await balance("IT-RC-NEW");
    const lot = await lotById(lotId);
    await patchMpStockCells(mp, [{ id: lotId, field: "cantidadKg", value: "41", expectedVersion: String(lot.updatedAt), reason: "Merma o rotura RC" }]);
    expect((await lotById(lotId)).cantidadKg).toBe(41);
    expect(await balance("IT-RC-NEW")).toBe(before - 4);
  });

  it("dos correcciones de código simultáneas del mismo lote: una gana, la otra 409, un solo traspaso", async () => {
    const { patchMpStockCells } = await db();
    const v = String((await lotById(lotId)).updatedAt);
    const r = await Promise.allSettled([
      patchMpStockCells(mp, [{ id: lotId, field: "codigo", value: "IT-RC-A", expectedVersion: v, reason: "Corrección simultánea A" }]),
      patchMpStockCells(mp, [{ id: lotId, field: "codigo", value: "IT-RC-B", expectedVersion: v, reason: "Corrección simultánea B" }]),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((r.find((x) => x.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
    const winner = String((await lotById(lotId)).codigo);
    expect(["IT-RC-A", "IT-RC-B"]).toContain(winner);
    const loser = winner === "IT-RC-A" ? "IT-RC-B" : "IT-RC-A";
    expect(await q("select 1 from mp_stock_movements where codigo = $1", [loser])).toHaveLength(0);
    expect(await q("select 1 from mp_stock_movements where codigo = 'IT-RC-NEW' and kind = 'RECLASIFICACION' and quantity < 0")).toHaveLength(1);
  });
});
