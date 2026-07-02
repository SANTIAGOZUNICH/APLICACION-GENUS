"use client";

import type { ReactNode } from "react";
import { OsHeader, OsStatusBar } from "@/design-preview/components/os-header";
import { OsSidebar } from "@/design-preview/components/os-sidebar";

interface OsShellProps {
  sectorLabel: string;
  sectorEmail: string;
  title?: string;
  activeNav?: string;
  showRestricted?: boolean;
  children: ReactNode;
  /** Wider content area for sector-specific layouts */
  contentClassName?: string;
  /** Optional sync timestamp for status bar */
  syncTime?: Date;
}

export function OsShell({
  sectorLabel,
  sectorEmail,
  title = "Mi trabajo",
  activeNav,
  showRestricted,
  children,
  contentClassName,
  syncTime,
}: OsShellProps) {
  const initials = sectorEmail.slice(0, 2).toUpperCase();

  return (
    <div className="flex h-full min-h-[680px] overflow-hidden rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-bg)]">
      <OsSidebar
        sectorLabel={sectorLabel}
        sectorEmail={sectorEmail}
        activeNav={activeNav}
        showRestricted={showRestricted}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <OsHeader title={title} userInitials={initials} />
        <main className={`flex-1 overflow-y-auto px-8 py-8 ${contentClassName ?? ""}`}>
          {children}
        </main>
        <OsStatusBar syncTime={syncTime} />
      </div>
    </div>
  );
}
