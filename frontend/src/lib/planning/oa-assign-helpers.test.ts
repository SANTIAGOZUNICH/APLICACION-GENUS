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

describe("OA assign — regla 1 trabajo = 1 OA", () => {
  it("normaliza y conserva el número exacto", () => {
    expect(normalizeOaOrderNumber(" oa-2026-000145 ")).toBe("OA-2026-000145");
    expect(parseOaOrderNumber("OA-2026-000145")).toEqual({ year: 2026, seq: 145 });
    expect(isValidOaOrderNumber("OA-2026-000145")).toBe(true);
  });

  it("sectores alcanzados vs fuera de alcance", () => {
    expect(isPackagingOaSector("ENVASADO_MASIVO")).toBe(true);
    expect(isPackagingOaSector("ENVASADO_PREMIUM")).toBe(true);
    expect(isPackagingOaSector("CODIFICADO")).toBe(true);
    expect(isPackagingOaSector("ELABORACION")).toBe(false);
  });

  it("detecta incompatibilidad de lote/producto", () => {
    const r = evaluateOaCompatibility(
      { product: "A", client: "X", lot: "L1", vto: "", code: "" },
      { product: "A", client: "X", lot: "L2", vto: "2027-01-01", code: "C1" }
    );
    expect(r.mismatches.map((m) => m.field)).toEqual(["lot"]);
    expect(r.fills).toEqual({ vto: "2027-01-01", code: "C1" });
    expect(formatOaCompatibilityMessage("OA-2026-000145", r.mismatches)).toMatch(/lote/i);
  });

  it("compareCompatField cubre vacío / igual / mismatch", () => {
    expect(compareCompatField("", "A")).toBe("fill_empty");
    expect(compareCompatField("a", "A")).toBe("ok");
    expect(compareCompatField("A", "B")).toBe("mismatch");
  });

  it("PlanningOaCompatibilityError permite forzar", () => {
    const err = new PlanningOaCompatibilityError("conflicto", {
      orderNumber: "OA-2026-000001",
      orderId: "id-1",
      mismatches: [{ field: "lot", existing: "L1", incoming: "L2" }],
      canForce: true,
    });
    expect(err.code).toBe("OA_DATA_MISMATCH");
    expect(err.details.canForce).toBe(true);
  });
});
