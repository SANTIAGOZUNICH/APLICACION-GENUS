import { describe, expect, it } from "vitest";
import {
  canAccessProcedimientos,
  canMutateProcedureEntity,
  isProcedureAdmin,
} from "./types";

describe("procedimientos RBAC", () => {
  it("8 sectores operativos tienen acceso", () => {
    expect(canAccessProcedimientos("PRODUCCION")).toBe(true);
    expect(canAccessProcedimientos("CALIDAD")).toBe(true);
    expect(canAccessProcedimientos("ELABORACION")).toBe(true);
    expect(canAccessProcedimientos("ENVASADO_MASIVO")).toBe(true);
    expect(canAccessProcedimientos("ENVASADO_PREMIUM")).toBe(true);
    expect(canAccessProcedimientos("MATERIA_PRIMA")).toBe(true);
    expect(canAccessProcedimientos("CODIFICADO")).toBe(true);
    expect(canAccessProcedimientos("DEPOSITO")).toBe(true);
    expect(canAccessProcedimientos("COMERCIAL")).toBe(false);
    expect(canAccessProcedimientos("DIRECCION")).toBe(false);
  });

  it("CALIDAD y PRODUCCION son admin", () => {
    expect(isProcedureAdmin("CALIDAD")).toBe(true);
    expect(isProcedureAdmin("PRODUCCION")).toBe(true);
    expect(isProcedureAdmin("ELABORACION")).toBe(false);
  });

  it("mutación propia vs ajena", () => {
    const actor = { email: "a@test.com", sector: "ELABORACION" as const };
    expect(canMutateProcedureEntity(actor, "a@test.com")).toBe(true);
    expect(canMutateProcedureEntity(actor, "other@test.com")).toBe(false);
    expect(
      canMutateProcedureEntity({ email: "x@test.com", sector: "CALIDAD" }, "other@test.com")
    ).toBe(true);
  });
});
