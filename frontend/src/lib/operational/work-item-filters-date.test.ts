import { describe, expect, it } from "vitest";
import { createSectorWorkItem } from "@/lib/__fixtures__/work-item.factory";
import {
  filterWorkItemsByDate,
  filterWorkItemsByWeekStart,
} from "@/lib/operational/work-item-filters";

describe("work-item date filters", () => {
  it("filtra por plannedDate sin mezclar días", () => {
    const items = [
      createSectorWorkItem("ENVASADO_MASIVO", "a", { plannedDate: "2026-07-14", product: "A" }),
      createSectorWorkItem("ENVASADO_MASIVO", "b", { plannedDate: "2026-07-15", product: "B" }),
    ];
    const filtered = filterWorkItemsByDate(items, "2026-07-14");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.product).toBe("A");
  });

  it("filtra por weekStart", () => {
    const items = [
      createSectorWorkItem("ELABORACION", "a", {
        plannedDate: "2026-07-14",
        weekStart: "2026-07-13",
        weekId: "2026-07-13",
      }),
      createSectorWorkItem("ELABORACION", "b", {
        plannedDate: "2026-07-21",
        weekStart: "2026-07-20",
        weekId: "2026-07-20",
      }),
    ];
    expect(filterWorkItemsByWeekStart(items, "2026-07-13")).toHaveLength(1);
  });

  it("Hoy en Buenos Aires agrupa solo plannedDate del día", () => {
    const today = "2026-07-14";
    const items = [
      createSectorWorkItem("ELABORACION", "a", {
        plannedDate: today,
        weekStart: "2026-07-13",
        product: "HOY-A",
      }),
      createSectorWorkItem("ELABORACION", "b", {
        plannedDate: "2026-07-13",
        weekStart: "2026-07-13",
        product: "AYER",
      }),
      createSectorWorkItem("ENVASADO_MASIVO", "c", {
        plannedDate: today,
        weekStart: "2026-07-13",
        product: "HOY-M",
      }),
    ];
    const hoy = filterWorkItemsByDate(items, today);
    expect(hoy.map((i) => i.product).sort()).toEqual(["HOY-A", "HOY-M"]);
  });
});
