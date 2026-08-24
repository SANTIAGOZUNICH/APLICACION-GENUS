import { describe, expect, it } from "vitest";
import {
  addDaysIso,
  dayOfWeekName,
  resolvePlannedDateIso,
  todayInBuenosAires,
  weekStartMonday,
  workWeekDays,
} from "@/lib/operational/operational-calendar";

describe("operational-calendar Buenos Aires", () => {
  it("resuelve Hoy como YYYY-MM-DD", () => {
    const today = todayInBuenosAires();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("resuelve plannedDate desde día+mes del sheet", () => {
    expect(resolvePlannedDateIso("14", "julio", 2026)).toBe("2026-07-14");
    expect(resolvePlannedDateIso("1", "Febrero", 2026)).toBe("2026-02-01");
    expect(resolvePlannedDateIso("31", "abril", 2026)).toBeNull();
    expect(resolvePlannedDateIso(null, "julio", 2026)).toBeNull();
  });

  it("calcula lunes de semana laboral", () => {
    expect(weekStartMonday("2026-07-14")).toBe("2026-07-13");
    expect(weekStartMonday("2026-07-13")).toBe("2026-07-13");
  });

  it("navega días y semana L–V", () => {
    expect(addDaysIso("2026-07-14", -1)).toBe("2026-07-13");
    expect(addDaysIso("2026-07-14", 1)).toBe("2026-07-15");
    expect(workWeekDays("2026-07-13")).toEqual([
      "2026-07-13",
      "2026-07-14",
      "2026-07-15",
      "2026-07-16",
      "2026-07-17",
    ]);
    expect(dayOfWeekName("2026-07-14")).toBe("Martes");
  });

  /**
   * Casos 4/5 obligatorios — goPrevWeek/goNextWeek (use-operational-calendar.ts)
   * se implementan como addDaysIso(weekStartMonday(d), ±7); esto prueba
   * exactamente esa aritmética con el ejemplo del pedido (24/08 → 31/08 →
   * 07/09 → vuelta a 31/08), exactamente ±1 semana, sin saltar meses.
   */
  it("navega exactamente ±1 semana (ejemplo del pedido: 24/08 → 31/08 → 07/09 → 31/08)", () => {
    const week1 = weekStartMonday("2026-08-24");
    expect(week1).toBe("2026-08-24");

    const week2 = weekStartMonday(addDaysIso(week1, 7));
    expect(week2).toBe("2026-08-31");

    const week3 = weekStartMonday(addDaysIso(week2, 7));
    expect(week3).toBe("2026-09-07");

    const back = weekStartMonday(addDaysIso(week3, -7));
    expect(back).toBe("2026-08-31");
  });

  it("nunca salta más de una semana, incluso cruzando fin de mes/año", () => {
    expect(weekStartMonday(addDaysIso(weekStartMonday("2026-12-28"), 7))).toBe("2027-01-04");
    expect(weekStartMonday(addDaysIso(weekStartMonday("2027-01-04"), -7))).toBe("2026-12-28");
  });
});
