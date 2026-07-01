export interface WorkspaceSectionConfig {
  id: string;
  label: string;
  description: string;
  defaultCollapsed: boolean;
  alwaysExpanded?: boolean;
  /** Render as KPI tiles instead of card deck (Dirección Panorama) */
  variant?: "deck" | "panorama";
}
