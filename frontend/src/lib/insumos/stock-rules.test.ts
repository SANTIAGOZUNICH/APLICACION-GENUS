import { describe, expect, it } from "vitest";
import {
  alertDecision,
  alertMessage,
  alertNotificationKey,
  computeStock,
  desiredEgress,
  egressDiff,
  isRetiroTracked,
  needsRestock,
  parseAdjustDelta,
  parseIngresoQty,
  parseInitialStock,
  parseMinStock,
  parseUnit,
  runningBalance,
  stockStatus,
  type LedgerRow,
} from "./stock-rules";

const L = (seq: number, kind: LedgerRow["kind"], delta: number, status = "ACTIVO"): LedgerRow => ({ seq, kind, delta, status });

describe("computeStock (baseline por seq)", () => {
  it("sin stock inicial: no configurado, stock null (≠ 0) y solo totales", () => {
    const s = computeStock([L(1, "INGRESO", 10), L(2, "EGRESO_RETIRO", -3)]);
    expect(s).toMatchObject({ configured: false, stock: null, baseline: null, totalIngresos: 10, totalRetiros: 3 });
  });
  it("stock 0 configurado es distinto de sin configurar", () => {
    expect(computeStock([L(1, "STOCK_INICIAL", 0)])).toMatchObject({ configured: true, stock: 0 });
  });
  it("STOCK = inicial + ingresos − retiros + ajustes (ej. 50, retiro de 3 → 47)", () => {
    const s = computeStock([L(1, "STOCK_INICIAL", 50), L(2, "EGRESO_RETIRO", -3)]);
    expect(s.stock).toBe(47);
    expect(computeStock([L(1, "STOCK_INICIAL", 50), L(2, "INGRESO", 20), L(3, "EGRESO_RETIRO", -7), L(4, "AJUSTE_RETIRO", 2), L(5, "AJUSTE_MANUAL", -4)]).stock).toBe(50 + 20 - 7 + 2 - 4);
  });
  it("lo registrado ANTES del stock inicial no cuenta (los retiros anteriores al conteo no descuentan)", () => {
    const s = computeStock([L(1, "EGRESO_RETIRO", -40), L(2, "INGRESO", 5), L(3, "STOCK_INICIAL", 100), L(4, "EGRESO_RETIRO", -1)]);
    expect(s.stock).toBe(99);
    expect(s.baselineSeq).toBe(3);
  });
  it("vale el último stock inicial activo; uno anulado no cuenta", () => {
    expect(computeStock([L(1, "STOCK_INICIAL", 10), L(2, "STOCK_INICIAL", 20), L(3, "INGRESO", 1)]).stock).toBe(21);
    expect(computeStock([L(1, "STOCK_INICIAL", 10), L(2, "STOCK_INICIAL", 20, "ANULADO"), L(3, "INGRESO", 1)]).stock).toBe(11);
  });
  it("movimientos anulados no suman; el stock puede quedar negativo", () => {
    expect(computeStock([L(1, "STOCK_INICIAL", 5), L(2, "INGRESO", 100, "ANULADO"), L(3, "EGRESO_RETIRO", -8)]).stock).toBe(-3);
  });
});

describe("runningBalance", () => {
  it("saldo después de cada movimiento; null antes del stock inicial", () => {
    const m = runningBalance([L(1, "INGRESO", 4), L(2, "STOCK_INICIAL", 10), L(3, "EGRESO_RETIRO", -3), L(4, "INGRESO", 5, "ANULADO"), L(5, "INGRESO", 2)]);
    expect([1, 2, 3, 4, 5].map((i) => m.get(i))).toEqual([null, 10, 7, 7, 9]);
  });
});

describe("estado por insumo", () => {
  it("SIN_CONFIGURAR / DISPONIBLE / STOCK_BAJO (≤ mínimo) / SIN_STOCK (≤ 0)", () => {
    expect(stockStatus({ configured: false, stock: null, minStock: 5 })).toBe("SIN_CONFIGURAR");
    expect(stockStatus({ configured: true, stock: 6, minStock: 5 })).toBe("DISPONIBLE");
    expect(stockStatus({ configured: true, stock: 5, minStock: 5 })).toBe("STOCK_BAJO");
    expect(stockStatus({ configured: true, stock: 1, minStock: 5 })).toBe("STOCK_BAJO");
    expect(stockStatus({ configured: true, stock: 0, minStock: 5 })).toBe("SIN_STOCK");
    expect(stockStatus({ configured: true, stock: -2, minStock: 0 })).toBe("SIN_STOCK");
    expect(stockStatus({ configured: true, stock: 1, minStock: 0 })).toBe("DISPONIBLE");
  });
  it("requieren reposición solo STOCK_BAJO y SIN_STOCK", () => {
    expect(needsRestock("DISPONIBLE")).toBe(false);
    expect(needsRestock("SIN_CONFIGURAR")).toBe(false);
    expect(needsRestock("STOCK_BAJO")).toBe(true);
    expect(needsRestock("SIN_STOCK")).toBe(true);
  });
});

