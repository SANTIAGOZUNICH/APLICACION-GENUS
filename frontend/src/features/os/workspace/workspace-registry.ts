import type { SectorId } from "@/types/operational/sector";
import type { WorkspaceDefinition } from "./types";

const registry = new Map<SectorId, WorkspaceDefinition>();

/** Registra un workspace sectorial — patrón registry, sin if gigantes. */
export function registerWorkspace(definition: WorkspaceDefinition): void {
  registry.set(definition.sectorId, definition);
}

export function registerWorkspaces(definitions: WorkspaceDefinition[]): void {
  for (const definition of definitions) {
    registerWorkspace(definition);
  }
}

export function getWorkspaceDefinition(sectorId: SectorId): WorkspaceDefinition | undefined {
  return registry.get(sectorId);
}

export function hasWorkspaceDefinition(sectorId: SectorId): boolean {
  return registry.has(sectorId);
}

export function listRegisteredWorkspaces(): WorkspaceDefinition[] {
  return [...registry.values()];
}

export function clearWorkspaceRegistry(): void {
  registry.clear();
}

/** Expuesto para tests — no usar en producción. */
export function getWorkspaceRegistrySize(): number {
  return registry.size;
}
