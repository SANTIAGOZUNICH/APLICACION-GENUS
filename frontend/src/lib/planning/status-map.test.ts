import { describe, expect, it } from "vitest";
import { parseNativeWorkItemId, toNativeQualityItemId } from "@/lib/planning/native-id";
import { toUiQualityStatus, toUiWorkStatus } from "@/lib/planning/status-map";

describe("native progress status map", () => {
  it("mapea estados de planta a UI", () => {
    expect(toUiWorkStatus("PUBLICADO")).toBe("pendiente");
    expect(toUiWorkStatus("EN_PROCESO")).toBe("en_curso");
    expect(toUiWorkStatus("PENDIENTE_CALIDAD")).toBe("revision");
    expect(toUiWorkStatus("APROBADO_CALIDAD")).toBe("completo");
    expect(toUiWorkStatus("RECHAZADO_CALIDAD")).toBe("bloqueado");
  });

  it("mapea calidad", () => {
    expect(toUiQualityStatus("PENDIENTE_CALIDAD")).toBe("pendiente");
    expect(toUiQualityStatus("APROBADO_CALIDAD")).toBe("aprobado");
    expect(toUiQualityStatus("RECHAZADO_CALIDAD")).toBe("rechazado");
  });

  it("parsea ids native y qc", () => {
    const id = "a1b2c3d4-e5f6-4789-8bcd-ef1234567890";
    expect(parseNativeWorkItemId(`native:${id}`)).toBe(id);
    expect(parseNativeWorkItemId(toNativeQualityItemId(id))).toBe(id);
    expect(parseNativeWorkItemId("sheets:1")).toBeNull();
  });
});
