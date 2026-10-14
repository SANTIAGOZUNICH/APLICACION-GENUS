import { describe, expect, it, beforeEach } from "vitest";
import {
  buildOeConsumptionKey,
  buildOePositionId,
  getMpStockLedger,
  resetMpStockMemoryForTests,
} from "./mp-stock-ledger";

const mp = { email: "mp@test", sector: "MATERIA_PRIMA" as const };

describe("MpStockLedgerService", () => {
  beforeEach(() => resetMpStockMemoryForTests());

  it("clave de consumo OE: OE + código + lote + versión; MP1 no se confunde con MP10", () => {
    expect(buildOePositionId(" mp1 ", " l 1 ")).toBe("MP1|lote:L 1");
    expect(buildOeConsumptionKey("oe1", 2, "mp1", "a")).toBe("oe-consumo:oe1:cod:MP1|lote:A:v2");
    expect(buildOeConsumptionKey("oe1", 2, "MP1", "A").startsWith(buildOeConsumptionKey("oe1", 2, "MP10", "A"))).toBe(false);
    expect(buildOeConsumptionKey("oe1", 2, "MP10", "A").startsWith("oe-consumo:oe1:cod:MP1|")).toBe(false);
  });

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

  it("editar ingreso aplica delta; cambio de código revierte y reaplica", async () => {
    const ledger = getMpStockLedger();
    await ledger.seedSaldoInicialOnce(mp, "AAA", 0);
    await ledger.seedSaldoInicialOnce(mp, "BBB", 0);

    await ledger.applyIngreso(mp, {
      ingresoId: "ing-delta",
      versionTag: "t1",
      codigo: "AAA",
      quantity: 20,
      previousQuantity: 0,
    });
    expect((await ledger.getBalance("AAA"))!.stockActual).toBe(20);

    await ledger.applyIngreso(mp, {
      ingresoId: "ing-delta",
      versionTag: "t2",
      codigo: "AAA",
      quantity: 15,
      previousQuantity: 20,
    });
    expect((await ledger.getBalance("AAA"))!.stockActual).toBe(15);

    // reverse old code via delta to 0
    await ledger.applyIngreso(mp, {
      ingresoId: "ing-delta",
      versionTag: "t3-rev",
      codigo: "AAA",
      quantity: 0,
      previousQuantity: 15,
    });
    expect((await ledger.getBalance("AAA"))!.stockActual).toBe(0);

    await ledger.applyIngreso(mp, {
      ingresoId: "ing-delta",
      versionTag: "t3-new",
      codigo: "BBB",
      quantity: 15,
      previousQuantity: 0,
    });
    expect((await ledger.getBalance("BBB"))!.stockActual).toBe(15);
  });

  it("borrador OE no descuenta; completa sí; reintento de la misma entrega no duplica", async () => {
    const ledger = getMpStockLedger();
    await ledger.seedSaldoInicialOnce(mp, "MP1", 100);
    const lines = [{ codigo: "MP1", lote: "A", kg: 10 }];
    expect(await ledger.applyOeConsumption(mp, { oeId: "oe1", oeVersion: 1, oeStatus: "BORRADOR", lines })).toEqual([]);
    expect((await ledger.getBalance("MP1"))!.stockActual).toBe(100);

    const once = await ledger.applyOeConsumption(mp, { oeId: "oe1", oeVersion: 2, oeStatus: "COMPLETA", lines });
    expect(once).toEqual([{ codigo: "MP1", lote: "A", delta: -10, lotId: null }]);
    expect((await ledger.getBalance("MP1"))!.stockActual).toBe(90);

    // Reintento (misma versión) y confirmación duplicada (otra versión, mismos kg): nada nuevo.
    expect(await ledger.applyOeConsumption(mp, { oeId: "oe1", oeVersion: 2, oeStatus: "COMPLETA", lines })).toEqual([]);
    expect(await ledger.applyOeConsumption(mp, { oeId: "oe1", oeVersion: 3, oeStatus: "COMPLETA", lines })).toEqual([]);
    expect((await ledger.getBalance("MP1"))!.stockActual).toBe(90);
    expect((await ledger.history("MP1")).filter((m) => m.kind === "CONSUMO_OE")).toHaveLength(1);
  });

  it("re-entrega con kg reales corregidos: solo la diferencia; reverso deja todo como estaba", async () => {
    const ledger = getMpStockLedger();
    await ledger.seedSaldoInicialOnce(mp, "MP1", 100);
    await ledger.applyOeConsumption(mp, { oeId: "oe1", oeVersion: 1, oeStatus: "COMPLETA", lines: [{ codigo: "MP1", lote: "A", kg: 10 }] });
    expect((await ledger.getBalance("MP1"))!.stockActual).toBe(90);
    const corr = await ledger.applyOeConsumption(mp, { oeId: "oe1", oeVersion: 3, oeStatus: "COMPLETA", lines: [{ codigo: "MP1", lote: "A", kg: 15 }] });
    expect(corr).toEqual([{ codigo: "MP1", lote: "A", delta: -5, lotId: null }]);
    expect((await ledger.getBalance("MP1"))!.stockActual).toBe(85);

    const rev = await ledger.reverseOeConsumption(mp, "oe1", 4);
    expect(rev).toEqual([{ codigo: "MP1", lote: "A", delta: 15, lotId: null }]);
    expect((await ledger.getBalance("MP1"))!.stockActual).toBe(100);
  });

  it("ciclo entregar → anular → reentregar → anular: cada reverso devuelve lo realmente descontado", async () => {
    const ledger = getMpStockLedger();
    await ledger.seedSaldoInicialOnce(mp, "MP1", 100);
    await ledger.seedSaldoInicialOnce(mp, "MP2", 50);
    const lines = [
      { codigo: "MP1", lote: "A", kg: 10 },
      { codigo: "MP2", lote: "B", kg: 8 },
    ];
    await ledger.applyOeConsumption(mp, { oeId: "oe-rev", oeVersion: 1, oeStatus: "COMPLETA", lines });
    expect((await ledger.getBalance("MP1"))!.stockActual).toBe(90);
    expect((await ledger.getBalance("MP2"))!.stockActual).toBe(42);

    expect(await ledger.reverseOeConsumption(mp, "oe-rev", 2)).toHaveLength(2);
    expect(await ledger.reverseOeConsumption(mp, "oe-rev", 2)).toEqual([]); // reintento
    expect(await ledger.reverseOeConsumption(mp, "oe-rev", 3)).toEqual([]); // ya en cero
    expect((await ledger.getBalance("MP1"))!.stockActual).toBe(100);

    await ledger.applyOeConsumption(mp, { oeId: "oe-rev", oeVersion: 4, oeStatus: "COMPLETA", lines });
    expect((await ledger.getBalance("MP1"))!.stockActual).toBe(90);
    expect(await ledger.reverseOeConsumption(mp, "oe-rev", 5)).toHaveLength(2);
    expect((await ledger.getBalance("MP1"))!.stockActual).toBe(100);
    expect((await ledger.getBalance("MP2"))!.stockActual).toBe(50);
  });

  it("MP1 y MP10 en la misma OE: cada código descuenta y revierte lo suyo", async () => {
    const ledger = getMpStockLedger();
    await ledger.seedSaldoInicialOnce(mp, "MP1", 100);
    await ledger.seedSaldoInicialOnce(mp, "MP10", 100);
    await ledger.applyOeConsumption(mp, {
      oeId: "oe-x",
      oeVersion: 1,
      oeStatus: "COMPLETA",
      lines: [
        { codigo: "MP1", lote: "A", kg: 1 },
        { codigo: "MP10", lote: "A", kg: 10 },
      ],
    });
    expect((await ledger.getBalance("MP1"))!.stockActual).toBe(99);
    expect((await ledger.getBalance("MP10"))!.stockActual).toBe(90);
    await ledger.reverseOeConsumption(mp, "oe-x", 2);
    expect((await ledger.getBalance("MP1"))!.stockActual).toBe(100);
    expect((await ledger.getBalance("MP10"))!.stockActual).toBe(100);
  });

  it("mismo código en varios lotes: un movimiento por lote; cambiar de lote mueve el consumo", async () => {
    const ledger = getMpStockLedger();
    await ledger.seedSaldoInicialOnce(mp, "MP1", 100);
    const r = await ledger.applyOeConsumption(mp, {
      oeId: "oe-l",
      oeVersion: 1,
      oeStatus: "COMPLETA",
      lines: [
        { codigo: "MP1", lote: "A", kg: 6 },
        { codigo: "mp1", lote: "B", kg: 4 },
      ],
    });
    expect(r).toHaveLength(2);
    expect((await ledger.getBalance("MP1"))!.stockActual).toBe(90);
    const moved = await ledger.applyOeConsumption(mp, {
      oeId: "oe-l",
      oeVersion: 3,
      oeStatus: "COMPLETA",
      lines: [{ codigo: "MP1", lote: "A", kg: 10 }],
    });
    expect(moved).toEqual([
      { codigo: "MP1", lote: "A", delta: -4, lotId: null },
      { codigo: "MP1", lote: "B", delta: 4, lotId: null },
    ]);
    expect((await ledger.getBalance("MP1"))!.stockActual).toBe(90);
  });

  it("stock insuficiente: rechaza sin escribir; con autorización explícita permite negativo", async () => {
    const ledger = getMpStockLedger();
    await ledger.seedSaldoInicialOnce(mp, "MP1", 5);
    const lines = [{ codigo: "MP1", lote: "A", kg: 8 }];
    await expect(ledger.applyOeConsumption(mp, { oeId: "oe-n", oeVersion: 1, oeStatus: "COMPLETA", lines })).rejects.toThrow();
    expect((await ledger.getBalance("MP1"))!.stockActual).toBe(5);
    await ledger.applyOeConsumption(mp, { oeId: "oe-n", oeVersion: 1, oeStatus: "COMPLETA", lines, allowNegative: true });
    expect((await ledger.getBalance("MP1"))!.stockActual).toBe(-3);
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
      lines: [{ codigo: "MPX", lote: "L1", kg: 12 }],
    });
    await ledger.registerAjuste(mp, {
      codigo: "MPX",
      quantity: 3,
      reason: "Corrección positiva",
      allowNegative: true,
    });
    expect((await ledger.getBalance("MPX"))!.stockActual).toBe(41);
  });

  it("código repetido en OE (mismo lote) se consolida en un movimiento", async () => {
    const ledger = getMpStockLedger();
    await ledger.seedSaldoInicialOnce(mp, "MP1", 100);
    const r = await ledger.applyOeConsumption(mp, {
      oeId: "oe-consol",
      oeVersion: 1,
      oeStatus: "COMPLETA",
      lines: [
        { codigo: "MP1", lote: "A", kg: 10 },
        { codigo: "mp1", lote: "a", kg: 5 },
      ],
    });
    expect(r).toEqual([{ codigo: "MP1", lote: "A", delta: -15, lotId: null }]);
    expect((await ledger.getBalance("MP1"))!.stockActual).toBe(85);
  });
});

describe("MpStockLedgerService — fila de Stock MP del consumo", () => {
  beforeEach(() => resetMpStockMemoryForTests());

  it("guarda la fila (lotId) en el movimiento y el reverso la devuelve aunque no se informe", async () => {
    const ledger = getMpStockLedger();
    await ledger.seedSaldoInicialOnce(mp, "MP1", 100);
    const r = await ledger.applyOeConsumption(mp, {
      oeId: "oe-row",
      oeVersion: 1,
      oeStatus: "COMPLETA",
      lines: [{ codigo: "MP1", lote: "L-REAL", kg: 3, lotId: "fila-1" }],
    });
    expect(r).toEqual([{ codigo: "MP1", lote: "L-REAL", delta: -3, lotId: "fila-1" }]);
    expect((await ledger.oeNetPositions("oe-row")).get(buildOePositionId("MP1", "L-REAL"))?.lotId).toBe("fila-1");
    expect(await ledger.reverseOeConsumption(mp, "oe-row", 2)).toEqual([{ codigo: "MP1", lote: "L-REAL", delta: 3, lotId: "fila-1" }]);
  });
});
