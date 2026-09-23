import { describe, expect, it } from "vitest";
import { computeLoteIdentityKey, computeProductIdentityKey } from "./order-identity";

describe("computeProductIdentityKey", () => {
  it("prioriza el código canónico cuando existe", () => {
    expect(computeProductIdentityKey("SERUM VITAMINA C ROSEHIP", "VIT-C")).toBe("CODE:vit c");
  });

  it("sin código, normaliza el texto libre determinísticamente", () => {
    expect(computeProductIdentityKey("SERUM  Vitamina-C", null)).toBe(
      computeProductIdentityKey("serum vitamina c", null)
    );
  });

  it("producto vacío -> null", () => {
    expect(computeProductIdentityKey("", null)).toBeNull();
    expect(computeProductIdentityKey("   ", "")).toBeNull();
  });
});

describe("computeLoteIdentityKey", () => {
  it("prioriza el id canónico de Asignación de Lotes cuando existe", () => {
    expect(computeLoteIdentityKey("al-123", "G26018")).toBe("AL:al-123");
  });

  it("sin id, normaliza el lote manual", () => {
    expect(computeLoteIdentityKey(null, "  G26018  ")).toBe("TXT:g26018");
  });

  it("sin lote (ni id ni texto) -> null (SIN_LOTE)", () => {
    expect(computeLoteIdentityKey(null, null)).toBeNull();
    expect(computeLoteIdentityKey(undefined, "")).toBeNull();
    expect(computeLoteIdentityKey("", "   ")).toBeNull();
  });

  it("lotes escritos distinto pero equivalentes normalizan igual (mismo criterio que el resto del proyecto)", () => {
    expect(computeLoteIdentityKey(null, "G-26018")).toBe(computeLoteIdentityKey(null, "g 26018"));
  });
});
