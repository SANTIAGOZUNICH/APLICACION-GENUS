import { describe, expect, it } from "vitest";
import {
  classifyOaDuplicate,
  fieldCompletenessScore,
  groupOaByLotProduct,
  normalizeForDuplicateMatch,
  pickKeeper,
  type OaDuplicateCandidate,
} from "./oa-duplicate-audit";

function candidate(overrides: Partial<OaDuplicateCandidate>): OaDuplicateCandidate {
  return {
    orderNumber: "OA-2026-1",
    status: "BORRADOR",
    client: "Cliente X",
    code: "",
    lot: "G26080",
    product: "SERUM CAPIXYL",
    linkedWorkItemId: null,
    completionPercentage: 0,
    reviewedAt: null,
    completedAt: null,
    updatedAt: "2026-08-21T18:00:00.000Z",
    pedidoOps: [],
    activeWorkItemCount: 0,
    activeDeliveryCount: 0,
    hasQualityDecision: false,
    ...overrides,
  };
}

describe("normalizeForDuplicateMatch", () => {
  it("normaliza espacios y mayúsculas sin modificar el dato original", () => {
    expect(normalizeForDuplicateMatch("  serum   capixyl  ")).toBe("SERUM CAPIXYL");
    expect(normalizeForDuplicateMatch(null)).toBe("");
    expect(normalizeForDuplicateMatch(undefined)).toBe("");
  });
});

describe("groupOaByLotProduct — criterio de duplicado", () => {
  it("agrupa por lote+producto normalizados (test obligatorio #1)", () => {
    const groups = groupOaByLotProduct([
      { lot: "g26080", product: "serum capixyl" },
      { lot: "G26080", product: "SERUM CAPIXYL"  },
    ]);
    expect(groups.size).toBe(1);
    expect([...groups.values()][0]).toHaveLength(2);
  });

  it("mismo producto pero lote distinto NO es duplicado (test obligatorio #4)", () => {
    const groups = groupOaByLotProduct([
      { lot: "G26080", product: "SERUM CAPIXYL" },
      { lot: "G26099", product: "SERUM CAPIXYL" },
    ]);
    // Dos grupos separados (uno por lote) — ninguno con más de 1 OA, o sea
    // sin duplicado real detectado.
    expect(groups.size).toBe(2);
    for (const list of groups.values()) expect(list).toHaveLength(1);
  });

  it("mismo lote pero producto distinto NO es duplicado (test obligatorio #5)", () => {
    const groups = groupOaByLotProduct([
      { lot: "G26080", product: "SERUM CAPIXYL" },
      { lot: "G26080", product: "CREMA FACIAL" },
    ]);
    expect(groups.size).toBe(2);
    for (const list of groups.values()) expect(list).toHaveLength(1);
  });

  it("dos OA con lote vacío NO agrupan aunque compartan producto (bug real corregido en la corrida sobre Production)", () => {
    const groups = groupOaByLotProduct([
      { lot: "", product: "AFTER SHAVE GEL 1LT" },
      { lot: "", product: "AFTER SHAVE GEL 1LT" },
    ]);
    expect(groups.size).toBe(0);
  });
});

