import { describe, expect, it } from "vitest";
import { getAllSectorDefinitions } from "@/lib/role-engine/sector-registry";
import { resolveSectorHome } from "@/lib/role-engine";
import { OPERATIONAL_SECTOR_IDS } from "@/types/operational/sector";
import { twinViewToSidebarId } from "@/features/os/navigation/twin-nav";

describe("UBICACIONES en el registro de sectores", () => {
  const all = getAllSectorDefinitions();

  it("el registro cubre todos los sectores operativos", () => {
    expect(all.map((d) => d.id).sort()).toEqual([...OPERATIONAL_SECTOR_IDS].sort());
  });

  it("TODOS los sectores del registro tienen «ubicaciones» exactamente una vez y ninguno tiene «ubicacion_materiales»", () => {
    expect(all.length).toBeGreaterThan(0);
    for (const def of all) {
      const base = def.sidebarItems as string[];
      expect(base.filter((i) => i === "ubicaciones"), `${def.id} (definición)`).toHaveLength(1);
      expect(base, def.id).not.toContain("ubicacion_materiales");
      const home = resolveSectorHome(def.id).sidebarItems as string[];
      expect(home.filter((i) => i === "ubicaciones"), `${def.id} (sidebar efectiva)`).toHaveLength(1);
      expect(home, def.id).not.toContain("ubicacion_materiales");
    }
  });

  it("la ruta vieja «ubicacion-materiales» se resuelve a la pestaña UBICACIONES", () => {
    expect(twinViewToSidebarId("ubicacion-materiales")).toBe("ubicaciones");
    expect(twinViewToSidebarId("ubicaciones")).toBe("ubicaciones");
  });
});
