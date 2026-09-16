import { describe, expect, it } from "vitest";
import {
  buildMonthFilterOptions,
  detectLoteMonthInconsistency,
  filterByMonthKey,
  groupByMonth,
  resolveRecordMonth,
  SIN_MES_LABEL,
  type AsignacionLoteForGrouping,
  type LoteMonthMap,
} from "./asignacion-lotes-month-grouping";

function rec(overrides: Partial<AsignacionLoteForGrouping> & Pick<AsignacionLoteForGrouping, "id">): AsignacionLoteForGrouping {
  return { lote: "G26043", fecha: "2026-08-14", ...overrides };
}

describe("Asignación de Lotes — agrupación por mes: Test 1 (agrupación correcta por fecha)", () => {
  it("agrupa por el mes/año real de la fecha, no por el lote", () => {
    const groups = groupByMonth([
      rec({ id: "1", fecha: "2026-09-05" }),
      rec({ id: "2", fecha: "2026-09-20" }),
      rec({ id: "3", fecha: "2026-08-10" }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["SEPTIEMBRE 2026", "AGOSTO 2026"]);
    expect(groups[0]!.count).toBe(2);
    expect(groups[1]!.count).toBe(1);
  });
});

describe("Test 2: Agosto 2026 y Agosto 2025 quedan separados (punto 11 — año siempre incluido)", () => {
  it("nunca mezcla el mismo mes de años distintos", () => {
    const groups = groupByMonth([
      rec({ id: "1", fecha: "2026-08-05" }),
      rec({ id: "2", fecha: "2025-08-05" }),
    ]);
    expect(groups.map((g) => g.label).sort()).toEqual(["AGOSTO 2025", "AGOSTO 2026"]);
    expect(groups.every((g) => g.count === 1)).toBe(true);
  });
});

describe("Test 3: orden de meses correcto (más reciente primero, SIN MES al final)", () => {
  it("ordena por clave AAAA-MM descendente y deja 'sin mes' al final", () => {
    const groups = groupByMonth([
      rec({ id: "1", fecha: "2026-07-01" }),
      rec({ id: "2", fecha: "2026-09-01" }),
      rec({ id: "3", fecha: "2026-08-01" }),
      rec({ id: "4", fecha: null }),
    ]);
    expect(groups.map((g) => g.label)).toEqual([
      "SEPTIEMBRE 2026",
      "AGOSTO 2026",
      "JULIO 2026",
      SIN_MES_LABEL,
    ]);
  });
});

describe("Test 4: búsqueda global encuentra registros de cualquier mes (mes = TODOS)", () => {
  it("filterByMonthKey('') devuelve todo sin importar el mes", () => {
    const records = [rec({ id: "1", fecha: "2026-09-01" }), rec({ id: "2", fecha: "2026-01-01" })];
    expect(filterByMonthKey(records, "")).toHaveLength(2);
  });
});

describe("Test 5: filtro Agosto + búsqueda funciona combinado", () => {
  it("filterByMonthKey('2026-08') solo deja agosto 2026 — la búsqueda de texto se aplica antes/después sin conflicto", () => {
    const records = [
      rec({ id: "1", fecha: "2026-08-01", lote: "G26043" }),
      rec({ id: "2", fecha: "2026-08-02", lote: "L26069" }),
      rec({ id: "3", fecha: "2026-09-01", lote: "G26043" }),
    ];
    const soloAgosto = filterByMonthKey(records, "2026-08");
    expect(soloAgosto.map((r) => r.id)).toEqual(["1", "2"]);
    const soloAgostoConG = soloAgosto.filter((r) => r.lote.includes("G26043"));
    expect(soloAgostoConG.map((r) => r.id)).toEqual(["1"]);
  });
});

describe("Test 6: limpiar filtro vuelve a TODOS", () => {
  it("las opciones de filtro siempre incluyen 'Todos' con el total real", () => {
    const records = [rec({ id: "1", fecha: "2026-08-01" }), rec({ id: "2", fecha: "2026-09-01" })];
    const options = buildMonthFilterOptions(records);
    expect(options[0]).toEqual({ key: "", label: "Todos", count: 2 });
  });
});

describe("Test 7: un registro nuevo (Smart Paste) aparece en el mes correcto sin recarga manual", () => {
  it("groupByMonth es una función pura sobre el array actual — un registro agregado aparece en su grupo de inmediato", () => {
    const before = groupByMonth([rec({ id: "1", fecha: "2026-08-01" })]);
    expect(before[0]!.count).toBe(1);
    const after = groupByMonth([rec({ id: "1", fecha: "2026-08-01" }), rec({ id: "2", fecha: "2026-08-15" })]);
    expect(after[0]!.count).toBe(2);
  });
});

describe("Test 8 y 9: sin fecha, el lote SOLO infiere el mes si hay una regla inequívoca — hoy no la hay", () => {
  it("con el mapa vacío (estado real de GENUS OS hoy) un registro sin fecha va a SIN MES, nunca inventa uno", () => {
    const resolved = resolveRecordMonth({ fecha: null, lote: "G26043" });
    expect(resolved.source).toBe("sin_mes");
    expect(resolved.label).toBe(SIN_MES_LABEL);
    expect(resolved.key).toBeNull();
  });

  it("un lote sin ninguna letra reconocible tampoco inventa mes, incluso con un mapa cargado", () => {
    const map: LoteMonthMap = new Map([["G", { monthIndex: 7, confidence: "alta" }]]);
    const resolved = resolveRecordMonth({ fecha: null, lote: "130826" }, map);
    expect(resolved.source).toBe("sin_mes");
  });

  it("SI existiera evidencia real (mapa no vacío) el lote puede inferir el mes, pero nunca inventa el año", () => {
    const map: LoteMonthMap = new Map([["G", { monthIndex: 7, confidence: "alta" }]]);
    const resolved = resolveRecordMonth({ fecha: null, lote: "G26043" }, map);
    expect(resolved.source).toBe("lote_inferido");
    expect(resolved.key).toBeNull(); // nunca arma un grupo AAAA-MM sin año confiable
    expect(resolved.label).toContain("AGOSTO");
  });

  it("la fecha real SIEMPRE gana por sobre cualquier inferencia por lote", () => {
    const map: LoteMonthMap = new Map([["G", { monthIndex: 0, confidence: "alta" }]]); // G "diría" enero
    const resolved = resolveRecordMonth({ fecha: "2026-08-14", lote: "G26043" }, map);
    expect(resolved.source).toBe("fecha");
    expect(resolved.label).toBe("AGOSTO 2026");
  });
});

describe("Test 10: fecha/lote contradictorios -> warning, nunca bloqueo", () => {
  it("con el mapa vacío (evidencia real actual) nunca se reporta una inconsistencia inventada", () => {
    expect(detectLoteMonthInconsistency({ fecha: "2026-08-14", lote: "G26043" }, new Map())).toBeNull();
  });

  it("con una regla confirmada (hipotética), SÍ marca la inconsistencia sin bloquear nada — es solo texto informativo", () => {
    const map: LoteMonthMap = new Map([["G", { monthIndex: 0, confidence: "alta" }]]); // G "debería" ser enero
    const result = detectLoteMonthInconsistency({ fecha: "2026-08-14", lote: "G26043" }, map);
    expect(result).toEqual({ fechaLabel: "AGOSTO 2026", loteInferredLabel: "ENERO" });
  });

  it("si la fecha coincide con lo que el lote indicaría, no hay inconsistencia", () => {
    const map: LoteMonthMap = new Map([["G", { monthIndex: 7, confidence: "alta" }]]); // G = agosto
    expect(detectLoteMonthInconsistency({ fecha: "2026-08-14", lote: "G26043" }, map)).toBeNull();
  });
});

describe("Test 11: muchos meses siguen siendo una lista manejable (dinámica, nunca 12 meses fijos)", () => {
  it("solo genera opciones para los meses que realmente tienen datos", () => {
    const records = [rec({ id: "1", fecha: "2026-08-01" }), rec({ id: "2", fecha: "2026-08-02" })];
    const options = buildMonthFilterOptions(records);
    // "Todos" + un único mes real — nunca los 12 meses del año hardcodeados.
    expect(options).toHaveLength(2);
    expect(options[1]!.label).toBe("AGOSTO 2026");
  });

  it("24 meses reales generan 24 grupos ordenados, sin overflow ni pérdida de datos", () => {
    const records = Array.from({ length: 24 }, (_, i) => {
      const year = 2025 + Math.floor(i / 12);
      const month = String((i % 12) + 1).padStart(2, "0");
      return rec({ id: String(i), fecha: `${year}-${month}-01` });
    });
    const groups = groupByMonth(records);
    expect(groups).toHaveLength(24);
    expect(groups.every((g) => g.count === 1)).toBe(true);
    // Orden descendente estricto.
    const keys = groups.map((g) => g.key!);
    const sorted = [...keys].sort().reverse();
    expect(keys).toEqual(sorted);
  });
});

describe("Test 12: no afecta la importación existente ni a Smart Paste", () => {
  it("groupByMonth/filterByMonthKey son funciones puras de solo lectura — no mutan los registros de entrada", () => {
    const records = [rec({ id: "1", fecha: "2026-08-01" })];
    const snapshot = JSON.stringify(records);
    groupByMonth(records);
    filterByMonthKey(records, "2026-08");
    buildMonthFilterOptions(records);
    expect(JSON.stringify(records)).toBe(snapshot);
  });
});
