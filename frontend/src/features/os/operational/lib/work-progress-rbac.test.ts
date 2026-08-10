import { describe, expect, it } from "vitest";
import { canActOnWorkItemSector } from "./work-progress-rbac";

describe("canActOnWorkItemSector", () => {
  it("permite cuando el sector del actor coincide con el sector actual del work item", () => {
    expect(canActOnWorkItemSector("CODIFICADO", "CODIFICADO")).toBe(true);
    expect(canActOnWorkItemSector("ENVASADO_MASIVO", "ENVASADO_MASIVO")).toBe(true);
    expect(canActOnWorkItemSector("ELABORACION", "ELABORACION")).toBe(true);
  });

  it("rechaza cuando el sector del actor NO coincide con el sector actual del work item", () => {
    expect(canActOnWorkItemSector("ENVASADO_MASIVO", "CODIFICADO")).toBe(false);
    expect(canActOnWorkItemSector("CALIDAD", "CODIFICADO")).toBe(false);
    expect(canActOnWorkItemSector("ELABORACION", "ENVASADO_PREMIUM")).toBe(false);
  });

  it("PRODUCCION y DIRECCION siempre pueden actuar (supervisión), sea cual sea el sector del item", () => {
    expect(canActOnWorkItemSector("PRODUCCION", "CODIFICADO")).toBe(true);
    expect(canActOnWorkItemSector("PRODUCCION", "ELABORACION")).toBe(true);
    expect(canActOnWorkItemSector("DIRECCION", "ENVASADO_MASIVO")).toBe(true);
  });

  it("rechaza sector faltante/vacío en cualquiera de los dos lados", () => {
    expect(canActOnWorkItemSector(null, "CODIFICADO")).toBe(false);
    expect(canActOnWorkItemSector(undefined, "CODIFICADO")).toBe(false);
    expect(canActOnWorkItemSector("", "CODIFICADO")).toBe(false);
    expect(canActOnWorkItemSector("CODIFICADO", null)).toBe(false);
    expect(canActOnWorkItemSector("CODIFICADO", "")).toBe(false);
  });

  it("caso central del bug: Codificado puede actuar sobre un trabajo asignado directo (sector=CODIFICADO) igual que uno recibido vía handoff", () => {
    // El sector actual en Neon es "CODIFICADO" en ambos casos — asignación
    // directa o handoff desde Envasado — así que el mismo chequeo cubre los
    // dos caminos sin distinguir viaCodificado.
    expect(canActOnWorkItemSector("CODIFICADO", "CODIFICADO")).toBe(true);
  });
});
