import { describe, expect, it } from "vitest";
import { resolveSectorHome } from "./index";
import type { SectorId } from "@/types/operational/sector";

const SECTORS: SectorId[] = ["PRODUCCION", "DIRECCION", "ELABORACION", "ENVASADO_MASIVO", "ENVASADO_PREMIUM", "CODIFICADO", "CALIDAD", "MATERIA_PRIMA", "DEPOSITO"];

describe("menú lateral — sin entrada independiente «Semanas»", () => {
  it.each(SECTORS)("%s no tiene semanas_sector ni semanas_planilla", (sector) => {
    const items = resolveSectorHome(sector).sidebarItems;
    expect(items).not.toContain("semanas_sector");
    expect(items).not.toContain("semanas_planilla");
  });
});
