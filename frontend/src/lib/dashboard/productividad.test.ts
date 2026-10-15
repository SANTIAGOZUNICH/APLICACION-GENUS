import { describe, expect, it } from "vitest";
import { computeProductividad, responsibleGroupKey } from "./productividad";
import { responsiblesScopeFor } from "./permissions";
import { SIN_RESPONSABLE_KEY, type DashboardFilters, type DashboardMetricRow } from "./types";

const F = (over: Partial<DashboardFilters> = {}): DashboardFilters => ({ year: 2026, month: null, sector: "ALL", client: null, ...over });
const m = (o: Partial<DashboardMetricRow> & { who?: string }): DashboardMetricRow => {
  const { who: whoOpt, ...rest } = o;
  const who = whoOpt ?? "Ana Pérez";
  return {
    sector: "ENVASADO_MASIVO",
    metricDate: "2026-03-10",
    units: 100,
    responsibleDisplay: who,
    responsibleKey: who.trim().toLowerCase().replace(/\s+/g, " "),
    ...rest,
  };
};
const ALL = { responsiblesScope: "all" as const };

describe("KPIs de Métricas (total, Masivo, Premium, %)", () => {
  it("TOTAL = Masivo + Premium; % = parte / total × 100", () => {
    const p = computeProductividad(
      [m({ units: 600 }), m({ units: 100, metricDate: "2026-03-11" }), m({ sector: "ENVASADO_PREMIUM", units: 300, who: "Luis" })],
      F(),
      ALL
    );
    expect(p.kpis.masivo.value).toBe(700);
    expect(p.kpis.premium.value).toBe(300);
    expect(p.kpis.total.value).toBe(1000);
    expect(p.kpis.pctMasivo.value).toBe(70);
    expect(p.kpis.pctPremium.value).toBe(30);
    expect(p.kpis.total.accuracy).toBe("exacto");
    expect(p.kpis.total.dateBasis).toBe("metrica");
  });

  it("sin registros: todo «Sin datos suficientes» (sin división por cero)", () => {
    const p = computeProductividad([], F(), ALL);
    for (const k of Object.values(p.kpis)) {
      expect(k.value).toBeNull();
      expect(k.accuracy).toBe("sin_datos");
      expect(k.reason).toBeTruthy();
    }
    expect(p.recordCount).toBe(0);
    expect(p.monthly).toHaveLength(12);
    expect(p.monthly.every((x) => x.total === 0 && x.trend === null)).toBe(true);
  });

  it("excluye eliminados (soft delete), fechas inválidas y unidades no numéricas/negativas", () => {
    const p = computeProductividad(
      [
        m({ units: 100 }),
        m({ units: 999, deletedAt: "2026-04-01T00:00:00.000Z" }),
        m({ units: 999, metricDate: "basura" }),
        m({ units: Number.NaN }),
        m({ units: -5 }),
      ],
      F(),
      ALL
    );
    expect(p.kpis.total.value).toBe(100);
    expect(p.recordCount).toBe(1);
  });

  it("filtro de período: año y mes", () => {
    const rows = [m({ units: 10, metricDate: "2025-12-31" }), m({ units: 20, metricDate: "2026-01-05" }), m({ units: 30, metricDate: "2026-03-05" })];
    expect(computeProductividad(rows, F({ year: 2025 }), ALL).kpis.total.value).toBe(10);
    expect(computeProductividad(rows, F(), ALL).kpis.total.value).toBe(50);
    const mar = computeProductividad(rows, F({ month: 3 }), ALL);
    expect(mar.kpis.total.value).toBe(30);
    expect(mar.periodLabel).toBe("Marzo 2026");
    // la tendencia sigue siendo del año completo
    expect(mar.monthly[0].total).toBe(20);
  });

  it("filtro de sector: solo ese sector; el otro queda «fuera del filtro»", () => {
    const rows = [m({ units: 600 }), m({ sector: "ENVASADO_PREMIUM", units: 400, who: "Luis" })];
    const p = computeProductividad(rows, F({ sector: "ENVASADO_PREMIUM" }), ALL);
    expect(p.kpis.total.value).toBe(400);
    expect(p.kpis.premium.value).toBe(400);
    expect(p.kpis.pctPremium.value).toBe(100);
    expect(p.kpis.masivo.value).toBeNull();
    expect(p.kpis.masivo.reason).toMatch(/filtro de sector/);
    expect(p.monthly[2].masivo).toBe(0);
  });
});

