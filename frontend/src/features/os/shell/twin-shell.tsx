"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
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
import { ConfirmDialog } from "@/components/ui/dialog";

interface TwinShellProps {
  title?: string;
  children: ReactNode;
  contentClassName?: string;
  syncTime?: Date;
  showBack?: boolean;
  onBack?: () => void;
  userInitials?: string;
}

/**
 * Shell del Digital Twin.
 * Scrolls reales (audit):
 * - Sidebar nav: overflow-y-auto (independiente, menús largos).
 * - main: overflow-y-auto (scroll principal de contenido).
 * - root: overflow-hidden (sin scroll del body / una sola barra de contenido).
 */
export function TwinShell({
  title,
  children,
  contentClassName,
  syncTime,
  showBack,
  onBack,
  userInitials,
}: TwinShellProps) {
  const { activeSidebarId, navigateSidebar, logout, currentNav } = usePreviewContext();
  const { email } = usePreviewSession();
  const home = useResolvedHome();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [mainScrolled, setMainScrolled] = useState(false);
  const [pageEnter, setPageEnter] = useState(true);
  const mainRef = useRef<HTMLElement>(null);

  const showRestricted =
    home.sidebarItems.includes("produccion") || home.sidebarItems.includes("direccion");

  const resolvedTitle =
    title ?? (showBack ? viewTitle(currentNav.view) : viewTitle(currentNav.view));

  const resolvedInitials = userInitials ?? email.slice(0, 2).toUpperCase();

  const effectiveActiveNav = home.sidebarItems.includes(activeSidebarId)
    ? activeSidebarId
    : home.sidebarItems[0];

  const handleNav = (itemId: typeof effectiveActiveNav) => {
    navigateSidebar(itemId);
    setMobileNavOpen(false);
  };

  const requestLogout = () => setLogoutConfirmOpen(true);

  const confirmLogout = () => {
    setLogoutConfirmOpen(false);
    setMobileNavOpen(false);
    logout();
  };

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const onScroll = () => setMainScrolled(el.scrollTop > 4);
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Entrada de página al cambiar sección — no remonta hijos; solo reinicia CSS animation.
  useEffect(() => {
    setPageEnter(false);
    const id = window.requestAnimationFrame(() => setPageEnter(true));
    return () => window.cancelAnimationFrame(id);
  }, [activeSidebarId, currentNav.view]);

  return (
    <div className="relative flex h-dvh max-h-dvh min-h-0 overflow-hidden bg-transparent">
      <div className="os-right-rail" aria-hidden="true" />

      <div className="hidden min-h-0 shrink-0 md:flex">
        <OsSidebar
          sectorLabel={home.definition.title}
          sectorEmail={email}
          activeNav={effectiveActiveNav}
          sidebarItems={home.sidebarItems}
          labelOverrides={home.sidebarLabelOverrides}
          showRestricted={showRestricted}
          onNav={handleNav}
        />
      </div>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <button
            type="button"
            className="absolute inset-0 bg-[var(--os-navy)]/45 backdrop-blur-[2px]"
            aria-label="Cerrar menú"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="relative z-10 flex h-full max-h-dvh w-[min(18rem,85vw)] shadow-[var(--os-shadow-card-hover)]">
            <OsSidebar
              sectorLabel={home.definition.title}
              sectorEmail={email}
              activeNav={effectiveActiveNav}
              sidebarItems={home.sidebarItems}
              labelOverrides={home.sidebarLabelOverrides}
              showRestricted={showRestricted}
              onNav={handleNav}
            />
          </div>
        </div>
      )}

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <OsHeader
          title={resolvedTitle}
          userInitials={resolvedInitials}
          userEmail={email}
          showBack={showBack}
          onBack={onBack}
          onOpenMenu={() => setMobileNavOpen(true)}
          onLogout={requestLogout}
          scrolled={mainScrolled}
        />
        <div className="os-scroll-fade relative min-h-0 flex-1">
          <main
            ref={mainRef}
            className={`os-scroll-main os-page-pad min-h-0 h-full overflow-x-hidden overflow-y-scroll py-4 sm:py-5 md:py-6 ${
              pageEnter ? "os-page-enter" : ""
            } ${contentClassName ?? ""}`}
          >
            {children}
          </main>
        </div>
        <OsStatusBar syncTime={syncTime} />
      </div>
      <CreamyCompanion />
      <ActionToast />

      <ConfirmDialog
        open={logoutConfirmOpen}
        onOpenChange={setLogoutConfirmOpen}
        title="¿Querés cerrar la sesión?"
        description="Vas a salir de Genus OS y volver a la pantalla de inicio de sesión."
        confirmLabel="Cerrar sesión"
        cancelLabel="Cancelar"
        variant="destructive"
        onConfirm={confirmLogout}
      />
    </div>
  );
}
