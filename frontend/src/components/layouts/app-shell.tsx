"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { getNavItemByHref } from "@/config/navigation";
import { siteConfig } from "@/config/site";
import { OsLegacyConvergenceBanner } from "@/components/patterns/os-legacy-convergence-banner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MainContent } from "./main-content";
import { Sidebar } from "./sidebar/sidebar";
import { Topbar } from "./topbar/topbar";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const activeNav = getNavItemByHref(pathname);
  const [mobileOpen, setMobileOpen] = useState(false);

  const pageTitle = activeNav?.label ?? siteConfig.name;
  const pageSubtitle =
    pathname === "/bandeja" ? siteConfig.tagline : undefined;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-dvh overflow-hidden bg-[var(--background)]">
        {/* Desktop sidebar */}
        <div className="hidden lg:flex">
          <Sidebar />
        </div>

        {/* Mobile sidebar overlay */}
        {mobileOpen && (
          <>
            <button
              type="button"
              className="fixed inset-0 z-40 bg-black/40 lg:hidden"
              aria-label="Cerrar menú"
              onClick={() => setMobileOpen(false)}
            />
            <div className="fixed inset-y-0 left-0 z-50 lg:hidden">
              <Sidebar />
            </div>
          </>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar
            title={pageTitle}
            subtitle={pageSubtitle}
            showMenuButton
            onMenuClick={() => setMobileOpen((open) => !open)}
          />
          <OsLegacyConvergenceBanner />
          <MainContent>{children}</MainContent>
        </div>
      </div>
    </TooltipProvider>
  );
}