describe("promedio diario de envasado", () => {
  it("divide por fechas DISTINTAS: Masivo + Premium el mismo día cuenta 1 día", () => {
    const p = computeProductividad(
      [
        m({ units: 300, metricDate: "2026-03-10" }),
        m({ sector: "ENVASADO_PREMIUM", units: 100, metricDate: "2026-03-10", who: "Luis" }),
        m({ units: 200, metricDate: "2026-03-12" }),
      ],
      F(),
      ALL
    );
    expect(p.activeDays).toBe(2);
    expect(p.kpis.dailyAverage.value).toBe(300); // 600 / 2
    expect(p.kpis.dailyAverage.unit).toBe("decimal");
  });

  it("no usa días calendario ni hábiles (un sábado con registro cuenta)", () => {
    const p = computeProductividad([m({ units: 90, metricDate: "2026-03-07" }), m({ units: 30, metricDate: "2026-03-31" })], F({ month: 3 }), ALL);
    expect(p.activeDays).toBe(2);
    expect(p.kpis.dailyAverage.value).toBe(60);
  });

  it("sin registros: sin datos suficientes (no 0)", () => {
    expect(computeProductividad([], F(), ALL).kpis.dailyAverage.value).toBeNull();
  });

  it("con filtro de sector solo cuenta días y unidades de ese sector", () => {
    const rows = [
      m({ units: 300, metricDate: "2026-03-10" }),
      m({ sector: "ENVASADO_PREMIUM", units: 100, metricDate: "2026-03-11", who: "Luis" }),
      m({ sector: "ENVASADO_PREMIUM", units: 50, metricDate: "2026-03-12", who: "Luis" }),
    ];
    const p = computeProductividad(rows, F({ sector: "ENVASADO_PREMIUM" }), ALL);
    expect(p.kpis.dailyAverage.value).toBe(75);
  });

  it("redondea a 1 decimal", () => {
    const rows = [m({ units: 100, metricDate: "2026-03-01" }), m({ units: 0, metricDate: "2026-03-02" }), m({ units: 0, metricDate: "2026-03-03" })];
    expect(computeProductividad(rows, F(), ALL).kpis.dailyAverage.value).toBe(33.3);
  });
});

describe("tendencia mensual: variación, SUBE/BAJA y mes más productivo", () => {
  const rows = [
    m({ units: 100, metricDate: "2026-01-10" }),
    m({ units: 150, metricDate: "2026-02-10" }),
    m({ units: 150, metricDate: "2026-03-10" }),
    m({ units: 60, metricDate: "2026-04-10" }),
    // mayo sin registros; junio no se compara con mayo
    m({ units: 80, metricDate: "2026-06-10" }),
  ];
  const p = computeProductividad(rows, F(), ALL);
  it("variación vs mes anterior y tendencia", () => {
    expect(p.monthly[0].variationPct).toBeNull(); // enero: sin mes anterior
    expect(p.monthly[0].trend).toBeNull();
    expect(p.monthly[1]).toMatchObject({ variationPct: 50, trend: "SUBE" });
    expect(p.monthly[2]).toMatchObject({ variationPct: 0, trend: "IGUAL" });
    expect(p.monthly[3]).toMatchObject({ variationPct: -60, trend: "BAJA" });
    expect(p.monthly[4]).toMatchObject({ records: 0, variationPct: null, trend: null });
    expect(p.monthly[5]).toMatchObject({ variationPct: null, trend: null });
  });
  it("mes más productivo: el de más unidades (empate: el más temprano) e independiente del filtro de mes", () => {
    expect(p.kpis.bestMonth.value).toBe(150);
    expect(p.kpis.bestMonth.valueLabel).toBe("Febrero");
    const apr = computeProductividad(rows, F({ month: 4 }), ALL);
    expect(apr.kpis.bestMonth.valueLabel).toBe("Febrero");
    expect(apr.kpis.total.value).toBe(60);
  });
});

