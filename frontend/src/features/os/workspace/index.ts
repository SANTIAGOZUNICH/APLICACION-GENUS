export type {
  ResolvedWorkspace,
  WorkspaceAction,
  WorkspaceContext,
  WorkspaceDefinition,
  WorkspaceNavItem,
  WorkspaceResolveInput,
  WorkspaceWidget,
} from "./types";

export {
  clearWorkspaceRegistry,
  getWorkspaceDefinition,
  getWorkspaceRegistrySize,
  hasWorkspaceDefinition,
  listRegisteredWorkspaces,
  registerWorkspace,
  registerWorkspaces,
} from "./workspace-registry";

export {
  buildWorkspaceContext,
  buildWorkspaceGreeting,
  extractFirstName,
  resolveWorkspace,
  resolveWorkspaceFromAuthSession,
  resolveWorkspaceOrDefault,
} from "./workspace-resolver";

export { ensureWorkspaceRegistry, resetWorkspaceBootstrap } from "./bootstrap-workspaces";
export { createDefaultWorkspaceDefinition } from "./definitions/default-workspace";
export {
  CALIDAD_WORKSPACE,
  DEPOSITO_WORKSPACE,
  DIRECCION_WORKSPACE,
  PRODUCCION_WORKSPACE,
  SECTOR_WORKSPACE_DEFINITIONS,
} from "./definitions/sector-workspaces";

export { WorkspaceProvider, useRequiredWorkspace, useWorkspace, useWorkspaceUserInitials } from "./workspace-provider";
export { DynamicWorkspaceHome } from "./components/dynamic-workspace-home";
