import { describe, expect, it } from "vitest";
import { canCreamyAccessDomain } from "./permissions";

describe("Creamy assistant permissions", () => {
  it("permite a Producción consultar todos los dominios", () => {
    for (const domain of [
      "works",
      "lots",
      "rawMaterials",
      "orders_oe",
      "orders_oa",
      "quality",
      "deliveries",
      "substitutions",
      "help",
    ] as const) {
      expect(canCreamyAccessDomain("PRODUCCION", domain)).toBe(true);
    }
  });

  it("aplica permisos razonables por sector", () => {
    expect(canCreamyAccessDomain("CALIDAD", "works")).toBe(true);
    expect(canCreamyAccessDomain("CALIDAD", "quality")).toBe(true);
    expect(canCreamyAccessDomain("CALIDAD", "deliveries")).toBe(true);
    expect(canCreamyAccessDomain("CALIDAD", "substitutions")).toBe(true);
    expect(canCreamyAccessDomain("CALIDAD", "rawMaterials")).toBe(false);

    // ELABORACION now has rawMaterials, lots and substitutions
    expect(canCreamyAccessDomain("ELABORACION", "works")).toBe(true);
    expect(canCreamyAccessDomain("ELABORACION", "orders_oe")).toBe(true);
    expect(canCreamyAccessDomain("ELABORACION", "orders_oa")).toBe(false);
    expect(canCreamyAccessDomain("ELABORACION", "rawMaterials")).toBe(true);
    expect(canCreamyAccessDomain("ELABORACION", "lots")).toBe(true);
    expect(canCreamyAccessDomain("ELABORACION", "substitutions")).toBe(true);

    expect(canCreamyAccessDomain("ENVASADO_MASIVO", "orders_oa")).toBe(true);
    expect(canCreamyAccessDomain("ENVASADO_MASIVO", "orders_oe")).toBe(false);

    expect(canCreamyAccessDomain("MATERIA_PRIMA", "rawMaterials")).toBe(true);
    expect(canCreamyAccessDomain("MATERIA_PRIMA", "orders_oe")).toBe(true);
    expect(canCreamyAccessDomain("MATERIA_PRIMA", "lots")).toBe(false);
    expect(canCreamyAccessDomain("MATERIA_PRIMA", "substitutions")).toBe(true);

    expect(canCreamyAccessDomain("CODIFICADO", "lots")).toBe(true);
    expect(canCreamyAccessDomain("CODIFICADO", "works")).toBe(false);

    expect(canCreamyAccessDomain("DIRECCION", "deliveries")).toBe(true);
    expect(canCreamyAccessDomain("DIRECCION", "rawMaterials")).toBe(false);
  });

  it("deniega sectores faltantes o sensibles fuera de matriz", () => {
    expect(canCreamyAccessDomain(null, "works")).toBe(false);
    expect(canCreamyAccessDomain(undefined, "quality")).toBe(false);
    expect(canCreamyAccessDomain("COMERCIAL", "orders_oe")).toBe(false);
  });

  it("substitutions domain access: only authorized sectors", () => {
    expect(canCreamyAccessDomain("PRODUCCION", "substitutions")).toBe(true);
    expect(canCreamyAccessDomain("CALIDAD", "substitutions")).toBe(true);
    expect(canCreamyAccessDomain("ELABORACION", "substitutions")).toBe(true);
    expect(canCreamyAccessDomain("MATERIA_PRIMA", "substitutions")).toBe(true);
    // Sectors without substitutions access
    expect(canCreamyAccessDomain("CODIFICADO", "substitutions")).toBe(false);
    expect(canCreamyAccessDomain("ENVASADO_MASIVO", "substitutions")).toBe(false);
    expect(canCreamyAccessDomain("ENVASADO_PREMIUM", "substitutions")).toBe(false);
    expect(canCreamyAccessDomain("DIRECCION", "substitutions")).toBe(false);
  });
});
