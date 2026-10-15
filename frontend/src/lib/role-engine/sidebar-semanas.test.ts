import { describe, expect, it } from "vitest";
import { resolveSectorHome } from "./index";
import type { SectorId } from "@/types/operational/sector";

const SECTORS: SectorId[] = ["PRODUCCION", "DIRECCION", "ELABORACION", "ENVASADO_MASIVO", "ENVASADO_PREMIUM", "CODIFICADO", "CALIDAD", "MATERIA_PRIMA", "DEPOSITO"];

describe("menú lateral — sin pestaña general «Semanas»", () => {
  it.each(SECTORS)("%s no tiene semanas_sector ni semanas_planilla", (sector) => {
    const items = resolveSectorHome(sector).sidebarItems;
    expect(items).not.toContain("semanas_sector");
    expect(items).not.toContain("semanas_planilla");
  });

  it("PRODUCCION: sin «Panel general» ni «Semanas» general; aterriza en Pedidos y conserva las vistas de sectores", () => {
    const items = resolveSectorHome("PRODUCCION").sidebarItems;
    expect(items).not.toContain("mi_trabajo");
    expect(items[0]).toBe("pedidos");
    for (const keep of ["ver_envasado_masivo", "ver_envasado_premium", "ver_elaboracion", "ver_codificado", "entregas", "dashboard"]) expect(items).toContain(keep);
  });

  it("Depósito conserva su «Plan semanal» de sector", () => {
    expect(resolveSectorHome("DEPOSITO").sidebarItems).toContain("semanas_produccion");
  });
});
