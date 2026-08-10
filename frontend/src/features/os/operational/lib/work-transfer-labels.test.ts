import { describe, expect, it } from "vitest";
import { canEditInCodificado, isInCodificadoStatus } from "./work-transfer-labels";

describe("canEditInCodificado — bug: asignación directa Producción → Codificado no editable", () => {
  it("permite editar un trabajo asignado DIRECTO a Codificado (pendiente/en_curso, sector=CODIFICADO, sin viaCodificado)", () => {
    expect(
      canEditInCodificado({
        status: "pendiente",
        sector: "CODIFICADO",
        viaCodificado: false,
        deliveredFromCodificadoAt: null,
      })
    ).toBe(true);
    expect(
      canEditInCodificado({
        status: "en_curso",
        sector: "CODIFICADO",
        viaCodificado: false,
        deliveredFromCodificadoAt: null,
      })
    ).toBe(true);
  });

  it("isInCodificadoStatus sola NO reconoce la asignación directa (esta era la causa raíz del bug)", () => {
    expect(isInCodificadoStatus("pendiente")).toBe(false);
    expect(isInCodificadoStatus("en_curso")).toBe(false);
  });

  it("permite editar un trabajo recibido vía handoff desde Envasado (status en_codificado)", () => {
    expect(
      canEditInCodificado({
        status: "en_codificado",
        sector: "CODIFICADO",
        viaCodificado: true,
        deliveredFromCodificadoAt: null,
      })
    ).toBe(true);
  });

  it("bloquea edición una vez entregado a Calidad, sea cual sea el origen", () => {
    expect(
      canEditInCodificado({
        status: "codificado_completo",
        sector: "CODIFICADO",
        viaCodificado: false,
        deliveredFromCodificadoAt: "2026-08-10T12:00:00.000Z",
      })
    ).toBe(false);
    expect(
      canEditInCodificado({
        status: "en_codificado",
        sector: "CODIFICADO",
        viaCodificado: true,
        deliveredFromCodificadoAt: "2026-08-10T12:00:00.000Z",
      })
    ).toBe(false);
  });

  it("bloquea edición si está cancelado o ya en revisión/entregado", () => {
    for (const status of ["cancelado", "completo", "revision", "entregado"]) {
      expect(
        canEditInCodificado({
          status,
          sector: "CODIFICADO",
          viaCodificado: false,
          deliveredFromCodificadoAt: null,
        })
      ).toBe(false);
    }
  });

  it("no editable si el sector actual ya no es CODIFICADO (ej. envío cancelado, volvió a Envasado)", () => {
    expect(
      canEditInCodificado({
        status: "en_curso",
        sector: "ENVASADO_MASIVO",
        viaCodificado: true,
        deliveredFromCodificadoAt: null,
      })
    ).toBe(false);
  });
});
