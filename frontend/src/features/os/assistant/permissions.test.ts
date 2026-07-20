import { describe, expect, it } from "vitest";
import { canCreamyAccessDomain } from "./permissions";

describe("Creamy assistant permissions", () => {
  it("permite a Producción consultar todos los dominios", () => {
    for (const domain of ["works", "lots", "rawMaterials", "orders_oe", "orders_oa", "quality", "help"] as const) {
      expect(canCreamyAccessDomain("PRODUCCION", domain)).toBe(true);
    }
  });

  it("aplica permisos razonables por sector", () => {
    expect(canCreamyAccessDomain("CALIDAD", "works")).toBe(true);
    expect(canCreamyAccessDomain("CALIDAD", "quality")).toBe(true);
    expect(canCreamyAccessDomain("CALIDAD", "rawMaterials")).toBe(false);

    expect(canCreamyAccessDomain("ELABORACION", "works")).toBe(true);
    expect(canCreamyAccessDomain("ELABORACION", "orders_oe")).toBe(true);
    expect(canCreamyAccessDomain("ELABORACION", "orders_oa")).toBe(false);
    expect(canCreamyAccessDomain("ELABORACION", "rawMaterials")).toBe(false);

    expect(canCreamyAccessDomain("ENVASADO_MASIVO", "orders_oa")).toBe(true);
    expect(canCreamyAccessDomain("ENVASADO_MASIVO", "orders_oe")).toBe(false);

    expect(canCreamyAccessDomain("MATERIA_PRIMA", "rawMaterials")).toBe(true);
    expect(canCreamyAccessDomain("MATERIA_PRIMA", "orders_oe")).toBe(true);
    expect(canCreamyAccessDomain("MATERIA_PRIMA", "lots")).toBe(false);

    expect(canCreamyAccessDomain("CODIFICADO", "lots")).toBe(true);
    expect(canCreamyAccessDomain("CODIFICADO", "works")).toBe(false);
  });

  it("deniega sectores faltantes o sensibles fuera de matriz", () => {
    expect(canCreamyAccessDomain(null, "works")).toBe(false);
    expect(canCreamyAccessDomain(undefined, "quality")).toBe(false);
    expect(canCreamyAccessDomain("DIRECCION", "rawMaterials")).toBe(false);
    expect(canCreamyAccessDomain("COMERCIAL", "orders_oe")).toBe(false);
  });
});
