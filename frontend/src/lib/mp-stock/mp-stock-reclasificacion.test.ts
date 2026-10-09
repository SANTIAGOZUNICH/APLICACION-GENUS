import { beforeEach, describe, expect, it } from "vitest";
import { MpLedgerConflictError, getMpStockLedger, resetMpStockMemoryForTests } from "./mp-stock-ledger";

const mp = { email: "mp@test", sector: "MATERIA_PRIMA" as const };
const prod = { email: "prod@test", sector: "PRODUCCION" as const };

describe("libro mayor: corrección de código y saldo del código (Stock MP)", () => {
  beforeEach(() => resetMpStockMemoryForTests());

  it("reclasificación completa: traspasa TODO el saldo, deja alias y no toca la historia", async () => {
    const l = getMpStockLedger();
    await l.registerAjuste(mp, { codigo: "VIEJO", quantity: 50, reason: "alta" });
    const before = await l.history("VIEJO");
    await l.applyOeConsumption(prod, { oeId: "oe1", oeVersion: 1, oeStatus: "COMPLETA", lines: [{ lineId: "a", codigo: "VIEJO", kgReal: 10 }], allowNegative: true });
    const viejoAntes = (await l.history("VIEJO")).length;
    const { moved } = await l.reclassifyCodigo(mp, { from: "VIEJO", to: "NUEVO", mode: "all", reason: "código mal cargado", refId: "r1" });
    expect(moved).toBe(40);
    expect((await l.getBalance("NUEVO"))?.stockActual).toBe(40);
    // Historia: los movimientos anteriores siguen iguales, solo se agrega la salida por reclasificación.
    const hist = await l.history("VIEJO");
    expect(hist.length).toBe(viejoAntes + 1);
    expect(hist.filter((m) => m.kind !== "RECLASIFICACION").map((m) => m.idempotencyKey)).toEqual(expect.arrayContaining(before.map((m) => m.idempotencyKey)));
    // Alias: el reverso de la OE vieja y un consumo nuevo con el código viejo caen en el código nuevo.
    await l.reverseOeConsumption(prod, "oe1");
    expect((await l.getBalance("NUEVO"))?.stockActual).toBe(50);
    await l.applyOeConsumption(prod, { oeId: "oe2", oeVersion: 1, oeStatus: "COMPLETA", lines: [{ lineId: "b", codigo: "VIEJO", kgReal: 5 }], allowNegative: true });
    expect((await l.getBalance("NUEVO"))?.stockActual).toBe(45);
    expect((await l.getBalance("VIEJO"))?.stockActual).toBe(45); // getBalance del código viejo = el vigente
  });

  it("reclasificación parcial (otros lotes con el mismo código): solo los kg del lote, sin alias; idempotente", async () => {
    const l = getMpStockLedger();
    await l.registerAjuste(mp, { codigo: "A", quantity: 30, reason: "alta" });
    await l.reclassifyCodigo(mp, { from: "A", to: "B", mode: "quantity", quantity: 12, reason: "separar lote", refId: "r2" });
    await l.reclassifyCodigo(mp, { from: "A", to: "B", mode: "quantity", quantity: 12, reason: "separar lote", refId: "r2" });
    expect((await l.getBalance("A"))?.stockActual).toBe(18);
    expect((await l.getBalance("B"))?.stockActual).toBe(12);
  });

  it("volver al código anterior no genera ciclos", async () => {
    const l = getMpStockLedger();
    await l.registerAjuste(mp, { codigo: "X", quantity: 7, reason: "alta" });
    await l.reclassifyCodigo(mp, { from: "X", to: "Y", mode: "all", reason: "corrección", refId: "r3" });
    await l.reclassifyCodigo(mp, { from: "Y", to: "X", mode: "all", reason: "me equivoqué", refId: "r4" });
    expect(await l.resolveCodigo("X")).toBe("X");
    expect(await l.resolveCodigo("Y")).toBe("X");
    expect((await l.getBalance("X"))?.stockActual).toBe(7);
  });

  it("Stock código: ajuste por la diferencia con motivo; si el saldo cambió → conflicto", async () => {
    const l = getMpStockLedger();
    await l.registerAjuste(mp, { codigo: "S", quantity: 20, reason: "alta" });
    const r = await l.adjustCodigoBalance(mp, { codigo: "S", target: 26.5, expected: 20, reason: "Conteo físico", refId: "s1" });
    expect(r).toEqual({ delta: 6.5, balance: 26.5 });
    const last = (await l.history("S")).find((m) => m.refType === "mp_saldo_codigo");
    expect(last?.kind).toBe("AJUSTE");
    expect(last?.reason).toMatch(/Conteo físico/);
    await expect(l.adjustCodigoBalance(mp, { codigo: "S", target: 10, expected: 20, reason: "Conteo físico", refId: "s2" })).rejects.toBeInstanceOf(MpLedgerConflictError);
    expect((await l.getBalance("S"))?.stockActual).toBe(26.5);
  });
});
