import { describe, expect, it } from "vitest";
import { NOT_APPLICABLE_TO_PLANT, plantHolidayOn, plantHolidaysBetween } from "./holiday-calendar";

describe("calendario de feriados de la planta (PBA)", () => {
  it("09/11/2026 es feriado nacional extraordinario (Decreto 1103/2026)", () => {
    expect(plantHolidayOn("2026-11-09")).toMatchObject({ scope: "nacional" });
    expect(plantHolidayOn("2026-11-09")!.source).toMatch(/1103\/2026/);
  });
  it("10/11/2026 (CABA/Córdoba) NO es feriado de PBA", () => expect(plantHolidayOn("2026-11-10")).toBeNull());
  it("11/11/2026 es feriado provincial de Buenos Aires", () => expect(plantHolidayOn("2026-11-11")).toMatchObject({ scope: "provincial", jurisdiction: "Provincia de Buenos Aires" }));
  it("23/11/2026 es feriado nacional (Soberanía Nacional trasladado)", () => expect(plantHolidayOn("2026-11-23")).toMatchObject({ scope: "nacional", name: "Día de la Soberanía Nacional" }));
  it("07/12/2026 (no laborable turístico) NO se marca", () => expect(plantHolidayOn("2026-12-07")).toBeNull());
  it("08/12 y 25/12/2026 son feriados nacionales", () => {
    expect(plantHolidayOn("2026-12-08")).toMatchObject({ scope: "nacional", name: "Inmaculada Concepción de María" });
    expect(plantHolidayOn("2026-12-25")).toMatchObject({ scope: "nacional", name: "Navidad" });
  });
  it("ninguna fecha «no aplicable» se marca", () => {
    for (const d of Object.keys(NOT_APPLICABLE_TO_PLANT)) expect(plantHolidayOn(d)).toBeNull();
  });
  it("funciona en otros meses y años (inamovibles, trasladables, Pascua) y no marca días no laborables", () => {
    expect(plantHolidayOn("2027-01-01")?.name).toBe("Año Nuevo");
    expect(plantHolidayOn("2026-05-25")?.scope).toBe("nacional");
    expect(plantHolidayOn("2026-04-03")?.name).toBe("Viernes Santo");
    expect(plantHolidayOn("2026-04-02")?.name).toMatch(/Malvinas/);
    expect(plantHolidayOn("2026-04-02")).not.toBeNull();
    expect(plantHolidayOn("2026-06-15")?.name).toMatch(/Güemes/); // 17/06 (miércoles) → lunes 15
    expect(plantHolidayOn("2026-06-17")).toBeNull();
    expect(plantHolidayOn("2026-03-23")).toBeNull(); // día no laborable puente
    expect(plantHolidayOn("2025-12-25")?.name).toBe("Navidad");
  });
  it("rango: cambiar de mes/año devuelve los feriados de ese rango", () => {
    expect([...plantHolidaysBetween("2026-11-01", "2026-12-31").keys()]).toEqual(["2026-11-09", "2026-11-11", "2026-11-23", "2026-12-08", "2026-12-25"]);
    expect([...plantHolidaysBetween("2026-12-28", "2027-01-03").keys()]).toEqual(["2027-01-01"]);
  });
});
