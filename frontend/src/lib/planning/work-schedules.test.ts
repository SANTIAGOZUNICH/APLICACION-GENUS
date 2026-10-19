import { describe, expect, it } from "vitest";
import { formatQty, parseQty, planSchedules, weekShare } from "./work-schedules";

const root = { id: "a", date: "2026-10-19", qty: 5000 };

describe("programaciones de una misma OA", () => {
  it("OA de 5.000: lunes 2.000, martes 1.500, miércoles 1.500 (la original queda con lo que falta)", () => {
    const p = planSchedules({ members: [root], sourceId: "a", total: 5000, items: [{ date: "2026-10-20", qty: 1500 }, { date: "2026-10-21", qty: 1500 }], rebalance: true, allowExceed: false });
    expect(p).toMatchObject({ ok: true, newSourceQty: 2000, exceeds: false });
  });
  it("OE de 1.000 kg en 300 / 400 / 300", () => {
    const p = planSchedules({ members: [{ ...root, qty: 1000 }], sourceId: "a", total: 1000, items: [{ date: "2026-10-20", qty: 400 }, { date: "2026-10-21", qty: 300 }], rebalance: true, allowExceed: false });
    expect(p).toMatchObject({ ok: true, newSourceQty: 300 });
  });
  it("no deja a la original sin cantidad", () => {
    const p = planSchedules({ members: [root], sourceId: "a", total: 5000, items: [{ date: "2026-10-20", qty: 5000 }], rebalance: true, allowExceed: false });
    expect(p).toMatchObject({ ok: false, code: "NO_REMAINDER" });
  });
  it("copiar tal cual (sin repartir): pide confirmar si supera la orden", () => {
    const base = { members: [root], sourceId: "a", total: 5000, items: [{ date: "2026-10-20", qty: 5000 }], rebalance: false };
    expect(planSchedules({ ...base, allowExceed: false })).toMatchObject({ ok: false, code: "EXCEEDS" });
    expect(planSchedules({ ...base, allowExceed: true })).toMatchObject({ ok: true, exceeds: true, newSourceQty: null });
  });
  it("rechaza días repetidos (doble clic) , fechas y cantidades inválidas", () => {
    const base = { members: [root], sourceId: "a", total: 5000, rebalance: false, allowExceed: true };
    expect(planSchedules({ ...base, items: [{ date: "2026-10-19", qty: 10 }] })).toMatchObject({ code: "DUP_DATE" });
    expect(planSchedules({ ...base, items: [{ date: "2026-10-20", qty: 10 }, { date: "2026-10-20", qty: 10 }] })).toMatchObject({ code: "DUP_DATE" });
    expect(planSchedules({ ...base, items: [{ date: "x", qty: 10 }] })).toMatchObject({ code: "BAD_DATE" });
    expect(planSchedules({ ...base, items: [{ date: "2026-10-20", qty: 0 }] })).toMatchObject({ code: "BAD_QTY" });
    expect(planSchedules({ ...base, items: [] })).toMatchObject({ code: "EMPTY" });
  });
  it("cantidades: formato argentino y decimales", () => {
    expect(parseQty("1500")).toBe(1500);
    expect(parseQty("12,5")).toBe(12.5);
    expect(parseQty("0")).toBeNull();
    expect(formatQty(1500.0004)).toBe("1500");
  });
  it("la necesidad de MP de una orden repartida en semanas suma UNA vez (proporcional)", () => {
    const w1 = weekShare([{ qty: 300, inPeriod: true }, { qty: 400, inPeriod: true }, { qty: 300, inPeriod: false }]);
    const w2 = weekShare([{ qty: 300, inPeriod: false }, { qty: 400, inPeriod: false }, { qty: 300, inPeriod: true }]);
    expect((w1 ?? 0) + (w2 ?? 0)).toBeCloseTo(1, 9);
    expect(w1).toBeCloseTo(0.7);
    expect(weekShare([{ qty: null, inPeriod: true }])).toBeNull();
  });
});
