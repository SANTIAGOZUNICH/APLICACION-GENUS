/**
 * Consumo de MP de una OE contra un Postgres de PRUEBA real (mismo SQL que Neon), por el mismo camino que usa la entrega/guardar avance
 * (`runOeStockOp` → transacción con candado de MP + libro mayor + lotes de Stock MP):
 *  - el consumo real se descuenta SIEMPRE: con stock suficiente, en cero justo, insuficiente (queda negativo) y ya negativo
 *  - varios lotes (FEFO) sin trasladar el faltante; lote explícito
 *  - idempotencia: guardar dos veces / reintentar no duplica; corregir registra solo la diferencia; anular revierte
 *  - ingreso posterior de stock no re-descuenta; dos consumos simultáneos de la misma MP suman bien
 *  - persistencia en mp_stock_movements (OE, código, lote, usuario, saldo) y coincidencia saldo = suma de movimientos
 * Se SALTA sin base local marcada. Se corre con `GENUS_E2E_VITEST_FILES=src/integration/oe-consumo-mp.db.integration.test.ts bash scripts/e2e/run-semanas-priorities-db-local.sh`.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const elab = { email: "it-elab@laboratoriogenus.com.ar", sector: "ELABORACION" as const, displayName: "IT Elaboración" };
const mpUser = { email: "it-mp@laboratoriogenus.com.ar", sector: "MATERIA_PRIMA" as const, displayName: "IT MP" };
const T = "2026-10-01T10:00:00.000Z";

describe.skipIf(Boolean(PROBLEM))(`OE: descuento de MP siempre, también en negativo (Postgres real)${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const balance = async (codigo: string) => Number((await q("select stock_actual from mp_stock_balances where codigo = $1", [codigo]))[0]?.stock_actual ?? 0);
  const lotKg = async (codigo: string, lote: string) => {
    const r = await q("select payload from inv_mp_stock where payload->>'codigo' = $1 and payload->>'lote' = $2", [codigo, lote]);
    return r[0] ? Number((r[0].payload as { cantidadKg: number }).cantidadKg) : null;
  };
  const movements = async (oeId: string) => q("select codigo, kind, quantity, balance_after, lote, actor_email, ref_type, ref_id from mp_stock_movements where ref_type = 'oe' and ref_id = $1 order by created_at", [oeId]);
  const cleanup = async () => {
    await q("delete from inv_mp_stock where payload->>'codigo' like 'IT-OE-%'");
    await q("delete from mp_stock_movements where codigo like 'IT-OE-%'");
    await q("delete from mp_stock_balances where codigo like 'IT-OE-%'");
  };
  async function seed(codigo: string, lots: Array<{ lote: string; kg: number; vencimiento?: string }>) {
    for (const l of lots) {
      const id = randomUUID();
      await q("insert into inv_mp_stock (id, payload, updated_at) values ($1,$2, now())", [id, { id, codigo, descripcion: `MP ${codigo}`, proveedor: "P IT", cliente: "", cantidadKg: l.kg, ubicacion: "A", lote: l.lote, vencimiento: l.vencimiento ?? "", origen: "ingreso", productosAsociados: "", archived: false, createdBy: "it", updatedBy: "it", createdAt: T, updatedAt: T }]);
    }
    const { getMpStockLedger } = await import("@/lib/mp-stock/mp-stock-ledger");
    await getMpStockLedger().seedSaldoInicialOnce({ email: mpUser.email, sector: mpUser.sector }, codigo, lots.reduce((n, l) => n + l.kg, 0), `MP ${codigo}`);
  }
  type Mat = { id: string; materiaPrima: string; codigoMp: string; lote: string; kgReal: number | null };
  const mat = (id: string, codigoMp: string, kgReal: number | null, lote = ""): Mat => ({ id, materiaPrima: `MP ${codigoMp}`, codigoMp, lote, kgReal });
  const full = (m: Mat) => ({ codigo: "", formulaPct: 10, kgAPesar: m.kgReal, ajuste: null, ajusteMotivo: "", ajusteAt: null, ajusteBy: null, parentRowId: null, ...m });
  const progress = async (oeId: string, version: number, mats: Mat[]) => {
    const { runOeStockOp, registerOeProgressConsumption } = await import("@/lib/orders/oe-stock-op");
    return runOeStockOp(elab, (ctx) => registerOeProgressConsumption(ctx, elab, { oeId, orderNumber: `OE-IT-${oeId.slice(0, 4)}`, orderVersion: version, orderStatus: "EN_ELABORACION", materials: mats.map(full) as never }));
  };
  const deliver = async (oeId: string, version: number, mats: Mat[]) => {
    const { runOeStockOp, consumeOeStock } = await import("@/lib/orders/oe-stock-op");
    return runOeStockOp(elab, (ctx) =>
      consumeOeStock(ctx, elab, { oeId, orderNumber: `OE-IT-${oeId.slice(0, 4)}`, materials: mats.map(full) as never, soft: true, commitOrder: async () => ({ version, status: "COMPLETA" }) })
    );
  };
  const reverse = async (oeId: string, version: number) => {
    const { runOeStockOp, reverseOeStock } = await import("@/lib/orders/oe-stock-op");
    return runOeStockOp(elab, (ctx) => reverseOeStock(ctx, elab, { oeId, orderNumber: `OE-IT-${oeId.slice(0, 4)}`, reason: "IT", commitOrder: async () => ({ version }) }));
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

  it("stock suficiente: descuenta, guarda el movimiento con OE/lote/usuario/saldo y el lote baja igual", async () => {
    await seed("IT-OE-OK", [{ lote: "L1", kg: 20 }]);
    const oe = randomUUID();
    const r = await progress(oe, 1, [mat("m1", "IT-OE-OK", 5, "L1")]);
    expect(r.applied).toEqual([{ codigo: "IT-OE-OK", lote: "L1", delta: -5 }]);
    expect(r.shortages).toEqual([]);
    expect(await balance("IT-OE-OK")).toBe(15);
    expect(await lotKg("IT-OE-OK", "L1")).toBe(15);
    const [m] = await movements(oe);
    expect(m).toMatchObject({ codigo: "IT-OE-OK", kind: "CONSUMO_OE", quantity: -5, balance_after: 15, lote: "L1", actor_email: elab.email, ref_type: "oe", ref_id: oe });
  });

  it("stock insuficiente (5 kg, consumo 8): se descuenta IGUAL y queda -3 en el código y en el lote, con advertencia", async () => {
    await seed("IT-OE-SHORT", [{ lote: "S1", kg: 5 }]);
    const oe = randomUUID();
    const r = await progress(oe, 1, [mat("m1", "IT-OE-SHORT", 8, "S1")]);
    expect(r.applied).toEqual([{ codigo: "IT-OE-SHORT", lote: "S1", delta: -8 }]);
    expect(r.shortages.length).toBeGreaterThan(0);
    expect(await balance("IT-OE-SHORT")).toBe(-3);
    expect(await lotKg("IT-OE-SHORT", "S1")).toBe(-3);
    const { getMpStockLedger } = await import("@/lib/mp-stock/mp-stock-ledger");
    expect((await getMpStockLedger().oeConsumptionReport(oe))[0]).toMatchObject({ consumido: 8, stockAntes: 5, stockDespues: -3, negativo: true });
  });

  it("stock exactamente en cero y stock ya negativo: ambos casos descuentan y el saldo coincide con la suma de movimientos", async () => {
    await seed("IT-OE-ZERO", [{ lote: "Z1", kg: 4 }]);
    const a = randomUUID();
    const r1 = await progress(a, 1, [mat("m1", "IT-OE-ZERO", 4, "Z1")]);
    expect(r1.shortages).toEqual([]);
    expect(await balance("IT-OE-ZERO")).toBe(0);
    const b = randomUUID();
    await progress(b, 1, [mat("m1", "IT-OE-ZERO", 2, "Z1")]); // saldo 0 → -2
    const c = randomUUID();
    await progress(c, 1, [mat("m1", "IT-OE-ZERO", 1, "Z1")]); // ya negativo → -3
    expect(await balance("IT-OE-ZERO")).toBe(-3);
    const sum = await q("select coalesce(sum(quantity),0)::float as n from mp_stock_movements where codigo = 'IT-OE-ZERO'");
    expect(Number(sum[0]!.n)).toBe(-3 + 0); // 4 (saldo inicial) − 4 − 2 − 1 = −3
  });

  it("varios lotes sin indicar lote: FEFO; si no alcanza, el faltante queda en el lote apto (no salta a otra MP ni otro lote)", async () => {
    await seed("IT-OE-MULTI", [{ lote: "A", kg: 2, vencimiento: "2027-01-01" }, { lote: "B", kg: 8, vencimiento: "2027-06-01" }]);
    const oe = randomUUID();
    const r = await progress(oe, 1, [mat("m1", "IT-OE-MULTI", 12, "")]);
    expect(r.applied.reduce((n, x) => n + x.delta, 0)).toBe(-12);
    expect(await balance("IT-OE-MULTI")).toBe(-2);
    expect((await lotKg("IT-OE-MULTI", "A"))! + (await lotKg("IT-OE-MULTI", "B"))!).toBe(-2);
  });

  it("idempotencia: guardar dos veces / reintentar la entrega no duplica; corregir registra solo la diferencia; anular revierte", async () => {
    await seed("IT-OE-IDEM", [{ lote: "I1", kg: 10 }]);
    const oe = randomUUID();
    await progress(oe, 1, [mat("m1", "IT-OE-IDEM", 6, "I1")]);
    const again = await progress(oe, 2, [mat("m1", "IT-OE-IDEM", 6, "I1")]); // «actualizar la página»/guardar igual
    expect(again.applied).toEqual([]);
    expect(await balance("IT-OE-IDEM")).toBe(4);
    const fix = await progress(oe, 3, [mat("m1", "IT-OE-IDEM", 9, "I1")]); // se corrige 6 → 9
    expect(fix.applied).toEqual([{ codigo: "IT-OE-IDEM", lote: "I1", delta: -3 }]);
    expect(await balance("IT-OE-IDEM")).toBe(1);
    const d1 = await deliver(oe, 4, [mat("m1", "IT-OE-IDEM", 9, "I1")]); // entregar reconoce lo ya descontado
    expect(d1.result?.applied).toEqual([]);
    const d2 = await deliver(oe, 4, [mat("m1", "IT-OE-IDEM", 9, "I1")]); // reintento de la misma entrega
    expect(d2.result?.applied).toEqual([]);
    expect(await balance("IT-OE-IDEM")).toBe(1);
    expect((await movements(oe)).filter((m) => m.kind === "CONSUMO_OE")).toHaveLength(2); // 6 y la diferencia de 3
    const rev = await reverse(oe, 5); // anular consumo
    expect(rev.applied.reduce((n, x) => n + x.delta, 0)).toBe(9);
    expect(await balance("IT-OE-IDEM")).toBe(10);
    expect(await lotKg("IT-OE-IDEM", "I1")).toBe(10);
    await reverse(oe, 5);
    expect(await balance("IT-OE-IDEM")).toBe(10);
  });

  it("ingreso posterior de stock: el saldo se actualiza por movimientos y el consumo de la OE no se descuenta de nuevo", async () => {
    await seed("IT-OE-LATE", [{ lote: "T1", kg: 1 }]);
    const oe = randomUUID();
    await deliver(oe, 1, [mat("m1", "IT-OE-LATE", 5, "T1")]);
    expect(await balance("IT-OE-LATE")).toBe(-4);
    const { getMpStockLedger } = await import("@/lib/mp-stock/mp-stock-ledger");
    await getMpStockLedger().applyIngreso({ email: mpUser.email, sector: mpUser.sector }, { ingresoId: randomUUID(), versionTag: "v1", codigo: "IT-OE-LATE", quantity: 20, lote: "T2", descripcion: "MP IT" });
    expect(await balance("IT-OE-LATE")).toBe(16);
    const re = await deliver(oe, 1, [mat("m1", "IT-OE-LATE", 5, "T1")]);
    expect(re.result?.applied).toEqual([]);
    expect(await balance("IT-OE-LATE")).toBe(16);
    expect((await getMpStockLedger().oeConsumptionReport(oe))[0]).toMatchObject({ consumido: 5, stockAntes: 1, stockDespues: -4 });
  });

  it("dos consumos simultáneos de la misma MP (dos OE): ambos se registran y el saldo final es la suma exacta", async () => {
    await seed("IT-OE-CONC", [{ lote: "C1", kg: 10 }]);
    const [a, b] = [randomUUID(), randomUUID()];
    await Promise.all([progress(a, 1, [mat("m1", "IT-OE-CONC", 7, "C1")]), progress(b, 1, [mat("m1", "IT-OE-CONC", 6, "C1")])]);
    expect(await balance("IT-OE-CONC")).toBe(-3);
    expect(await lotKg("IT-OE-CONC", "C1")).toBe(-3);
    expect((await movements(a)).length + (await movements(b)).length).toBe(2);
  });

  it("filas incompletas: lo identificable se descuenta y solo la fila sin código queda pendiente (sin inventar nada)", async () => {
    await seed("IT-OE-PART", [{ lote: "P1", kg: 10 }]);
    const oe = randomUUID();
    const d = await deliver(oe, 1, [mat("m1", "IT-OE-PART", 4, "P1"), mat("m2", "", 3, "X")]);
    expect(d.result?.applied).toMatchObject([{ codigo: "IT-OE-PART", lote: "P1", delta: -4 }]);
    expect(d.pending?.issues.map((i) => i.field)).toEqual(["codigoMp"]);
    expect(await balance("IT-OE-PART")).toBe(6);
  });
});
