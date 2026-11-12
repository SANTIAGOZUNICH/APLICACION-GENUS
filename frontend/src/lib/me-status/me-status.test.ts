import { describe, expect, it } from "vitest";
import { buildMeInfo, canSetMeStatus, meAppliesToSector, meLine, meStatusFromDb, meStatusToDb, parseMeStatus } from "./me-status";

describe("estado de ME", () => {
  it("el estado inicial es «Sin info» y nunca se asume correcto", () => {
    expect(meStatusFromDb(null)).toBe("SIN_INFO");
    expect(meStatusFromDb(undefined)).toBe("SIN_INFO");
    expect(meStatusFromDb("cualquier cosa")).toBe("SIN_INFO");
    expect(buildMeInfo({}).status).toBe("SIN_INFO");
    expect(meLine(null)).toBe("ME: Sin info");
  });
  it("etiquetas y persistencia (SIN_INFO = NULL)", () => {
    expect(meLine({ status: "OK" })).toBe("ME: ✅");
    expect(meLine({ status: "NO_OK" })).toBe("ME: ❌");
    expect(meStatusToDb("SIN_INFO")).toBeNull();
    expect(meStatusToDb("OK")).toBe("OK");
    expect(parseMeStatus("✅")).toBe("OK");
    expect(parseMeStatus("❌")).toBe("NO_OK");
    expect(parseMeStatus("sin info")).toBe("SIN_INFO");
    expect(parseMeStatus("quizás")).toBeNull();
  });
  it("solo aplica a Envasado Masivo/Premium (no Elaboración ni Codificado)", () => {
    expect(meAppliesToSector("ENVASADO_MASIVO")).toBe(true);
    expect(meAppliesToSector("ENVASADO_PREMIUM")).toBe(true);
    expect(meAppliesToSector("ELABORACION")).toBe(false);
    expect(meAppliesToSector("CODIFICADO")).toBe(false);
  });
  it("solo Depósito y Dirección modifican", () => {
    expect(canSetMeStatus("DEPOSITO")).toBe(true);
    expect(canSetMeStatus("DIRECCION")).toBe(true);
    for (const s of ["PRODUCCION", "MATERIA_PRIMA", "ELABORACION", "ENVASADO_MASIVO", "ENVASADO_PREMIUM", "CODIFICADO", "CALIDAD", "ADMINISTRACION", "COMERCIAL", null]) expect(canSetMeStatus(s)).toBe(false);
  });
  it("observación vacía = null", () => {
    expect(buildMeInfo({ meStatus: "NO_OK", meObservation: "  " }).observation).toBeNull();
    expect(buildMeInfo({ meStatus: "NO_OK", meObservation: "Faltan 300 pomos de 200 ml" }).observation).toBe("Faltan 300 pomos de 200 ml");
  });
});
