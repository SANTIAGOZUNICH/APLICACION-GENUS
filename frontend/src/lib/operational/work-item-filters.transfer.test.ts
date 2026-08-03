import { describe, expect, it } from "vitest";
import {
  filterWorkItemsByDate,
  filterWorkItemsByWeekStart,
  filterWorkItemsForSectorAndPerson,
} from "@/lib/operational/work-item-filters";
import { workItemCoversDate, workItemOverlapsWeek } from "@/lib/operational/work-item-date-range";
import type { WorkItem } from "@/types/operational/work-item";

function item(partial: Partial<WorkItem> & Pick<WorkItem, "id" | "sector" | "plannedDate">): WorkItem {
  return {
    client: "Cliente",
    product: "Producto",
    quantity: "10",
    unit: "u",
    status: "pendiente",
    dayLabel: "",
    ownerPerson: null,
    ownerSector: partial.sector,
    ...partial,
  } as WorkItem;
}

describe("work-items SQL filter parity (client-side mirror)", () => {
  const base = [
    item({
      id: "a",
      sector: "ENVASADO_MASIVO",
      plannedDate: "2026-07-28",
      plannedDateTo: "2026-07-30",
    }),
    item({
      id: "b",
      sector: "ENVASADO_PREMIUM",
      plannedDate: "2026-07-29",
    }),
    item({
      id: "c",
      sector: "ELABORACION",
      plannedDate: "2026-07-20",
      plannedDateTo: "2026-07-21",
    }),
  ];

  it("date filter matches workItemCoversDate (mismo criterio que SQL coalesce)", () => {
    const date = "2026-07-29";
    const filtered = filterWorkItemsByDate(base, date);
    expect(filtered.map((x) => x.id).sort()).toEqual(["a", "b"]);
    for (const row of base) {
      expect(filtered.includes(row)).toBe(workItemCoversDate(row, date));
    }
  });

  it("week filter matches workItemOverlapsWeek", () => {
    const weekStart = "2026-07-27"; // Lunes
    const filtered = filterWorkItemsByWeekStart(base, weekStart);
    expect(filtered.map((x) => x.id).sort()).toEqual(["a", "b"]);
    for (const row of base) {
      expect(filtered.includes(row)).toBe(workItemOverlapsWeek(row, weekStart));
    }
  });

  it("RBAC sector: Masivo no ve Premium ni Elaboración", () => {
    const masivo = filterWorkItemsForSectorAndPerson(base, "ENVASADO_MASIVO");
    expect(masivo.map((x) => x.id)).toEqual(["a"]);
  });

  it("RBAC Producción agrega sectores operativos", () => {
    const prod = filterWorkItemsForSectorAndPerson(base, "PRODUCCION");
    expect(prod.map((x) => x.id).sort()).toEqual(["a", "b", "c"]);
  });
});
