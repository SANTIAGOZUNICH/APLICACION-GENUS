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
});
