"use client";

import type { ReactNode } from "react";
import { OsHeader, OsStatusBar } from "@/design-preview/components/os-header";
import { OsSidebar } from "@/design-preview/components/os-sidebar";
import type { SidebarItemId } from "@/lib/role-engine/types";

interface OsShellProps {
  sectorLabel: string;
  sectorEmail: string;
  title?: string;
  activeNav?: SidebarItemId;
  sidebarItems?: SidebarItemId[];
  showRestricted?: boolean;
  children: ReactNode;
  contentClassName?: string;
  syncTime?: Date;
}

const DEFAULT_SIDEBAR: SidebarItemId[] = [
  "mi_trabajo",
  "plan_semanal",
  "consulta",
  "insumos",
  "calidad",
  "configuracion",
];

/** Shell legacy — preferir TwinShell en Digital Twin F9.6. */
export function OsShell({
  sectorLabel,
  sectorEmail,
  title = "Mi trabajo",
  activeNav = "mi_trabajo",
  sidebarItems = DEFAULT_SIDEBAR,
  showRestricted,
  children,
  contentClassName,
  syncTime,
}: OsShellProps) {
  const items = showRestricted
    ? ([...sidebarItems, "produccion", "direccion"] as SidebarItemId[])
    : sidebarItems;
  const initials = sectorEmail.slice(0, 2).toUpperCase();

  return (
    <div className="flex h-full min-h-[680px] overflow-hidden rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-bg)]">
      <OsSidebar
        sectorLabel={sectorLabel}
        sectorEmail={sectorEmail}
        activeNav={activeNav}
        sidebarItems={items}
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
