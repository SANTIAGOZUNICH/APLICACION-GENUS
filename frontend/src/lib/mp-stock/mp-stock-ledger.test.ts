import { describe, expect, it, beforeEach } from "vitest";
import {
  buildOeConsumptionKey,
  getMpStockLedger,
  resetMpStockMemoryForTests,
} from "./mp-stock-ledger";

const mp = { email: "mp@test", sector: "MATERIA_PRIMA" as const };

describe("MpStockLedgerService", () => {
  beforeEach(() => resetMpStockMemoryForTests());

  it("seed saldo inicial una sola vez", async () => {
    const ledger = getMpStockLedger();
    const a = await ledger.seedSaldoInicialOnce(mp, "MP1", 100, "Agua");
    expect(a.stockActual).toBe(100);
    const b = await ledger.seedSaldoInicialOnce(mp, "MP1", 999, "Agua");
    expect(b.stockActual).toBe(100);
  });

  it("ingreso suma; anular revierte", async () => {
    const ledger = getMpStockLedger();
    await ledger.seedSaldoInicialOnce(mp, "MP1", 10);
    await ledger.applyIngreso(mp, {
      ingresoId: "ing-1",
      versionTag: "v1",
      codigo: "MP1",
      quantity: 5,
    });
    expect((await ledger.getBalance("MP1"))!.stockActual).toBe(15);
    await ledger.applyIngreso(mp, {
      ingresoId: "ing-1",
      versionTag: "v1",
      codigo: "MP1",
      quantity: 5,
      anular: true,
    });
    expect((await ledger.getBalance("MP1"))!.stockActual).toBe(10);
  });

  it("borrador OE no descuenta; completa sí; no duplica", async () => {
    const ledger = getMpStockLedger();
    await ledger.seedSaldoInicialOnce(mp, "MP1", 100);
    const draft = await ledger.applyOeConsumption(mp, {
      oeId: "oe1",
      oeVersion: 1,
      oeStatus: "BORRADOR",
      lines: [{ lineId: "l1", codigo: "MP1", kgReal: 10 }],
    });
    expect(draft.applied).toBe(0);
    expect((await ledger.getBalance("MP1"))!.stockActual).toBe(100);

    const once = await ledger.applyOeConsumption(mp, {
      oeId: "oe1",
      oeVersion: 1,
      oeStatus: "COMPLETA",
      lines: [{ lineId: "l1", codigo: "MP1", kgReal: 10 }],
    });
    expect(once.applied).toBe(1);
    expect((await ledger.getBalance("MP1"))!.stockActual).toBe(90);

    const twice = await ledger.applyOeConsumption(mp, {
      oeId: "oe1",
      oeVersion: 1,
      oeStatus: "COMPLETA",
      lines: [{ lineId: "l1", codigo: "MP1", kgReal: 10 }],
    });
    expect(twice.applied).toBe(0);
    expect((await ledger.getBalance("MP1"))!.stockActual).toBe(90);
  });

  it("corrección genera delta; reverso restaura", async () => {
    const ledger = getMpStockLedger();
    await ledger.seedSaldoInicialOnce(mp, "MP1", 100);
    await ledger.applyOeConsumption(mp, {
      oeId: "oe1",
      oeVersion: 1,
      oeStatus: "COMPLETA",
      lines: [{ lineId: "l1", codigo: "MP1", kgReal: 10 }],
    });
    expect((await ledger.getBalance("MP1"))!.stockActual).toBe(90);

    await ledger.applyOeConsumption(mp, {
      oeId: "oe1",
      oeVersion: 2,
      oeStatus: "COMPLETA",
      lines: [{ lineId: "l1", codigo: "MP1", kgReal: 15 }],
    });
    expect((await ledger.getBalance("MP1"))!.stockActual).toBe(85);

    await ledger.reverseOeConsumption(mp, "oe1");
    expect((await ledger.getBalance("MP1"))!.stockActual).toBe(100);
  });

  it("sin código no descuenta", async () => {
    const ledger = getMpStockLedger();
    await ledger.seedSaldoInicialOnce(mp, "MP1", 50);
    const r = await ledger.applyOeConsumption(mp, {
      oeId: "oe2",
      oeVersion: 1,
      oeStatus: "COMPLETA",
      lines: [{ lineId: "l1", codigo: "", kgReal: 10 }],
    });
    expect(r.skippedNoCode).toBe(1);
    expect(r.applied).toBe(0);
    expect((await ledger.getBalance("MP1"))!.stockActual).toBe(50);
  });

  it("ajuste con motivo", async () => {
    const ledger = getMpStockLedger();
    await ledger.seedSaldoInicialOnce(mp, "MP1", 10);
    await ledger.registerAjuste(mp, {
      codigo: "MP1",
      quantity: -2,
      reason: "Merma",
      allowNegative: true,
    });
    expect((await ledger.getBalance("MP1"))!.stockActual).toBe(8);
  });

  it("stock = ingresos − consumo OE ± ajustes", async () => {
    const ledger = getMpStockLedger();
    await ledger.seedSaldoInicialOnce(mp, "MPX", 0);
    await ledger.applyIngreso(mp, {
      ingresoId: "ing-x",
      versionTag: "v1",
      codigo: "MPX",
      quantity: 50,
    });
    await ledger.applyOeConsumption(mp, {
      oeId: "oe-x",
      oeVersion: 1,
      oeStatus: "COMPLETA",
      lines: [{ lineId: "l1", codigo: "MPX", kgReal: 12 }],
    });
    await ledger.registerAjuste(mp, {
      codigo: "MPX",
      quantity: 3,
      reason: "Corrección positiva",
      allowNegative: true,
    });
    expect((await ledger.getBalance("MPX"))!.stockActual).toBe(41);
  });
});
