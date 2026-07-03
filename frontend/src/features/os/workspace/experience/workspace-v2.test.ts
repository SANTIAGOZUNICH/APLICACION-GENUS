import { describe, expect, it } from "vitest";
import { getWorkspaceExperienceV2, listExperienceV2Sectors } from "./mock-workspace-v2";
import { formatGreetingContext } from "./format-greeting-context";
import { isQualityDecisionFocus } from "./v2-types";

describe("Workspace experience v2", () => {
  it("Producción sigue wireframe OE-0142", () => {
    const exp = getWorkspaceExperienceV2("PRODUCCION", "Cristian");
    expect(exp.mode).toBe("operations");
    expect(exp.focus.reference).toBe("OE-0142");
    expect(exp.focus.workLine).toContain("Shampoo Vitamin Shock");
    expect(exp.focus.ctaLabel).toBe("Cargar consumo");
    expect(exp.statusCounts?.blocked).toBe(1);
    expect(exp.queues.find((q) => q.id === "blocked")?.items[0]?.reference).toBe("OA-0311");
  });

  it("Calidad expone decisión simétrica", () => {
    const exp = getWorkspaceExperienceV2("CALIDAD", "Santiago");
    expect(exp.mode).toBe("quality_decision");
    expect(isQualityDecisionFocus(exp.focus)).toBe(true);
    if (isQualityDecisionFocus(exp.focus)) {
      expect(exp.focus.reference).toBe("Lote E26014");
      expect(exp.focus.decisions).toHaveLength(2);
    }
  });

  it("Dirección muestra panorama en calma", () => {
    const exp = getWorkspaceExperienceV2("DIRECCION", "Caio");
    expect(exp.mode).toBe("direction_panorama");
    expect(exp.panorama?.calm).toBe(true);
    expect(exp.panorama?.metrics?.length).toBe(4);
    expect(exp.queues).toHaveLength(0);
  });

  it("Depósito prioriza movimientos", () => {
    const exp = getWorkspaceExperienceV2("DEPOSITO", "Santino");
    expect(exp.mode).toBe("warehouse");
    expect(exp.focus.ctaLabel).toBe("Recibir materiales");
  });

  it("fallback para sector sin builder dedicado", () => {
    const exp = getWorkspaceExperienceV2("CODIFICADO", "Ana");
    expect(exp.focus.calmState?.title).toContain("Sin tareas pendientes");
  });

  it("lista sectores v2 registrados", () => {
    expect(listExperienceV2Sectors()).toEqual(
      expect.arrayContaining(["PRODUCCION", "CALIDAD", "DEPOSITO", "DIRECCION"])
    );
  });
});

describe("formatGreetingContext", () => {
  it("formatea nombre y día en español", () => {
    const thursday = new Date("2026-07-02T12:00:00");
    const ctx = formatGreetingContext("Cristian", thursday);
    expect(ctx).toMatch(/^Cristian · /);
    expect(ctx.toLowerCase()).toContain("jueves");
  });
});
