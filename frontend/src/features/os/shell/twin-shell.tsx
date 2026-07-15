"use client";

import type { ReactNode } from "react";
import { OsHeader, OsStatusBar } from "./os-header";
import { OsSidebar } from "./os-sidebar";
import { ActionToast } from "./action-toast";
import { CreamyCompanion } from "@/features/os/feedback/creamy-companion";
import {
  usePreviewContext,
  usePreviewSession,
  useResolvedHome,
} from "@/features/os/session/preview-context";
import { viewTitle } from "@/features/os/navigation/twin-nav";

interface TwinShellProps {
  title?: string;
  children: ReactNode;
  contentClassName?: string;
  syncTime?: Date;
  showBack?: boolean;
  onBack?: () => void;
  userInitials?: string;
}

/** Shell del Digital Twin — navegación real + Creamy siempre presente. */
export function TwinShell({
  title,
  children,
  contentClassName,
  syncTime,
  showBack,
  onBack,
  userInitials,
}: TwinShellProps) {
  const { activeSidebarId, navigateSidebar, logout, openCreamy, creamyTeaser, currentNav } =
    usePreviewContext();
  const { email } = usePreviewSession();
  const home = useResolvedHome();

  const showRestricted =
    home.sidebarItems.includes("produccion") || home.sidebarItems.includes("direccion");

  const resolvedTitle =
    title ?? (showBack ? viewTitle(currentNav.view) : viewTitle(currentNav.view));

  const resolvedInitials = userInitials ?? email.slice(0, 2).toUpperCase();

  const effectiveActiveNav = home.sidebarItems.includes(activeSidebarId)
    ? activeSidebarId
    : home.sidebarItems[0];

  return (
    <div className="flex h-dvh min-h-[680px] overflow-hidden bg-[var(--os-bg)]">
      <OsSidebar
        sectorLabel={home.definition.title}
        sectorEmail={email}
        activeNav={effectiveActiveNav}
        sidebarItems={home.sidebarItems}
        labelOverrides={home.sidebarLabelOverrides}
        showRestricted={showRestricted}
        creamyTeaser={creamyTeaser}
        onNav={navigateSidebar}
        onLogout={logout}
        onOpenCreamy={openCreamy}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <OsHeader
          title={resolvedTitle}
          userInitials={resolvedInitials}
          showBack={showBack}
          onBack={onBack}
        />
        <main
          className={`os-fade-in flex-1 overflow-y-auto px-8 py-8 ${contentClassName ?? ""}`}
        >
          {children}
        </main>
        <OsStatusBar syncTime={syncTime} />
      </div>
      <CreamyCompanion />
      <ActionToast />
    </div>
  );
}
