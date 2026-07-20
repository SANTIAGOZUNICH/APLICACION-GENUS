"use client";

import { useState, type ReactNode } from "react";
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

/** Shell del Digital Twin — una sola barra vertical en el contenido principal. */
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

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

  return (
    <div className="flex h-dvh max-h-dvh min-h-0 overflow-hidden bg-[var(--os-bg)]">
      {/* Desktop sidebar — altura del viewport, nav scrollea si hace falta (sin barra del body). */}
      <div className="hidden min-h-0 shrink-0 md:flex">
        <OsSidebar
          sectorLabel={home.definition.title}
          sectorEmail={email}
          activeNav={effectiveActiveNav}
          sidebarItems={home.sidebarItems}
          labelOverrides={home.sidebarLabelOverrides}
          showRestricted={showRestricted}
          creamyTeaser={creamyTeaser}
          onNav={handleNav}
          onLogout={requestLogout}
          onOpenCreamy={openCreamy}
        />
      </div>

      {/* Mobile drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Cerrar menú"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="relative z-10 flex h-full max-h-dvh w-[min(18rem,85vw)] shadow-xl">
            <OsSidebar
              sectorLabel={home.definition.title}
              sectorEmail={email}
              activeNav={effectiveActiveNav}
              sidebarItems={home.sidebarItems}
              labelOverrides={home.sidebarLabelOverrides}
              showRestricted={showRestricted}
              creamyTeaser={creamyTeaser}
              onNav={handleNav}
              onLogout={requestLogout}
              onOpenCreamy={() => {
                setMobileNavOpen(false);
                openCreamy();
              }}
            />
          </div>
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <OsHeader
          title={resolvedTitle}
          userInitials={resolvedInitials}
          showBack={showBack}
          onBack={onBack}
          onOpenMenu={() => setMobileNavOpen(true)}
          onLogout={requestLogout}
        />
        {/* Única barra vertical del layout: solo el main hace scroll. */}
        <main
          className={`os-fade-in min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-5 sm:px-6 sm:py-6 md:px-8 md:py-8 ${contentClassName ?? ""}`}
        >
          {children}
        </main>
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