describe("classifyOaDuplicate — Caso A/B/C", () => {
  it("Caso A: una COMPLETA + una INCOMPLETA sin relaciones propias → ELIMINAR_SEGURO (test obligatorio #1)", () => {
    const keeper = candidate({
      orderNumber: "OA-2026-26301",
      status: "COMPLETA_CON_PENDIENTES",
      linkedWorkItemId: "wi-1",
      activeWorkItemCount: 1,
      pedidoOps: ["26301"],
    });
    const cand = candidate({ orderNumber: "OA-2026-000108", status: "BORRADOR" });
    const result = classifyOaDuplicate(keeper, cand);
    expect(result.classification).toBe("ELIMINAR_SEGURO");
    expect(result.reason).toMatch(/Caso A/);
  });

  it("Caso B: dos OA COMPLETA → nunca borra ninguna, CONFLICTO (test obligatorio #2)", () => {
    const keeper = candidate({ orderNumber: "OA-1", status: "COMPLETA" });
    const cand = candidate({ orderNumber: "OA-2", status: "COMPLETA" });
    const result = classifyOaDuplicate(keeper, cand);
    expect(result.classification).toBe("CONFLICTO");
    expect(result.reason).toMatch(/Caso B/);
  });

  it("Caso C: dos incompletas con diferencia ambigua → CONFLICTO, no decide (test obligatorio #3 / ejemplo real G26080)", () => {
    const keeper = candidate({
      orderNumber: "OA-2026-000009",
      status: "BORRADOR",
      code: "C1",
      header: { vto: "2027-01-01", analisis: "ok" },
    });
    const cand = candidate({
      orderNumber: "OA-2026-000015",
      status: "BORRADOR",
      code: "C1",
      envasado: { fechaInicio: "2026-08-01" },
    });
    const result = classifyOaDuplicate(keeper, cand);
    expect(result.classification).toBe("CONFLICTO");
    expect(result.reason).toMatch(/Caso C/);
  });

  it("Caso C: diferencia inequívoca (candidata prácticamente vacía) → ELIMINAR_SEGURO", () => {
    const keeper = candidate({
      orderNumber: "OA-1",
      status: "BORRADOR",
      client: "CLIENTE",
      code: "C1",
      header: { vto: "2027-01-01", analisis: "ok", aprobo: "QC" },
      envasado: { fechaInicio: "2026-08-01", fechaTerminacion: "2026-08-02" },
      rendimientos: { produccionTeoricaUnidades: 1000, cantidadUnidades: 980 },
    });
    const cand = candidate({ orderNumber: "OA-2", status: "BORRADOR", client: "", code: "" });
    const result = classifyOaDuplicate(keeper, cand);
    expect(result.classification).toBe("ELIMINAR_SEGURO");
  });

  it("cliente distinto entre keeper y candidata → CONFLICTO aunque compartan lote+producto", () => {
    const keeper = candidate({ orderNumber: "OA-1", status: "COMPLETA", client: "CLIENTE A" });
    const cand = candidate({ orderNumber: "OA-2", status: "BORRADOR", client: "CLIENTE B" });
    const result = classifyOaDuplicate(keeper, cand);
    expect(result.classification).toBe("CONFLICTO");
    expect(result.reason).toMatch(/control de seguridad/);
  });

  it("candidata con relaciones activas que el keeper no tiene → CONFLICTO, nunca se borra a ciegas", () => {
    const keeper = candidate({ orderNumber: "OA-1", status: "COMPLETA", activeWorkItemCount: 0 });
    const cand = candidate({ orderNumber: "OA-2", status: "BORRADOR", activeWorkItemCount: 1 });
    const result = classifyOaDuplicate(keeper, cand);
    expect(result.classification).toBe("CONFLICTO");
    expect(result.reason).toMatch(/relaciones activas/);
  });
});

describe("pickKeeper", () => {
  it("elige la OA COMPLETA por sobre la BORRADOR", () => {
    const a = candidate({ orderNumber: "OA-1", status: "BORRADOR" });
    const b = candidate({ orderNumber: "OA-2", status: "COMPLETA" });
    expect(pickKeeper([a, b]).orderNumber).toBe("OA-2");
  });
});

describe("fieldCompletenessScore", () => {
  it("una OA con más campos reales puntúa más alto", () => {
    const empty = candidate({});
    const full = candidate({
      client: "C",
      code: "C1",
      linkedWorkItemId: "wi-1",
      header: { vto: "x", analisis: "x", aprobo: "x", fechaEmision: "x" },
      envasado: { fechaInicio: "x", fechaTerminacion: "x", operarios: "x" },
      rendimientos: { produccionTeoricaUnidades: 1, cantidadUnidades: 1, unidadesAceptadas: 1 },
      completionPercentage: 100,
      reviewedAt: "x",
      completedAt: "x",
    });
    expect(fieldCompletenessScore(full)).toBeGreaterThan(fieldCompletenessScore(empty));
  });
});
