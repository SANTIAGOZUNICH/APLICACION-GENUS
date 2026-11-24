import { describe, expect, it } from "vitest";
import { INSUMO_EXPORT_HEADERS, aggregateRetiros, arDayKey, filterRetiros, isDayKey, presetRange, retirosToRows, weekStart } from "./insumos-reports";
import type { Retiro } from "./types";

let seq = 0;
function R(p: Partial<Omit<Retiro, "lines">> & { at: string; lines: Array<[string, number]> }): Retiro {
  seq += 1;
  const { at, lines, ...rest } = p;
  return {
    id: `r${seq}`,
    sector: "ENVASADO_MASIVO",
    responsableId: "envasado-masivo-gabo",
    responsableName: "GABO",
    registradoPorEmail: "u@x.com",
    registradoPorName: "Usuario",
    registradoPorSector: "ENVASADO_MASIVO",
    status: "ACTIVO",
    anuladoAt: null,
    anuladoBy: null,
    anuladoMotivo: null,
    createdAt: at,
    updatedAt: at,
    lines: lines.map(([insumoId, cantidad]) => ({ insumoId, insumoName: insumoId.toUpperCase(), cantidad })),
    ...rest,
  };
}

describe("fechas en hora de Buenos Aires", () => {
  it("23:30 de Buenos Aires sigue siendo el mismo día aunque en UTC ya sea el siguiente", () => {
    expect(arDayKey("2026-03-10T02:30:00Z")).toBe("2026-03-09");
    expect(arDayKey("2026-03-10T03:00:00Z")).toBe("2026-03-10");
  });
  it("validación de AAAA-MM-DD", () => {
    expect(isDayKey("2026-02-28")).toBe(true);
    expect(isDayKey("2026-02-30")).toBe(false);
    expect(isDayKey("28/02/2026")).toBe(false);
  });
  it("la semana empieza el lunes", () => {
    expect(weekStart("2026-03-11")).toBe("2026-03-09"); // miércoles
    expect(weekStart("2026-03-15")).toBe("2026-03-09"); // domingo
    expect(weekStart("2026-03-09")).toBe("2026-03-09");
  });
  it("atajos Hoy / Esta semana / Este mes", () => {
    const now = new Date("2026-03-11T15:00:00Z");
    expect(presetRange("hoy", now)).toEqual({ from: "2026-03-11", to: "2026-03-11" });
    expect(presetRange("semana", now)).toEqual({ from: "2026-03-09", to: "2026-03-15" });
    expect(presetRange("mes", now)).toEqual({ from: "2026-03-01", to: "2026-03-31" });
    expect(presetRange("mes", new Date("2026-02-10T12:00:00Z"))).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(presetRange("mes", new Date("2026-12-31T12:00:00Z"))).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
});

const DATA: Retiro[] = [
  R({ at: "2026-03-09T13:00:00Z", lines: [["guantes", 2], ["cinta", 1]] }),
  R({ at: "2026-03-10T13:00:00Z", lines: [["guantes", 3]], sector: "CODIFICADO", responsableId: "codificado-gabo", responsableName: "GABO" }),
  R({ at: "2026-03-10T14:00:00Z", lines: [["film", 5]], sector: "CODIFICADO", responsableId: "codificado-julian", responsableName: "JULIAN" }),
  R({ at: "2026-03-17T13:00:00Z", lines: [["guantes", 4]], status: "ANULADO", anuladoMotivo: "Duplicado" }),
  R({ at: "2026-04-02T13:00:00Z", lines: [["stretch-film", 1], ["film", 1]] }),
];

describe("filtros", () => {
  it("por rango de fechas (inclusivo), sector, responsable e insumo", () => {
    expect(filterRetiros(DATA, { from: "2026-03-10", to: "2026-03-10" })).toHaveLength(2);
    expect(filterRetiros(DATA, { sector: "CODIFICADO" })).toHaveLength(2);
    expect(filterRetiros(DATA, { responsableId: "codificado-gabo" })).toHaveLength(1);
    expect(filterRetiros(DATA, { insumoId: "film" })).toHaveLength(2);
    expect(filterRetiros(DATA, {})).toHaveLength(5); // el historial incluye anulados
  });
  it("«GABO» de otro sector no se mezcla al filtrar por id", () => {
    expect(filterRetiros(DATA, { responsableId: "envasado-masivo-gabo" }).every((r) => r.sector === "ENVASADO_MASIVO")).toBe(true);
  });
});

describe("agregaciones", () => {
  it("excluye anulados de todos los totales", () => {
    const a = aggregateRetiros(DATA);
    expect(a.retiros).toBe(4);
    expect(a.unidades).toBe(2 + 1 + 3 + 5 + 1 + 1);
    expect(a.porInsumo.find((i) => i.insumoId === "guantes")?.cantidad).toBe(5); // 2 + 3, sin el anulado de 4
  });
  it("cantidades por insumo ordenadas de mayor a menor", () => {
    const a = aggregateRetiros(DATA);
    expect(a.porInsumo.map((i) => [i.insumoId, i.cantidad])).toEqual([["film", 6], ["guantes", 5], ["cinta", 1], ["stretch-film", 1]]);
  });
  it("consumo por sector y por responsable (GABO de dos sectores = dos filas)", () => {
    const a = aggregateRetiros(DATA);
    expect(a.porSector.find((s) => s.sector === "CODIFICADO")).toMatchObject({ retiros: 2, unidades: 8 });
    expect(a.porSector.find((s) => s.sector === "ENVASADO_MASIVO")).toMatchObject({ retiros: 2, unidades: 5 });
    const gabos = a.porResponsable.filter((r) => r.responsableName === "GABO");
    expect(gabos).toHaveLength(2);
  });
  it("filtro por insumo: solo cuenta ese insumo y los retiros que lo tienen", () => {
    const a = aggregateRetiros(DATA, { insumoId: "guantes" });
    expect(a.retiros).toBe(2);
    expect(a.unidades).toBe(5);
    expect(a.porInsumo).toHaveLength(1);
  });
  it("serie diaria, semanal y mensual", () => {
    expect(aggregateRetiros(DATA, {}, "day").serie.map((p) => [p.key, p.total])).toEqual([["2026-03-09", 3], ["2026-03-10", 8], ["2026-04-02", 2]]);
    expect(aggregateRetiros(DATA, {}, "week").serie.map((p) => [p.key, p.total])).toEqual([["2026-03-09", 11], ["2026-03-30", 2]]);
    expect(aggregateRetiros(DATA, {}, "month").serie.map((p) => [p.key, p.total])).toEqual([["2026-03", 11], ["2026-04", 2]]);
  });
  it("sin datos devuelve ceros", () => {
    expect(aggregateRetiros([], {})).toMatchObject({ retiros: 0, unidades: 0, serie: [] });
  });
});

describe("exportación a Excel", () => {
  it("un renglón por insumo, respeta los filtros y marca los anulados", () => {
    const rows = retirosToRows(DATA, { from: "2026-03-01", to: "2026-03-31" });
    expect(rows).toHaveLength(2 + 1 + 1 + 1);
    expect(rows[0]).toHaveLength(INSUMO_EXPORT_HEADERS.length);
    expect(rows.some((r) => r[7] === "ANULADO" && r[8] === "Duplicado")).toBe(true);
    expect(retirosToRows(DATA, { insumoId: "film" }).every((r) => r[4] === "FILM")).toBe(true);
    expect(retirosToRows(DATA, { sector: "CODIFICADO" }).map((r) => r[2])).toEqual(["Codificado", "Codificado"]);
  });
});
