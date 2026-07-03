import { describe, expect, it } from "vitest";
import {
  getWorkspaceExperience,
  listExperienceSectors,
} from "./experience/mock-workspace-experience";
import {
  getPremiumActionLabel,
  PREMIUM_ACTION_LABELS,
  resolveHeroCtaActionId,
} from "./lib/workspace-action-handlers";
import { WORK_STATUS } from "./components/premium/status-badge";

describe("Workspace experience mock", () => {
  it("expone experiencia premium para sectores principales", () => {
    const sectors = listExperienceSectors();
    expect(sectors).toContain("PRODUCCION");
    expect(sectors).toContain("CALIDAD");
    expect(sectors).toContain("DEPOSITO");
    expect(sectors).toContain("DIRECCION");
  });

  it("Producción prioriza órdenes operativas realistas", () => {
    const exp = getWorkspaceExperience("PRODUCCION");
    expect(exp.heroCtaLabel).toBe("Iniciar primera orden");
    expect(exp.workItems[0]?.reference).toBe("OE-2026-104");
    expect(exp.workItems[0]?.product).toContain("Shampoo Reparador");
    expect(exp.attentionItems.length).toBeGreaterThan(0);
    expect(exp.nextItems.length).toBeLessThanOrEqual(3);
  });

  it("Calidad prioriza liberaciones y análisis", () => {
    const exp = getWorkspaceExperience("CALIDAD");
    expect(exp.workItems[0]?.lot).toBe("L-26045");
    expect(exp.attentionItems.some((a) => a.title.includes("liberación"))).toBe(true);
  });

  it("Depósito prioriza movimientos e ingresos", () => {
    const exp = getWorkspaceExperience("DEPOSITO");
    expect(exp.workItems.some((w) => w.reference.startsWith("ING"))).toBe(true);
    expect(exp.workItems.some((w) => w.reference.startsWith("DES"))).toBe(true);
  });

  it("Dirección muestra operación sin KPIs financieros", () => {
    const exp = getWorkspaceExperience("DIRECCION");
    const text = JSON.stringify(exp);
    expect(text).not.toMatch(/financier/i);
    expect(exp.workItems.some((w) => w.reference === "Elaboración")).toBe(true);
  });

  it("fallback para sector sin experiencia dedicada", () => {
    const exp = getWorkspaceExperience("CODIFICADO");
    expect(exp.sectorId).toBe("CODIFICADO");
    expect(exp.workItems.length).toBeGreaterThan(0);
    expect(exp.heroCtaLabel).toBe("Empezar trabajo");
  });
});

describe("Premium action handlers", () => {
  it("mapea labels premium sin tocar resolver", () => {
    expect(PREMIUM_ACTION_LABELS["view-analysis"]).toBe("Registrar análisis");
    expect(getPremiumActionLabel({ id: "dispatch", label: "Despachar" })).toBe(
      "Preparar despacho"
    );
  });

  it("resuelve CTA hero por sector", () => {
    expect(resolveHeroCtaActionId("PRODUCCION")).toBe("start-elaboracion");
    expect(resolveHeroCtaActionId("CALIDAD")).toBe("release-lot");
    expect(resolveHeroCtaActionId("UNKNOWN")).toBe("start");
  });
});

describe("StatusBadge config", () => {
  it("expone tonos semánticos por estado de trabajo", () => {
    expect(WORK_STATUS.blocked.tone).toBe("blocked");
    expect(WORK_STATUS.active.tone).toBe("active");
    expect(WORK_STATUS.waiting_quality.tone).toBe("waiting");
  });
});