describe("descuento por retiro (única lógica para alta / corrección / anulación)", () => {
  it("lo deseado sale del estado actual: activo suma, anulado nada, renglones en 0 no cuentan", () => {
    expect([...desiredEgress({ status: "ACTIVO", lines: [{ insumoId: "g", cantidad: 3 }, { insumoId: "c", cantidad: 0 }] })]).toEqual([["g", 3]]);
    expect(desiredEgress({ status: "ANULADO", lines: [{ insumoId: "g", cantidad: 3 }] }).size).toBe(0);
  });
  it("alta: egreso completo; replay (ya descontado) = sin movimiento", () => {
    expect(egressDiff(0, 3)).toEqual({ delta: -3, kind: "EGRESO_RETIRO" });
    expect(egressDiff(3, 3)).toBeNull();
    expect(egressDiff(0, 0)).toBeNull();
  });
  it("corrección: solo la diferencia (3 → 5 descuenta 2 más; 3 → 1 devuelve 2)", () => {
    expect(egressDiff(3, 5)).toEqual({ delta: -2, kind: "AJUSTE_RETIRO" });
    expect(egressDiff(3, 1)).toEqual({ delta: 2, kind: "AJUSTE_RETIRO" });
  });
  it("anulación: revierte todo lo descontado", () => {
    expect(egressDiff(3, 0)).toEqual({ delta: 3, kind: "AJUSTE_RETIRO" });
  });
  it("los retiros anteriores al seguimiento (sin movimientos) no entran; los que ya tienen movimientos sí", () => {
    const start = new Date("2026-11-25T00:00:00Z");
    expect(isRetiroTracked(new Date("2026-11-24T00:00:00Z"), start, false)).toBe(false);
    expect(isRetiroTracked(new Date("2026-11-24T00:00:00Z"), start, true)).toBe(true);
    expect(isRetiroTracked(new Date("2026-11-26T00:00:00Z"), start, false)).toBe(true);
  });
});

describe("alerta por insumo y episodios", () => {
  const base = { active: true, configured: true, minStock: 10 };
  it("sin stock inicial, o insumo de baja: nunca alerta", () => {
    expect(alertDecision({ ...base, configured: false, stock: null, state: "NORMAL" })).toMatchObject({ critical: false, notify: false, next: "NORMAL" });
    expect(alertDecision({ ...base, active: false, stock: 0, state: "NORMAL" })).toMatchObject({ critical: false, notify: false });
    expect(alertDecision({ ...base, active: false, stock: 0, state: "CRITICO" }).next).toBe("NORMAL");
  });
  it("cruza el mínimo: abre episodio y notifica UNA vez; mientras siga bajo no repite", () => {
    expect(alertDecision({ ...base, stock: 10, state: "NORMAL" })).toEqual({ next: "CRITICO", notify: true, critical: true, level: "STOCK_BAJO" });
    expect(alertDecision({ ...base, stock: 4, state: "CRITICO" })).toMatchObject({ next: "CRITICO", notify: false, critical: true });
    expect(alertDecision({ ...base, stock: 0, state: "CRITICO" })).toMatchObject({ notify: false, level: "SIN_STOCK" });
  });
  it("al reponer por encima del mínimo se cierra; si vuelve a caer abre otro episodio", () => {
    expect(alertDecision({ ...base, stock: 11, state: "CRITICO" })).toMatchObject({ next: "NORMAL", critical: false, notify: false });
    expect(alertDecision({ ...base, stock: 9, state: "NORMAL" }).notify).toBe(true);
  });
  it("mínimos distintos por insumo; mínimo 0 solo alerta en 0 o negativo", () => {
    expect(alertDecision({ active: true, configured: true, minStock: 0, stock: 1, state: "NORMAL" }).critical).toBe(false);
    expect(alertDecision({ active: true, configured: true, minStock: 0, stock: 0, state: "NORMAL" })).toMatchObject({ critical: true, level: "SIN_STOCK", notify: true });
    expect(alertDecision({ active: true, configured: true, minStock: 100, stock: 50, state: "NORMAL" }).critical).toBe(true);
  });
  it("clave determinística por insumo y episodio, y texto claro", () => {
    expect(alertNotificationKey("guantes", 2)).toBe("insumos:bajo:guantes:2");
    expect(alertMessage({ name: "GUANTES", stock: 4, minStock: 10, unit: "cajas", level: "STOCK_BAJO" })).toBe("STOCK BAJO DE INSUMOS: GUANTES — stock 4 cajas, mínimo 10. Es necesario reponer.");
    expect(alertMessage({ name: "FILM", stock: 0, minStock: 3, unit: "rollos", level: "SIN_STOCK" })).toMatch(/^SIN STOCK DE INSUMOS: FILM/);
  });
});

describe("validaciones", () => {
  it("ingreso: entero > 0", () => {
    expect(parseIngresoQty("12")).toEqual({ ok: true, value: 12 });
    for (const bad of [0, -1, 1.5, "", "x", null]) expect(parseIngresoQty(bad).ok).toBe(false);
  });
  it("stock inicial y mínimo: entero ≥ 0", () => {
    expect(parseInitialStock(0)).toEqual({ ok: true, value: 0 });
    expect(parseMinStock("7")).toEqual({ ok: true, value: 7 });
    expect(parseInitialStock(-1).ok).toBe(false);
    expect(parseMinStock(2.5).ok).toBe(false);
  });
  it("ajuste: entero distinto de cero", () => {
    expect(parseAdjustDelta(-3)).toEqual({ ok: true, value: -3 });
    expect(parseAdjustDelta(0).ok).toBe(false);
    expect(parseAdjustDelta(1.2).ok).toBe(false);
  });
  it("unidad: texto corto, en minúsculas", () => {
    expect(parseUnit("  Rollos ")).toEqual({ ok: true, value: "rollos" });
    expect(parseUnit("").ok).toBe(false);
    expect(parseUnit("x".repeat(31)).ok).toBe(false);
  });
});
