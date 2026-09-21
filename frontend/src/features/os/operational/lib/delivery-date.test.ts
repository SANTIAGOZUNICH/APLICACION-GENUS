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

  /**
   * Hotfix (reproducción real, hoja SEPTIEMBRE 2026 de Asignación de
   * Lotes): dd/mm/aa con día explícito y año de 2 dígitos ("1/9/28",
   * "1/10/28") es el formato real de VTO en esa planilla y no se
   * reconocía — el parser solo tenía dd/mm/AAAA (4 dígitos) o mm/aa (sin
   * día). Causaba que la fila entera se rechazara como "VTO inválido" y
   * se perdiera la asignación completa, no solo el VTO.
   */
  it("parsea dd/mm/aa con año de 2 dígitos (VTO real de Asignación de Lotes, hoja SEPTIEMBRE)", () => {
    expect(parseFlexibleDate("1/9/28")).toBe("2028-09-01");
    expect(parseFlexibleDate("1/10/28")).toBe("2028-10-01");
    expect(parseFlexibleDate("01/09/2028")).toBe("2028-09-01");
    expect(parseFlexibleDate("09/2028")).toBe("2028-09-30");
    expect(parseFlexibleDate("09-28")).toBe("2028-09-30");
  });

  it("dd/mm/aa con mes o día inválido no inventa una fecha", () => {
    expect(parseFlexibleDate("1/13/28")).toBeNull();
    expect(parseFlexibleDate("32/1/28")).toBeNull();
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
