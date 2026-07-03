import { SECTOR_LABELS, type SectorId } from "@/types/operational/sector";
import { resolveSectorHome } from "@/lib/role-engine";
import { findMockUserByEmail } from "@/features/os/auth/lib/mock-preview-users";
import type { OsAuthSession } from "@/features/os/auth/contracts";
import { getWorkspaceDefinition } from "./workspace-registry";
import { createDefaultWorkspaceDefinition } from "./definitions/default-workspace";
import type {
  ResolvedWorkspace,
  WorkspaceContext,
  WorkspaceDefinition,
  WorkspaceResolveInput,
} from "./types";

export function extractFirstName(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) return "Usuario";
  return trimmed.split(/\s+/)[0] ?? trimmed;
}

export function buildWorkspaceGreeting(firstName: string, hour = new Date().getHours()): string {
  const saludo = hour < 12 ? "Buenos días" : hour < 19 ? "Buenas tardes" : "Buenas noches";
  return `${saludo}, ${firstName}.`;
}

export function buildWorkspaceContext(input: WorkspaceResolveInput): WorkspaceContext {
  const mockUser = findMockUserByEmail(input.email);
  const displayName = input.displayName ?? mockUser?.displayName ?? input.email.split("@")[0] ?? "Usuario";

  return {
    email: input.email,
    displayName,
    firstName: extractFirstName(displayName),
    sectorId: input.sectorId,
    sectorLabel: input.sectorLabel ?? mockUser?.sectorLabel ?? SECTOR_LABELS[input.sectorId],
    roleLabel: input.roleLabel ?? mockUser?.roleLabel ?? "Operativo",
    jobTitle: input.jobTitle ?? mockUser?.jobTitle ?? "",
  };
}

function resolveSubtitle(
  definition: WorkspaceDefinition,
  context: WorkspaceContext
): string {
  return typeof definition.subtitle === "function"
    ? definition.subtitle(context)
    : definition.subtitle;
}

/** Resuelve workspace desde identidad — combina registry + Role Engine sidebar. */
export function resolveWorkspace(input: WorkspaceResolveInput): ResolvedWorkspace {
  const context = buildWorkspaceContext(input);
  const definition =
    getWorkspaceDefinition(input.sectorId) ?? createDefaultWorkspaceDefinition(input.sectorId);
  const home = resolveSectorHome(input.sectorId);

  return {
    definition,
    context,
    title: buildWorkspaceGreeting(context.firstName),
    subtitle: resolveSubtitle(definition, context),
    navigation: home.sidebarItems,
    sectorLabel: home.definition.title,
  };
}

export function resolveWorkspaceFromAuthSession(session: OsAuthSession): ResolvedWorkspace {
  return resolveWorkspace({
    sectorId: session.sector.id,
    email: session.user.email,
    displayName: session.user.displayName,
    sectorLabel: session.sector.label,
    roleLabel: session.role.label,
    jobTitle: session.user.jobTitle,
  });
}

/** Resuelve para sector sin definición registrada — siempre retorna default. */
export function resolveWorkspaceOrDefault(sectorId: SectorId, email: string): ResolvedWorkspace {
  return resolveWorkspace({ sectorId, email });
}
