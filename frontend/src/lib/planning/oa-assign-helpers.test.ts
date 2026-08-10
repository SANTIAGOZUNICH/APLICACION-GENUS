import { describe, expect, it } from "vitest";
import {
  compareCompatField,
  evaluateOaCompatibility,
  formatOaCompatibilityMessage,
  isPackagingOaSector,
  isValidOaOrderNumber,
  normalizeOaOrderNumber,
  parseOaOrderNumber,
} from "@/lib/planning/oa-assign-helpers";
import { PlanningOaCompatibilityError } from "@/lib/planning/types";

describe("OA assign helpers — normalización y compatibilidad", () => {
  it("15) normaliza espacios y mayúsculas", () => {
    expect(normalizeOaOrderNumber(" oa-2026-000145 ")).toBe("OA-2026-000145");
    expect(normalizeOaOrderNumber("OA 2026 000145")).toBe("OA2026000145");
    expect(isValidOaOrderNumber(normalizeOaOrderNumber(" oa-2026-000145 "))).toBe(
      true
    );
  });

  it("4) conserva el número exacto ingresado (forma canónica)", () => {
    const n = normalizeOaOrderNumber("OA-2026-000145");
    expect(n).toBe("OA-2026-000145");
    expect(parseOaOrderNumber(n)).toEqual({ year: 2026, seq: 145 });
  });

  it("rechaza formato inválido", () => {
    expect(isValidOaOrderNumber("OE-2026-000001")).toBe(false);
    expect(isValidOaOrderNumber("OA-26-1")).toBe(false);
    expect(isValidOaOrderNumber("")).toBe(false);
  });

  it("sectores alcanzados", () => {
    expect(isPackagingOaSector("ENVASADO_MASIVO")).toBe(true);
    expect(isPackagingOaSector("ENVASADO_PREMIUM")).toBe(true);
    expect(isPackagingOaSector("CODIFICADO")).toBe(true);
    expect(isPackagingOaSector("ELABORACION")).toBe(false);
    expect(isPackagingOaSector("CALIDAD")).toBe(false);
    expect(isPackagingOaSector("DEPOSITO")).toBe(false);
  });

  it("8) detecta datos incompatibles con OA existente", () => {
    const result = evaluateOaCompatibility(
      {
        product: "Crema A",
        client: "Cliente X",
        lot: "L-111",
        vto: "2027-01-01",
        code: "C1",
      },
      {
        product: "Crema A",
        client: "Cliente X",
        lot: "L-222",
        vto: "2027-01-01",
        code: "",
      }
    );
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]?.field).toBe("lot");
    expect(
      formatOaCompatibilityMessage("OA-2026-000145", result.mismatches)
    ).toContain("OA-2026-000145");
    expect(
      formatOaCompatibilityMessage("OA-2026-000145", result.mismatches)
    ).toMatch(/lote/i);
  });

  it("5/6) rellena solo campos vacíos sin sobrescribir", () => {
    const result = evaluateOaCompatibility(
      {
        product: "Crema A",
        client: "",
        lot: "L-1",
        vto: "",
        code: "",
      },
      {
        product: "Otro nombre",
        client: "Cliente Y",
        lot: "L-9",
        vto: "2028-01-01",
        code: "PX",
      }
    );
    expect(result.mismatches.map((m) => m.field).sort()).toEqual([
      "lot",
      "product",
    ]);
    expect(result.fills).toEqual({
      client: "Cliente Y",
      vto: "2028-01-01",
      code: "PX",
    });
  });

  it("compareCompatField: igual / vacío / mismatch", () => {
    expect(compareCompatField("", "A")).toBe("fill_empty");
    expect(compareCompatField("A", "")).toBe("ok");
    expect(compareCompatField("a", "A")).toBe("ok");
    expect(compareCompatField("A", "B")).toBe("mismatch");
  });

  it("PlanningOaCompatibilityError expone canForce", () => {
    const err = new PlanningOaCompatibilityError("conflicto", {
      orderNumber: "OA-2026-000001",
      orderId: "id-1",
      mismatches: [{ field: "lot", existing: "L1", incoming: "L2" }],
      canForce: true,
    });
    expect(err.code).toBe("OA_DATA_MISMATCH");
    expect(err.status).toBe(409);
    expect(err.details.canForce).toBe(true);
  });
});

describe("OA assign — contrato de casos de sector", () => {
  it("1–3) auto-create aplica a Masivo, Premium y Codificado", () => {
    for (const sector of [
      "ENVASADO_MASIVO",
      "ENVASADO_PREMIUM",
      "CODIFICADO",
    ] as const) {
      expect(isPackagingOaSector(sector)).toBe(true);
      const num = normalizeOaOrderNumber(` oa-2026-0001${sector.length} `);
      expect(isValidOaOrderNumber(num)).toBe(true);
    }
  });

  it("no aplica auto-create a Elaboración (helper de alcance)", () => {
    expect(isPackagingOaSector("ELABORACION")).toBe(false);
  });
});
