import { describe, expect, it } from "vitest";
import { canManageFormulas, FORMULA_ADMIN_DENIED_MESSAGE } from "@/lib/formulas/formula-admin-rbac";

describe("formula-admin-rbac", () => {
  it("permite CALIDAD, PRODUCCION, MATERIA_PRIMA", () => {
    expect(canManageFormulas("CALIDAD")).toBe(true);
    expect(canManageFormulas("PRODUCCION")).toBe(true);
    expect(canManageFormulas("MATERIA_PRIMA")).toBe(true);
    expect(canManageFormulas("DIRECCION")).toBe(true);
  });

  it("niega sectores operativos de piso", () => {
    expect(canManageFormulas("ELABORACION")).toBe(false);
    expect(canManageFormulas("ENVASADO_MASIVO")).toBe(false);
  });

  it("expone mensaje de denegación", () => {
    expect(FORMULA_ADMIN_DENIED_MESSAGE).toMatch(/Calidad/i);
  });
});
