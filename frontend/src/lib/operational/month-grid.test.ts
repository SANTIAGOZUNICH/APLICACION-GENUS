import { describe, expect, it } from "vitest";
import { addMonths, buildMonthGrid, groupItemsByMonthDay, monthEndOf, monthGridRange, monthLabel, monthStartOf, undatedItems, type MonthItem } from "./month-grid";

const item = (id: string, plannedDate: string | null, plannedDateTo: string | null = null): MonthItem => ({ id, product: id, client: "C", quantity: "1", unit: "kg", plannedDate, plannedDateTo });

describe("Vista mensual — grilla", () => {
  it("noviembre 2026: semanas lunes→domingo que cubren todo el mes", () => {
    const grid = buildMonthGrid("2026-11-15");
    expect(grid[0]![0]!.date).toBe("2026-10-26"); // lunes
    expect(grid[0]![0]!.inMonth).toBe(false);
    expect(grid[0]![6]!.date).toBe("2026-11-01");
    expect(grid[0]![6]!.inMonth).toBe(true);
    expect(grid[grid.length - 1]![6]!.date).toBe("2026-12-06");
    expect(grid.every((w) => w.length === 7)).toBe(true);
    expect(grid.flat().filter((c) => c.inMonth)).toHaveLength(30);
    expect(monthGridRange("2026-11-01")).toEqual({ from: "2026-10-26", to: "2026-12-06" });
  });
  it("navegación entre meses (incluye cambio de año) y etiquetas", () => {
    expect(monthStartOf("2026-11-17")).toBe("2026-11-01");
    expect(addMonths("2026-11-01", 1)).toBe("2026-12-01");
    expect(addMonths("2026-12-01", 1)).toBe("2027-01-01");
    expect(addMonths("2027-01-01", -1)).toBe("2026-12-01");
    expect(monthEndOf("2028-02-01")).toBe("2028-02-29");
    expect(monthLabel("2026-11-01")).toBe("noviembre 2026");
  });
  it("cada trabajo aparece en el día que cubre (un rango en cada día) y NUNCA se duplica ni se agrega a un día ajeno", () => {
    const grid = buildMonthGrid("2026-11-01");
    const by = groupItemsByMonthDay([item("a", "2026-11-03"), item("rango", "2026-11-03", "2026-11-05"), item("sin", null)], grid);
    expect(by.get("2026-11-03")!.map((i) => i.id)).toEqual(["a", "rango"]);
    expect(by.get("2026-11-04")!.map((i) => i.id)).toEqual(["rango"]);
    expect(by.get("2026-11-06")).toEqual([]);
    expect([...by.values()].flat().some((i) => i.id === "sin")).toBe(false);
  });
  it("«Sin fecha asignada» = los trabajos sin plannedDate", () => {
    expect(undatedItems([item("a", "2026-11-03"), item("b", null), item("c", "  ")]).map((i) => i.id)).toEqual(["b", "c"]);
  });
});
