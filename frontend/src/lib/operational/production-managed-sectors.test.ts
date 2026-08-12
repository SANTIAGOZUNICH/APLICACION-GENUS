import { describe, expect, it } from "vitest";
import {
  isProductionManagedSector,
  PRODUCTION_MANAGED_SECTORS,
} from "./production-managed-sectors";

describe("PRODUCTION_MANAGED_SECTORS — única definición central", () => {
  it("incluye los 4 sectores que Producción gestiona, incluido CODIFICADO", () => {
    expect(PRODUCTION_MANAGED_SECTORS).toEqual([
      "ELABORACION",
      "ENVASADO_MASIVO",
      "ENVASADO_PREMIUM",
      "CODIFICADO",
    ]);
  });

  it("isProductionManagedSector reconoce los 4 sectores y rechaza el resto", () => {
    for (const s of PRODUCTION_MANAGED_SECTORS) {
      expect(isProductionManagedSector(s)).toBe(true);
    }
    expect(isProductionManagedSector("CALIDAD")).toBe(false);
    expect(isProductionManagedSector("PRODUCCION")).toBe(false);
    expect(isProductionManagedSector(null)).toBe(false);
    expect(isProductionManagedSector(undefined)).toBe(false);
  });
});
