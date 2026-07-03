import type { SectorId } from "@/types/operational/sector";
import type { SidebarItemId } from "@/lib/role-engine/types";

/** Contexto de identidad para resolver el workspace — mock hasta datos reales. */
export interface WorkspaceContext {
  email: string;
  displayName: string;
  firstName: string;
  sectorId: SectorId;
  sectorLabel: string;
  roleLabel: string;
  jobTitle: string;
}

export interface WorkspaceNavItem {
  id: string;
  label: string;
  sidebarItemId: SidebarItemId;
}

export interface WorkspaceAction {
  id: string;
  label: string;
  description?: string;
}

export interface WorkspaceWidget {
  id: string;
  label: string;
  hint?: string;
  status?: string;
}

/** Definición declarativa de workspace por sector — sin lógica de UI. */
export interface WorkspaceDefinition {
  sectorId: SectorId;
  subtitle: string | ((context: WorkspaceContext) => string);
  primaryNav: WorkspaceNavItem[];
  primaryActions: WorkspaceAction[];
  widgets: WorkspaceWidget[];
}

/** Workspace resuelto — listo para render en App Shell. */
export interface ResolvedWorkspace {
  definition: WorkspaceDefinition;
  context: WorkspaceContext;
  title: string;
  subtitle: string;
  navigation: SidebarItemId[];
  sectorLabel: string;
}

export interface WorkspaceResolveInput {
  sectorId: SectorId;
  email: string;
  displayName?: string;
  sectorLabel?: string;
  roleLabel?: string;
  jobTitle?: string;
}