describe("ranking de responsables", () => {
  const rows = [
    m({ who: "Ana Pérez", units: 500 }),
    m({ who: "  ana   PÉREZ ", units: 100, metricDate: "2026-03-11" }), // mismo responsable (normalización de Métricas)
    m({ who: "Luis Gómez", units: 300, sector: "ENVASADO_PREMIUM" }),
    m({ who: "Beto Ruiz", units: 100 }),
    m({ who: "Cora", units: 50 }),
  ];
  it("suma por responsable, ordena desc y calcula % de participación", () => {
    const r = computeProductividad(rows, F(), ALL).responsibles;
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.ranking.map((x) => [x.name, x.units])).toEqual([
      ["Ana Pérez", 600],
      ["Luis Gómez", 300],
      ["Beto Ruiz", 100],
      ["Cora", 50],
    ]);
    expect(r.ranking[0].share).toBe(57.1); // 600 / 1050
    expect(r.ranking[0].records).toBe(2);
    expect(r.podium.map((x) => x.name)).toEqual(["Ana Pérez", "Luis Gómez", "Beto Ruiz"]);
    expect(r.best?.name).toBe("Ana Pérez");
    expect(r.worst?.name).toBe("Cora");
    expect(r.totalUnits).toBe(1050);
  });

  it("empate: desempata por nombre, de forma estable", () => {
    const r = computeProductividad([m({ who: "Zoe", units: 10 }), m({ who: "Ana", units: 10 })], F(), ALL).responsibles;
    if (!r.available) throw new Error("debería estar disponible");
    expect(r.ranking.map((x) => x.name)).toEqual(["Ana", "Zoe"]);
  });

  it("NO une personas distintas: tildes y apellidos distintos quedan separados", () => {
    const r = computeProductividad([m({ who: "José Díaz", units: 10 }), m({ who: "Jose Diaz", units: 20 }), m({ who: "José Dias", units: 5 })], F(), ALL).responsibles;
    if (!r.available) throw new Error("x");
    expect(r.ranking).toHaveLength(3);
  });

  it("sin responsable válido: «Sin responsable» identificado, al final, fuera del podio y de mayor/menor", () => {
    const r = computeProductividad(
      [m({ who: "Ana", units: 100 }), m({ who: "", units: 900 }), m({ who: "N/A", units: 50 }), m({ who: " - ", units: 25 }), m({ who: "Sin responsable", units: 25 })],
      F(),
      ALL
    ).responsibles;
    if (!r.available) throw new Error("x");
    const last = r.ranking.at(-1);
    expect(last).toMatchObject({ key: SIN_RESPONSABLE_KEY, name: "Sin responsable", unassigned: true, units: 1000, records: 4 });
    expect(r.ranking.filter((x) => !x.unassigned).map((x) => x.name)).toEqual(["Ana"]);
    expect(r.podium.map((x) => x.name)).toEqual(["Ana"]);
    expect(r.best?.name).toBe("Ana");
    expect(r.worst).toBeNull(); // hace falta otro responsable para comparar
    expect(r.unassignedUnits).toBe(1000);
    expect(r.ranking[0].share).toBeCloseTo(9.1, 1); // Ana 100 / 1100
  });

  it("responsibleGroupKey usa la normalización de Métricas", () => {
    expect(responsibleGroupKey({ responsibleKey: "ana pérez", responsibleDisplay: "Ana Pérez" })).toBe("ana pérez");
    expect(responsibleGroupKey({ responsibleKey: "", responsibleDisplay: "  Ana   PÉREZ " })).toBe("ana pérez");
    expect(responsibleGroupKey({ responsibleKey: "", responsibleDisplay: "???" })).toBeNull();
  });

  it("respeta período y sector", () => {
    const data = [m({ who: "Ana", units: 100, metricDate: "2026-01-10" }), m({ who: "Beto", units: 70, metricDate: "2026-02-10", sector: "ENVASADO_PREMIUM" })];
    const feb = computeProductividad(data, F({ month: 2 }), ALL).responsibles;
    if (!feb.available) throw new Error("x");
    expect(feb.ranking.map((x) => x.name)).toEqual(["Beto"]);
    const masivo = computeProductividad(data, F({ sector: "ENVASADO_MASIVO" }), ALL).responsibles;
    if (!masivo.available) throw new Error("x");
    expect(masivo.ranking.map((x) => x.name)).toEqual(["Ana"]);
  });

  it("columnas por responsable en la tendencia: top N + Otros + Sin responsable, con total acumulado y %", () => {
    const names = ["A1", "A2", "A3", "A4", "A5", "A6"];
    const data = [...names.map((n, i) => m({ who: n, units: 100 - i * 10 })), m({ who: "", units: 10, metricDate: "2026-04-01" })];
    const p = computeProductividad(data, F(), ALL);
    if (!p.responsibles.available) throw new Error("x");
    expect(p.responsibles.columns.map((c) => c.name)).toEqual(["A1", "A2", "A3", "A4", "Otros", "Sin responsable"]);
    const otros = p.responsibles.columns.find((c) => c.name === "Otros");
    expect(otros?.yearUnits).toBe(60 + 50); // A5 + A6
    expect(p.monthly[2].byResponsible.a1).toBe(100);
    expect(p.monthly[3].byResponsible[SIN_RESPONSABLE_KEY]).toBe(10);
    const sum = p.responsibles.columns.reduce((s, c) => s + c.yearShare, 0);
    expect(Math.round(sum)).toBe(100);
  });
});

