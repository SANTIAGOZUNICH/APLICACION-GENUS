/**
 * OE · LOTE MP opcional en un Postgres de PRUEBA real: «Guardar avance» descuenta por CÓDIGO (FEFO / FIFO entre lotes aptos),
 * en la misma transacción que usa la app (runOeStockOp → runMpInventoryOp + libro mayor), sin duplicar, con auditoría y
 * sin descuentos parciales. Se SALTA sin base local marcada.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const RUN = Date.now().toString().slice(-6);
const P = `IT-OL-${RUN}`;
const mp = { email: "it-mp@laboratoriogenus.com.ar", sector: "MATERIA_PRIMA" as const, displayName: "IT MP" };
const elab = { email: "it-elab@laboratoriogenus.com.ar", sector: "ELABORACION" as const, displayName: "IT Elaboración" };

describe.skipIf(Boolean(PROBLEM))(`OE: LOTE MP opcional en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const balance = async (c: string) => Number((await q("select stock_actual from mp_stock_balances where codigo = $1", [c]))[0]?.stock_actual ?? 0);
  const lotKg = async (c: string, lote: string) => Number(((await q("select payload from inv_mp_stock where payload->>'codigo' = $1 and payload->>'lote' = $2", [c, lote]))[0]?.payload as { cantidadKg?: number } | undefined)?.cantidadKg ?? NaN);
  const movs = async (c: string) => q("select kind, quantity, lote, ref_type, ref_id from mp_stock_movements where codigo = $1 and kind = 'CONSUMO_OE' order by created_at, id", [c]);
  const cleanup = async () => {
    await q(`delete from inv_mp_stock where payload->>'codigo' like '${P}%'`);
    await q(`delete from mp_stock_movements where codigo like '${P}%'`);
    await q(`delete from mp_stock_balances where codigo like '${P}%'`);
  };
  const seed = async (lots: Array<{ codigo: string; lote: string; kg: number; vencimiento?: string; estadoStockManual?: string }>) => {
    const { runMpInventoryOp } = await import("@/lib/inventory/mp-planilla-db");
    for (const l of lots) {
      await runMpInventoryOp(mp, ({ service, repo }) => {
        const row = service.upsertMpStock(mp, { codigo: l.codigo, lote: l.lote, cantidadKg: l.kg, descripcion: l.codigo, ...(l.vencimiento ? { vencimiento: l.vencimiento } : {}) });
        if (l.estadoStockManual) repo.upsertMpStock({ ...row, estadoStockManual: l.estadoStockManual });
        return row;
      });
    }
  };
  /** «Guardar avance» con una fila de MP (kg reales por código, lote opcional): exactamente lo que ejecuta la app. */
  const avance = async (oeId: string, version: number, codigoMp: string, kgReal: number | null, lote = "") => {
    const { runOeStockOp, registerOeProgressConsumption } = await import("@/lib/orders/oe-stock-op");
    const { emptyOeMaterial } = await import("@/lib/orders/content");
    return runOeStockOp(elab, (ctx) =>
      registerOeProgressConsumption(ctx, elab, { oeId, orderNumber: `OE-${oeId.slice(0, 6)}`, orderVersion: version, orderStatus: "EN_CURSO", materials: [emptyOeMaterial({ materiaPrima: "MP", codigoMp, kgReal, lote })] })
    );
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

  it("sin lote: 25 kg − 3 kg = 22 kg; guardar de nuevo no duplica; cambiar la cantidad aplica solo la diferencia; todo auditado con la OE", async () => {
    const c = `${P}-A`;
    await seed([{ codigo: c, lote: "G-1", kg: 25 }]);
    const oe = randomUUID();
    const a = await avance(oe, 1, c, 3);
    expect(a.applied).toEqual([{ codigo: c, lote: "G-1", delta: -3 }]);
    expect([await balance(c), await lotKg(c, "G-1")]).toEqual([22, 22]);
    expect((await avance(oe, 2, c, 3)).applied).toEqual([]);
    expect((await avance(oe, 3, c, 5)).applied).toEqual([{ codigo: c, lote: "G-1", delta: -2 }]);
    expect((await avance(oe, 4, c, 4)).applied).toEqual([{ codigo: c, lote: "G-1", delta: 1 }]);
    expect([await balance(c), await lotKg(c, "G-1")]).toEqual([21, 21]);
    const m = await movs(c);
    expect(m.map((x) => [Number(x.quantity), x.ref_type, x.ref_id])).toEqual([[-3, "oe", oe], [-2, "oe", oe], [1, "oe", oe]].map((r) => r) as never);
    expect((await q("select 1 from inv_audit where payload->>'module' = 'mp_stock' and payload->'after'->>'oeId' = $1", [oe])).length).toBeGreaterThanOrEqual(3);
  });

  it("dos lotes sin indicar lote: FEFO 2 kg del A + 3 kg del B (stock restante 5 kg); con el mismo OE no mueve kg entre lotes", async () => {
    const c = `${P}-B`;
    await seed([{ codigo: c, lote: "B", kg: 8, vencimiento: "2999-06-01" }, { codigo: c, lote: "A", kg: 2, vencimiento: "2999-01-01" }]);
    const oe = randomUUID();
    expect((await avance(oe, 1, c, 5)).applied).toEqual([{ codigo: c, lote: "A", delta: -2 }, { codigo: c, lote: "B", delta: -3 }]);
    expect([await lotKg(c, "A"), await lotKg(c, "B"), await balance(c)]).toEqual([0, 5, 5]);
    expect((await avance(oe, 2, c, 5)).applied).toEqual([]);
    expect((await avance(oe, 3, c, 6)).applied).toEqual([{ codigo: c, lote: "B", delta: -1 }]);
    expect([await lotKg(c, "A"), await lotKg(c, "B"), await balance(c)]).toEqual([0, 4, 4]);
  });

  it("lote explícito: se respeta (validando su disponibilidad); stock insuficiente: no descuenta nada; vencido / cuarentena / código inexistente: no se consume", async () => {
    const c = `${P}-C`;
    await seed([{ codigo: c, lote: "A", kg: 2 }, { codigo: c, lote: "B", kg: 8 }, { codigo: `${P}-Q`, lote: "Q", kg: 50, estadoStockManual: "Cuarentena" }, { codigo: `${P}-V`, lote: "V", kg: 50, vencimiento: "2020-01-01" }]);
    const oe = randomUUID();
    const corto = await avance(oe, 1, c, 5, "A");
    expect(corto.applied).toEqual([]);
    expect(corto.shortages.map((s) => s.lote)).toEqual(["A"]);
    expect([await lotKg(c, "A"), await lotKg(c, "B"), await balance(c)]).toEqual([2, 8, 10]);
    expect((await avance(oe, 2, c, 5, "B")).applied).toEqual([{ codigo: c, lote: "B", delta: -5 }]);
    const sinStock = await avance(randomUUID(), 1, c, 500);
    expect(sinStock.applied).toEqual([]);
    expect(sinStock.shortages.length).toBeGreaterThan(0);
    for (const code of [`${P}-Q`, `${P}-V`]) {
      const r = await avance(randomUUID(), 1, code, 1);
      expect(r.applied).toEqual([]);
      expect(r.pendingIssues.join(" ")).toMatch(/no se consume/);
      expect(await balance(code)).toBe(50);
    }
    const no = await avance(randomUUID(), 1, `${P}-NOEXISTE`, 1);
    expect(no.applied).toEqual([]);
    expect(no.pendingIssues.join(" ")).toContain("no existe en Stock MP");
  });
});
