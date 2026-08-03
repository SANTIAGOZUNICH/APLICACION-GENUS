import { describe, expect, it } from "vitest";
import {
  compareByDeliveryDateAsc,
  formatDateDisplay,
  parseFlexibleDate,
  resolveDeliveryUrgency,
  sortByDeliveryDateNearest,
  todayIso,
} from "./delivery-date";

describe("delivery-date", () => {
  it("parsea fechas flexibles usadas por importaciones operativas", () => {
    expect(parseFlexibleDate("2026-7-3")).toBe("2026-07-03");
    expect(parseFlexibleDate("03/07/2026")).toBe("2026-07-03");
    expect(parseFlexibleDate("7-2026")).toBe("2026-07-31");
    expect(parseFlexibleDate("")).toBeNull();
  });

  it("formatea y compara fechas ISO", () => {
    expect(formatDateDisplay("2026-07-03")).toBe("03/07/2026");
    expect(formatDateDisplay(null)).toBe("—");
    expect(compareByDeliveryDateAsc("2026-07-01", "2026-07-02")).toBeLessThan(0);
    expect(compareByDeliveryDateAsc(null, "2026-07-02")).toBe(1);
  });

  it("resuelve urgencia relativa al día actual", () => {
    const now = new Date("2026-07-20T12:00:00");
    expect(todayIso(now)).toBe("2026-07-20");
    expect(resolveDeliveryUrgency("2026-07-19", now)).toBe("vencido");
    expect(resolveDeliveryUrgency("2026-07-20", now)).toBe("hoy");
    expect(resolveDeliveryUrgency("2026-07-22", now)).toBe("proximo");
    expect(resolveDeliveryUrgency("2026-07-30", now)).toBe("ok");
    expect(resolveDeliveryUrgency(null, now)).toBe("sin_fecha");
  });

  it("ordena dejando sin fecha al final", () => {
    const sorted = sortByDeliveryDateNearest([
      { id: "b", deliveryDate: null },
      { id: "c", deliveryDate: "2026-07-03" },
      { id: "a", deliveryDate: "2026-07-01" },
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["a", "c", "b"]);
  });
});
