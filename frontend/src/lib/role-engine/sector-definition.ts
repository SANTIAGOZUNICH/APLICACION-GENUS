import type { SectorDefinition } from "@/lib/role-engine/types";

/** Valida y congela una definición de sector. */
export function defineSector(definition: SectorDefinition): SectorDefinition {
  return Object.freeze({ ...definition });
}

/** Filtra paneles visibles respetando el orden declarado en la definición. */
export function resolveVisiblePanels(definition: SectorDefinition) {
  return [...definition.visiblePanels];
}

/** Sidebar efectiva = base + ítems restringidos opcionales. */
export function resolveSidebarItems(definition: SectorDefinition) {
  const items = [...definition.sidebarItems];
  if (definition.restrictedSidebarItems) {
    items.push(...definition.restrictedSidebarItems);
  }
  return items;
}
