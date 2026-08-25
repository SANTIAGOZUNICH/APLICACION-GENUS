import { describe, expect, it } from "vitest";
import {
  canEditInCodificado,
  codificadoOriginLabel,
  isInCodificadoStatus,
  isWorkItemReschedulable,
} from "./work-transfer-labels";

describe("isWorkItemReschedulable — qué puede moverse por drag & drop", () => {
  it("pendiente/en_curso/bloqueado sí se pueden mover", () => {
    expect(isWorkItemReschedulable("pendiente")).toBe(true);
    expect(isWorkItemReschedulable("en_curso")).toBe(true);
    expect(isWorkItemReschedulable("bloqueado")).toBe(true);
  });

  it("completado/enviado a Calidad/en Codificado/entregado desde Codificado no se pueden mover", () => {
    expect(isWorkItemReschedulable("completo")).toBe(false);
    expect(isWorkItemReschedulable("revision")).toBe(false);
    expect(isWorkItemReschedulable("en_codificado")).toBe(false);
    expect(isWorkItemReschedulable("codificado_completo")).toBe(false);
  });

  it("entregado y cancelado no se pueden mover", () => {
    expect(isWorkItemReschedulable("entregado")).toBe(false);
    expect(isWorkItemReschedulable("cancelado")).toBe(false);
  });

  it("borrado (soft delete) no se puede mover aunque el status sea movible", () => {
    expect(isWorkItemReschedulable("pendiente", "2026-08-20T10:00:00.000Z")).toBe(false);
  });
});

describe("codificadoOriginLabel", () => {
  it("asignación directa (sin codificadoOriginSector, sin viaCodificado)", () => {
    expect(codificadoOriginLabel({})).toBe("Asignación directa de Producción");
  });

  it("handoff desde Envasado Premium", () => {
    expect(codificadoOriginLabel({ codificadoOriginSector: "ENVASADO_PREMIUM" })).toBe(
      "Envasado Premium"
    );
  });

  it("handoff desde Envasado Masivo", () => {
    expect(codificadoOriginLabel({ codificadoOriginSector: "ENVASADO_MASIVO" })).toBe(
      "Envasado Masivo"
    );
  });

  it("viaCodificado sin sector de origen específico cae a 'Envasado' genérico", () => {
    expect(codificadoOriginLabel({ viaCodificado: true })).toBe("Envasado");
  });

  it("respeta un codificadoOriginLabel explícito si viene provisto", () => {
    expect(codificadoOriginLabel({ codificadoOriginLabel: "Custom" })).toBe("Custom");
  });
});

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
