import { describe, expect, it } from "vitest";
import { resolveSectorHome } from "@/lib/role-engine";
import { SIDEBAR_ITEM_IDS } from "@/lib/role-engine/types";
import { SIDEBAR_LABELS } from "@/features/os/shell/os-sidebar";
import { SIDEBAR_TO_TWIN_VIEW, twinViewToSidebarId, viewTitle } from "./twin-nav";
import { OPERATIONAL_SECTOR_IDS } from "@/types/operational/sector";

describe("pestaña «Dashboard» en el menú lateral", () => {
  it.each(OPERATIONAL_SECTOR_IDS)("%s tiene el ítem dashboard (todos los sectores)", (sector) => {
    expect(resolveSectorHome(sector).sidebarItems).toContain("dashboard");
  });

  it("el ítem existe en el contrato de ids, etiquetas y ruta interna", () => {
    expect(SIDEBAR_ITEM_IDS).toContain("dashboard");
    expect(SIDEBAR_LABELS.dashboard).toBe("Dashboard");
    expect(SIDEBAR_TO_TWIN_VIEW.dashboard).toBe("dashboard");
    expect(twinViewToSidebarId("dashboard")).toBe("dashboard");
    expect(viewTitle("dashboard")).toBe("Dashboard Operativo");
  });

  it("no aparece duplicado en ningún sector", () => {
    for (const sector of OPERATIONAL_SECTOR_IDS) {
      const items = resolveSectorHome(sector).sidebarItems.filter((i) => i === "dashboard");
      expect(items).toHaveLength(1);
    }
  });

  it("agregar el ítem no quitó ninguno de los existentes de Producción", () => {
    const items = resolveSectorHome("PRODUCCION").sidebarItems;
    for (const keep of ["mi_trabajo", "pedidos", "ordenes_elaboracion", "entregados", "remitos", "metricas", "procedimientos"]) {
      expect(items).toContain(keep);
    }
  });
});
