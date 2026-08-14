import { describe, expect, it } from "vitest";
import { canRequestRework } from "./rework-flow";

describe("canRequestRework", () => {
  it("bloquea si el trabajo nunca fue completado/enviado — nada que rehacer", () => {
    const result = canRequestRework({ completedAt: null, qualityStatus: "pendiente" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_COMPLETED");
  });

  it("permite Rehacer cuando el trabajo está completado y Calidad todavía no decidió", () => {
    const result = canRequestRework({
      completedAt: "2026-08-12T10:00:00.000Z",
      qualityStatus: "pendiente",
    });
    expect(result.ok).toBe(true);
  });

  it("bloquea si Calidad ya aprobó — hay que anular la decisión primero", () => {
    const result = canRequestRework({
      completedAt: "2026-08-12T10:00:00.000Z",
      qualityStatus: "aprobado",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("QUALITY_DECIDED");
  });

  it("bloquea si Calidad ya rechazó — hay que anular la decisión primero", () => {
    const result = canRequestRework({
      completedAt: "2026-08-12T10:00:00.000Z",
      qualityStatus: "rechazado",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("QUALITY_DECIDED");
  });

  it("bloquea si ya existe una entrega comercial real — no revierte un hecho irreversible", () => {
    const result = canRequestRework({
      completedAt: "2026-08-12T10:00:00.000Z",
      qualityStatus: "pendiente",
      hasActiveClientDelivery: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("ALREADY_DELIVERED_TO_CLIENT");
  });

  it("qualityStatus null/undefined se trata como 'todavía sin decidir' — no bloquea", () => {
    expect(canRequestRework({ completedAt: "2026-08-12T10:00:00.000Z", qualityStatus: null }).ok).toBe(
      true
    );
    expect(
      canRequestRework({ completedAt: "2026-08-12T10:00:00.000Z", qualityStatus: undefined }).ok
    ).toBe(true);
  });
});
