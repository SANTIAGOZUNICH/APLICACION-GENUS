import { describe, expect, it } from "vitest";
import {
  canAccessSharedWeeklyPlans,
  getAllowedPlanSectors,
  resolveRequestedPlanSectors,
} from "./weekly-plans-rbac";

describe("weekly-plans-rbac", () => {
  it("allowlists Codificado and Deposito to Masivo+Premium only", () => {
    expect(getAllowedPlanSectors("CODIFICADO")).toEqual([
      "ENVASADO_MASIVO",
      "ENVASADO_PREMIUM",
    ]);
    expect(getAllowedPlanSectors("DEPOSITO")).toEqual([
      "ENVASADO_MASIVO",
      "ENVASADO_PREMIUM",
    ]);
  });

  it("allowlists Materia Prima to Elaboracion only", () => {
    expect(getAllowedPlanSectors("MATERIA_PRIMA")).toEqual(["ELABORACION"]);
  });

  it("denies other sectors", () => {
    expect(getAllowedPlanSectors("ELABORACION")).toEqual([]);
    expect(getAllowedPlanSectors("PRODUCCION")).toEqual([]);
    expect(canAccessSharedWeeklyPlans("CALIDAD")).toBe(false);
  });

  it("rejects unauthorized planSector requests", () => {
    expect(resolveRequestedPlanSectors("CODIFICADO", "ELABORACION")).toBeNull();
    expect(resolveRequestedPlanSectors("MATERIA_PRIMA", "ENVASADO_MASIVO")).toBeNull();
    expect(resolveRequestedPlanSectors("ELABORACION", "ELABORACION")).toBeNull();
  });

  it("accepts allowed filters and ALL", () => {
    expect(resolveRequestedPlanSectors("CODIFICADO", "ENVASADO_MASIVO")).toEqual([
      "ENVASADO_MASIVO",
    ]);
    expect(resolveRequestedPlanSectors("DEPOSITO", "ALL")).toEqual([
      "ENVASADO_MASIVO",
      "ENVASADO_PREMIUM",
    ]);
    expect(resolveRequestedPlanSectors("MATERIA_PRIMA", null)).toEqual(["ELABORACION"]);
  });
});