describe("permisos: nombres de responsables (mínimo privilegio)", () => {
  const data = [m({ who: "Ana", units: 100 }), m({ who: "Luis", units: 300, sector: "ENVASADO_PREMIUM" })];

  it("el alcance depende del sector", () => {
    expect(responsiblesScopeFor("PRODUCCION")).toBe("all");
    expect(responsiblesScopeFor("DIRECCION")).toBe("all");
    expect(responsiblesScopeFor("ENVASADO_MASIVO")).toBe("ENVASADO_MASIVO");
    expect(responsiblesScopeFor("ENVASADO_PREMIUM")).toBe("ENVASADO_PREMIUM");
    for (const s of ["ELABORACION", "CODIFICADO", "CALIDAD", "MATERIA_PRIMA", "DEPOSITO", "COMERCIAL"]) expect(responsiblesScopeFor(s)).toBeNull();
  });

  it("sin permiso de nombres: totales agregados sí, ningún nombre en el resultado", () => {
    const p = computeProductividad(data, F(), { responsiblesScope: null });
    expect(p.kpis.total.value).toBe(400);
    expect(p.responsibles).toMatchObject({ available: false });
    expect(p.monthly.every((x) => Object.keys(x.byResponsible).length === 0)).toBe(true);
    expect(JSON.stringify(p)).not.toMatch(/Ana|Luis/);
  });

  it("Envasado ve solo los responsables de su sector, pero los totales son de toda la planta", () => {
    const p = computeProductividad(data, F(), { responsiblesScope: "ENVASADO_MASIVO" });
    expect(p.kpis.total.value).toBe(400);
    expect(p.kpis.premium.value).toBe(300);
    if (!p.responsibles.available) throw new Error("x");
    expect(p.responsibles.ranking.map((r) => r.name)).toEqual(["Ana"]);
    expect(p.responsibles.ranking[0].share).toBe(100); // % sobre su alcance
    expect(JSON.stringify(p)).not.toMatch(/Luis/);
  });

  it("Envasado que filtra el OTRO sector: los nombres no están disponibles", () => {
    const p = computeProductividad(data, F({ sector: "ENVASADO_PREMIUM" }), { responsiblesScope: "ENVASADO_MASIVO" });
    expect(p.kpis.total.value).toBe(300);
    expect(p.responsibles).toMatchObject({ available: false });
    expect(JSON.stringify(p)).not.toMatch(/Luis/);
  });
});
