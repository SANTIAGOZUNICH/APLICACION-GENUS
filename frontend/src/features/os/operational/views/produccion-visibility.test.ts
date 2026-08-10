import { describe, expect, it } from "vitest";
import { PRODUCING_SECTORS as PANEL_SECTORS } from "./produccion-panel-view";
import { PRODUCING_SECTORS as ENTREGADOS_SECTORS } from "./entregados-view";

/**
 * Regresión: PRODUCTION_AGGREGATE_SECTOR_IDS (work-item-filters.ts) incluir
 * CODIFICADO no alcanzaba — el panel general de Producción (pantalla real
 * que usa /mi-trabajo) y el filtro de sector en Entregados arman su propia
 * lista de sectores por separado, sin pasar por ese filtro. Ambas listas
 * quedaban desactualizadas y el trabajo de Codificado desaparecía de la UI
 * real aunque la API ya lo devolviera.
 */
describe("Listas de sectores visibles para Producción incluyen CODIFICADO", () => {
  it("Panel general (produccion-panel-view.tsx)", () => {
    expect(PANEL_SECTORS).toContain("CODIFICADO");
  });

  it("Filtro de sector en Entregados (entregados-view.tsx)", () => {
    expect(ENTREGADOS_SECTORS).toContain("CODIFICADO");
  });
});
