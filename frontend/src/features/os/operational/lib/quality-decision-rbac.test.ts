import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  assertCanDecideQuality,
  canDecideQuality,
  gateQualityDecision,
  QUALITY_DECISION_DENIED_MESSAGE,
} from "./quality-decision-rbac";
import {
  clearOperationalStore,
  getEffectiveQualityStatus,
  recordQualityDecision,
} from "../store/operational-store";
import type { SectorId } from "@/types/operational/sector";

describe("quality-decision-rbac", () => {
  it("solo CALIDAD puede decidir", () => {
    expect(canDecideQuality("CALIDAD")).toBe(true);
    expect(canDecideQuality("PRODUCCION")).toBe(false);
    expect(canDecideQuality("ELABORACION")).toBe(false);
    expect(canDecideQuality("ENVASADO_MASIVO")).toBe(false);
    expect(canDecideQuality("ENVASADO_PREMIUM")).toBe(false);
    expect(canDecideQuality("MATERIA_PRIMA")).toBe(false);
    expect(canDecideQuality(null)).toBe(false);
    expect(canDecideQuality(undefined)).toBe(false);
  });

  it("gateQualityDecision rechaza sectores no autorizados con mensaje claro", () => {
    expect(gateQualityDecision("CALIDAD")).toEqual({ ok: true });

    const denied = gateQualityDecision("PRODUCCION");
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.error).toBe(QUALITY_DECISION_DENIED_MESSAGE);
    }
  });

  it("assertCanDecideQuality lanza si el sector no es CALIDAD", () => {
    expect(() => assertCanDecideQuality("CALIDAD")).not.toThrow();
    expect(() => assertCanDecideQuality("PRODUCCION")).toThrow(QUALITY_DECISION_DENIED_MESSAGE);
  });
});

/**
 * Simula el pipeline de acción del store: gate → persistencia.
 * Producción (u otro sector) no debe poder mutar decisiones aunque
 * llame al mismo camino que Calidad.
 */
function applyGatedQualityDecision(
  itemId: string,
  status: "aprobado" | "rechazado",
  actorSectorId: SectorId
) {
  const gate = gateQualityDecision(actorSectorId);
  if (!gate.ok) return gate;
  recordQualityDecision(itemId, status, { decidedBy: "test" });
  return gate;
}

describe("quality-decision action pipeline", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    const localStorageMock = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    };
    vi.stubGlobal("localStorage", localStorageMock);
    vi.stubGlobal("window", { localStorage: localStorageMock });
    clearOperationalStore();
  });

  it("CALIDAD puede aprobar y la decisión persiste", () => {
    const result = applyGatedQualityDecision("q-1", "aprobado", "CALIDAD");
    expect(result.ok).toBe(true);
    expect(getEffectiveQualityStatus("q-1", "pendiente")).toBe("aprobado");
  });

  it("CALIDAD puede rechazar y la decisión persiste", () => {
    const result = applyGatedQualityDecision("q-2", "rechazado", "CALIDAD");
    expect(result.ok).toBe(true);
    expect(getEffectiveQualityStatus("q-2", "pendiente")).toBe("rechazado");
  });

  it("PRODUCCION no puede aprobar ni rechazar — no muta el store", () => {
    const approve = applyGatedQualityDecision("q-prod-1", "aprobado", "PRODUCCION");
    expect(approve.ok).toBe(false);
    if (!approve.ok) {
      expect(approve.error).toBe(QUALITY_DECISION_DENIED_MESSAGE);
    }
    expect(getEffectiveQualityStatus("q-prod-1", "pendiente")).toBe("pendiente");

    const reject = applyGatedQualityDecision("q-prod-2", "rechazado", "PRODUCCION");
    expect(reject.ok).toBe(false);
    expect(getEffectiveQualityStatus("q-prod-2", "pendiente")).toBe("pendiente");
  });

  it("otros sectores de planta tampoco pueden decidir", () => {
    const sectors: SectorId[] = [
      "ELABORACION",
      "ENVASADO_MASIVO",
      "ENVASADO_PREMIUM",
      "MATERIA_PRIMA",
    ];
    for (const sector of sectors) {
      const result = applyGatedQualityDecision(`q-${sector}`, "aprobado", sector);
      expect(result.ok).toBe(false);
      expect(getEffectiveQualityStatus(`q-${sector}`, "pendiente")).toBe("pendiente");
    }
  });
});
