"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { getCurrentAuthSession } from "@/features/os/auth/lib/auth-session-helpers";
import { usePreviewContext, usePreviewSession } from "@/features/os/session/preview-context";
import { ensureWorkspaceRegistry } from "./bootstrap-workspaces";
import { resolveWorkspace, resolveWorkspaceFromAuthSession } from "./workspace-resolver";
import type { ResolvedWorkspace } from "./types";

interface WorkspaceContextValue {
  workspace: ResolvedWorkspace | null;
  isReady: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

/** Hidrata identidad desde auth storage y expone workspace resuelto. */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { session, login } = usePreviewContext();
  const previewSession = session;

  useEffect(() => {
    ensureWorkspaceRegistry();
  }, []);

  useEffect(() => {
    if (previewSession) return;

    const authSession = getCurrentAuthSession();
    if (!authSession) return;

    login(authSession.sector.id, {
      email: authSession.user.email,
    });
  }, [previewSession, login]);

  const workspace = useMemo(() => {
    ensureWorkspaceRegistry();

    const authSession = getCurrentAuthSession();
    if (authSession) {
      return resolveWorkspaceFromAuthSession(authSession);
    }

    if (!previewSession) return null;

    return resolveWorkspace({
      sectorId: previewSession.sectorId,
      email: previewSession.email,
    });
  }, [previewSession]);

  const value = useMemo(
    () => ({
      workspace,
      isReady: Boolean(previewSession && workspace),
    }),
    [workspace, previewSession]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error("useWorkspace must be used within WorkspaceProvider");
  }
  return context;
}

/** Atajo cuando el workspace ya está garantizado (dentro de sesión activa). */
export function useRequiredWorkspace(): ResolvedWorkspace {
  const { workspace } = useWorkspace();
  if (!workspace) {
    throw new Error("Workspace not resolved — session required");
  }
  return workspace;
}

/** Iniciales del usuario para header/sidebar. */
export function useWorkspaceUserInitials(): string {
  const { workspace } = useWorkspace();
  const { email } = usePreviewSession();

  if (workspace?.context.displayName) {
    const parts = workspace.context.displayName.trim().split(/\s+/);
    if (parts.length >= 2) {
      return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
    }
    return (parts[0]?.slice(0, 2) ?? "US").toUpperCase();
  }

  return email.slice(0, 2).toUpperCase();
}
