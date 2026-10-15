import { describe, expect, it } from "vitest";
import { resolveSectorHome } from "./index";
import type { SectorId } from "@/types/operational/sector";

const SECTORS: SectorId[] = ["PRODUCCION", "DIRECCION", "ELABORACION", "ENVASADO_MASIVO", "ENVASADO_PREMIUM", "CODIFICADO", "CALIDAD", "MATERIA_PRIMA", "DEPOSITO"];

describe("menú lateral — «Semanas»", () => {
  it.each(SECTORS.filter((s) => s !== "PRODUCCION"))("%s no tiene semanas_sector ni semanas_planilla", (sector) => {
    const items = resolveSectorHome(sector).sidebarItems;
    expect(items).not.toContain("semanas_sector");
    expect(items).not.toContain("semanas_planilla");
  });

  it("PRODUCCION: sin «Panel general» (mi_trabajo); la planilla Semanas, que se abría desde ahí, es su primera sección", () => {
    const items = resolveSectorHome("PRODUCCION").sidebarItems;
    expect(items).not.toContain("mi_trabajo");
    expect(items).not.toContain("semanas_sector");
    expect(items[0]).toBe("semanas_planilla");
  });
});
