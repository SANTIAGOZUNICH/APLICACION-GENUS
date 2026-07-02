import { describe, expect, it } from "vitest";
import {
  assertSectorDefinition,
  getAllSectorDefinitions,
  resolveAllSectorHomes,
  resolveSectorHome,
  sectorHasPanel,
  sectorHasQuickAction,
} from "@/lib/role-engine";
import { OPERATIONAL_SECTOR_IDS } from "@/types/operational/sector";

describe("Role Engine — F9.3", () => {
  it("registra los 10 sectores operativos", () => {
    const definitions = getAllSectorDefinitions();
    expect(definitions).toHaveLength(10);
    for (const sectorId of OPERATIONAL_SECTOR_IDS) {
      expect(assertSectorDefinition(sectorId).id).toBe(sectorId);
    }
  });

  it("resuelve Home de Envasado Masivo con paneles y acciones declarativas", () => {
    const home = resolveSectorHome("ENVASADO_MASIVO");

    expect(home.homeViewKey).toBe("envasado-masivo-home");
    expect(home.layout).toBe("packaging_lines");
    expect(home.dataMode).toBe("work_items");
    expect(home.workItemSources).toContain("semanas_2026");
    expect(home.panels).toContain("line_work_cards");
    expect(home.panels).toContain("date_navigator");
    expect(home.quickActions).toContain("open_oa");
    expect(home.sidebarItems).toContain("mi_trabajo");
    expect(home.sidebarItems).toContain("plan_semanal");
  });

  it("resuelve Elaboración con ownerPerson como fuente de filtro", () => {
    const home = resolveSectorHome("ELABORACION");
    expect(home.homeViewKey).toBe("elaboracion-home");
    expect(home.layout).toBe("work_blocks");
    expect(home.creamyContext.role).toContain("elaboración");
  });

  it("expone helpers de panel y acción rápida", () => {
    expect(sectorHasPanel("ENVASADO_MASIVO", "week_plan")).toBe(true);
    expect(sectorHasPanel("ENVASADO_MASIVO", "kpi_tiles")).toBe(false);
    expect(sectorHasQuickAction("ENVASADO_MASIVO", "mark_done")).toBe(true);
  });

  it("resuelve todas las Homes sin errores", () => {
    const homes = resolveAllSectorHomes();
    expect(homes).toHaveLength(10);
    for (const home of homes) {
      expect(home.emptyState.title).toBeTruthy();
      expect(home.allowedActions.length).toBeGreaterThan(0);
    }
  });
});
