import { describe, expect, it } from "vitest";
import { addDaysIso, gridRange, longDateLabel, monthGrid, shiftMonth } from "./calendar";

describe("monthGrid", () => {
  it("octubre 2026 (empieza jueves): semanas de lunes a domingo, completas", () => {
    const g = monthGrid(2026, 10);
    expect(g).toHaveLength(5);
    expect(g.every((w) => w.length === 7)).toBe(true);
    expect(g[0]![0]!.iso).toBe("2026-09-28"); // lunes anterior
    expect(g[0]![3]).toMatchObject({ iso: "2026-10-01", inMonth: true });
    expect(g[4]![6]!.iso).toBe("2026-11-01");
    expect(g.flat().filter((d) => d.inMonth)).toHaveLength(31);
  });
  it("un mes que empieza lunes y tiene 28 días ocupa 4 filas exactas (febrero 2027)", () => {
    expect(monthGrid(2027, 2)).toHaveLength(4);
  });
  it("un mes de 6 filas (agosto 2026 empieza sábado)", () => {
    expect(monthGrid(2026, 8)).toHaveLength(6);
  });
  it("gridRange cubre desde el primer lunes visible hasta el último domingo", () => {
    expect(gridRange(2026, 10)).toEqual({ from: "2026-09-28", to: "2026-11-01" });
  });
});

describe("navegación y etiquetas", () => {
  it("cambia de mes cruzando el año", () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth(2026, 10, 14)).toEqual({ year: 2027, month: 12 });
  });
  it("suma días sin errores de horario", () => {
    expect(addDaysIso("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("etiqueta larga en castellano", () => {
    expect(longDateLabel("2026-10-15")).toBe("jueves 15 de octubre de 2026");
  });
});
