export {
  renderSectorHome,
  resolveAllSectorHomes,
  resolveSectorHome,
  sectorHasPanel,
  sectorHasQuickAction,
} from "@/lib/role-engine/role-engine";
export type {
  ResolvedSectorHome,
  SectorDefinition,
  SectorViewRegistry,
} from "@/lib/role-engine/role-engine";

export {
  defineSector,
  resolveSidebarItems,
  resolveVisiblePanels,
} from "@/lib/role-engine/sector-definition";

export {
  assertSectorDefinition,
  getAllSectorDefinitions,
  getSectorDefinition,
  SECTOR_DEFINITIONS,
  SECTOR_REGISTRY,
} from "@/lib/role-engine/sector-registry";

export type {
  CreamyContextDefinition,
  HomeLayoutId,
  PanelId,
  QuickActionId,
  SectorEmptyState,
  SectorViewKey,
  SidebarItemId,
  VisibleEntityId,
  WorkItemSourceKey,
} from "@/lib/role-engine/types";

export {
  HOME_LAYOUTS,
  PANEL_IDS,
  QUICK_ACTION_IDS,
  SIDEBAR_ITEM_IDS,
  VISIBLE_ENTITY_IDS,
  WORK_ITEM_SOURCE_KEYS,
} from "@/lib/role-engine/types";
