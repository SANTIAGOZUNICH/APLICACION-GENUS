import { describe, expect, it } from "vitest";
import { ADMIN_ACCOUNT, validateNewPassword } from "./admin-activation-rules";

describe("activación de la cuenta de Administración", () => {
  it("la cuenta es fija: Administración, ROL-AD, sin superadmin", () => {
    expect(ADMIN_ACCOUNT).toMatchObject({ email: "admin@laboratoriogenus.com.ar", sector: "ADMINISTRACION", roleId: "ROL-AD" });
  });
  it("rechaza contraseñas cortas, comunes o con datos de la empresa", () => {
    for (const p of ["corta1A!", "admin123", "Admin123", "ADMIN1234567", "laboratoriogenus1", "aaaaaaaaaaaa", "soloMinusculas", "12345678901"]) expect(validateNewPassword(p), p).not.toBeNull();
  });
  it("acepta una contraseña robusta", () => {
    expect(validateNewPassword("Mi-Clave-Segura-2026")).toBeNull();
    expect(validateNewPassword("tablet Genus 7391")).toBeNull();
  });
});
