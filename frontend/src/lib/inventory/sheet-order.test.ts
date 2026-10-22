import { describe, expect, it } from "vitest";
import { beforeIdForShift, planMove, type SeqRow } from "./sheet-order";

const rows = (n: number): SeqRow[] => Array.from({ length: n }, (_, i) => ({ id: `r${i + 1}`, seq: (i + 1) * 10 }));
const apply = (base: SeqRow[], ch: SeqRow[]) =>
  base.map((r) => ({ ...r, seq: ch.find((c) => c.id === r.id)?.seq ?? r.seq })).sort((a, b) => a.seq - b.seq).map((r) => r.id);

describe("planMove", () => {
  it("sube una fila una posición y solo toca las dos afectadas", () => {
    const ch = planMove(rows(5), "r3", "r2");
    expect(ch).toHaveLength(2);
    expect(apply(rows(5), ch)).toEqual(["r1", "r3", "r2", "r4", "r5"]);
  });
  it("baja al final reparte las mismas posiciones", () => {
    const base = rows(4);
    const ch = planMove(base, "r1", null);
    expect(apply(base, ch)).toEqual(["r2", "r3", "r4", "r1"]);
    expect(new Set([...base.map((r) => r.seq)])).toEqual(new Set(base.map((r) => ch.find((c) => c.id === r.id)?.seq ?? r.seq)));
  });
  it("sin cambio no devuelve nada", () => {
    expect(planMove(rows(3), "r2", "r2")).toEqual([]);
    expect(planMove(rows(3), "r2", "r3")).toEqual([]);
    expect(planMove(rows(3), "r3", null)).toEqual([]);
  });
  it("mueve a la fila 1 y rechaza ids inexistentes", () => {
    expect(apply(rows(4), planMove(rows(4), "r4", "r1"))).toEqual(["r4", "r1", "r2", "r3"]);
    expect(() => planMove(rows(2), "x", null)).toThrow();
    expect(() => planMove(rows(2), "r1", "x")).toThrow();
  });
});

describe("beforeIdForShift", () => {
  const v = ["a", "b", "c", "d"];
  it("calcula el ancla", () => {
    expect(beforeIdForShift(v, "c", "up")).toBe("b");
    expect(beforeIdForShift(v, "a", "up")).toBeUndefined();
    expect(beforeIdForShift(v, "a", "down")).toBe("c");
    expect(beforeIdForShift(v, "c", "down")).toBeNull();
    expect(beforeIdForShift(v, "d", "down")).toBeUndefined();
    expect(beforeIdForShift(v, "c", "top")).toBe("a");
    expect(beforeIdForShift(v, "b", "bottom")).toBeNull();
  });
});
