import { describe, expect, it } from "vitest";
import {
  canAccessSharedWeeklyPlans,
  getAllowedPlanSectors,
  resolveRequestedPlanSectors,
} from "./weekly-plans-rbac";

const THREE = ["ELABORACION", "ENVASADO_MASIVO", "ENVASADO_PREMIUM"];
const VIEWERS = ["PRODUCCION", "DIRECCION", "COMERCIAL", "ELABORACION", "ENVASADO_MASIVO", "ENVASADO_PREMIUM", "CODIFICADO", "DEPOSITO", "MATERIA_PRIMA", "CALIDAD"];

describe("weekly-plans-rbac (consulta de la planificación de piso)", () => {
  it("todo sector con bandeja operativa puede consultar Premium, Masivo y Elaboración (solo lectura)", () => {
    for (const s of VIEWERS) {
      expect(getAllowedPlanSectors(s).slice().sort()).toEqual([...THREE].sort());
      for (const t of THREE) expect(resolveRequestedPlanSectors(s, t)).toEqual([t]);
      expect(canAccessSharedWeeklyPlans(s)).toBe(true);
    }
  });

  it("Administración y sectores desconocidos no consultan", () => {
    expect(getAllowedPlanSectors("ADMINISTRACION")).toEqual([]);
    expect(canAccessSharedWeeklyPlans("ADMINISTRACION")).toBe(false);
    expect(resolveRequestedPlanSectors("ADMINISTRACION", "ELABORACION")).toBeNull();
    expect(resolveRequestedPlanSectors("XYZ", null)).toBeNull();
  });

  it("rechaza sectores que no son de piso", () => {
    expect(resolveRequestedPlanSectors("DEPOSITO", "CODIFICADO")).toBeNull();
    expect(resolveRequestedPlanSectors("CALIDAD", "PRODUCCION")).toBeNull();
    expect(resolveRequestedPlanSectors("DEPOSITO", "'; drop")).toBeNull();
  });

  it("sin sector pedido / ALL conserva el comportamiento histórico de las vistas compartidas existentes", () => {
    expect(resolveRequestedPlanSectors("CODIFICADO", "ALL")).toEqual(["ENVASADO_MASIVO", "ENVASADO_PREMIUM"]);
    expect(resolveRequestedPlanSectors("DEPOSITO", "ALL")).toEqual(["ENVASADO_MASIVO", "ENVASADO_PREMIUM"]);
    expect(resolveRequestedPlanSectors("MATERIA_PRIMA", null)).toEqual(["ELABORACION"]);
    expect(resolveRequestedPlanSectors("CALIDAD", "ALL")).toEqual(getAllowedPlanSectors("CALIDAD"));
  });
});
