import { registerWorkspaces } from "./workspace-registry";
import { SECTOR_WORKSPACE_DEFINITIONS } from "./definitions/sector-workspaces";

let initialized = false;

/** Bootstrap de workspaces sectoriales — idempotente. */
export function ensureWorkspaceRegistry(): void {
  if (initialized) return;
  registerWorkspaces(SECTOR_WORKSPACE_DEFINITIONS);
  initialized = true;
}

/** Solo tests — reinicia el bootstrap. */
export function resetWorkspaceBootstrap(): void {
  initialized = false;
}
