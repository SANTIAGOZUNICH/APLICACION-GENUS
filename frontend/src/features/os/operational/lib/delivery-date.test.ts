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

  /**
   * AUDIT_EXCEL_VTO_BUG: mm/yy (año de 2 dígitos) es el formato real más
   * usado para VTO en GENUS ("08-28", "07/29") y no se reconocía — un VTO
   * válido se perdía en silencio al pegar desde Excel. Mismo criterio de
   * siglo que src/lib/smart-paste/normalize.ts (GENUS opera 2020-2069).
   */
  it("parsea mm/yy con año de 2 dígitos (formato real de VTO en Asignación de Lotes/MP)", () => {
    expect(parseFlexibleDate("08-28")).toBe("2028-08-31");
    expect(parseFlexibleDate("07/29")).toBe("2029-07-31");
    expect(parseFlexibleDate("1/30")).toBe("2030-01-31");
  });

  it("mm/yy con mes inválido no inventa una fecha", () => {
    expect(parseFlexibleDate("13/28")).toBeNull();
    expect(parseFlexibleDate("00/28")).toBeNull();
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
