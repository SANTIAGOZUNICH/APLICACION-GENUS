"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, LogOut, Menu } from "lucide-react";
import { formatTime } from "@/features/work/lib/calendar";
import { NotificationBell } from "@/features/os/feedback/notification-bell";
import { InstallGenusOsButton, StandaloneBuildBadge } from "@/features/os/pwa/install-genus-os-button";

interface OsHeaderProps {
  title: string;
  userInitials: string;
  userEmail?: string;
  showBack?: boolean;
  onBack?: () => void;
  onOpenMenu?: () => void;
  onLogout?: () => void;
  scrolled?: boolean;
}

function todayLabel(): string {
  const formatted = new Date().toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

/** Header — título, fecha, notificaciones y menú de usuario (logout). */
export function OsHeader({
  title,
  userInitials,
  userEmail,
  showBack,
  onBack,
  onOpenMenu,
  onLogout,
  scrolled = false,
}: OsHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest?.("[data-genus-install-modal]")) return;
      if (menuRef.current && !menuRef.current.contains(target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.querySelector("[data-genus-install-modal]")) return;
      setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  return (
    <header
      className={`os-header-glass flex shrink-0 items-center justify-between px-4 sm:px-6 md:px-8 ${
        scrolled ? "is-scrolled" : ""
      }`}
      style={{ height: "var(--os-header-height)" }}
    >
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        {onOpenMenu && (
          <button
            type="button"
            onClick={onOpenMenu}
            className="flex size-11 items-center justify-center rounded-[var(--os-radius-sm)] text-[var(--os-text)] transition-colors hover:bg-[var(--os-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-teal)] md:hidden"
            aria-label="Abrir menú"
          >
            <Menu className="size-5" aria-hidden="true" />
          </button>
        )}
        {showBack && (
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 rounded-[var(--os-radius-sm)] px-2 py-1.5 text-sm text-[var(--os-text-muted)] transition-colors hover:bg-[var(--os-bg)] hover:text-[var(--os-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-teal)]"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Volver
          </button>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-[var(--os-text)]">{title}</h1>
          <p className="truncate text-xs text-[var(--os-text-muted)]">{todayLabel()}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <NotificationBell />

        {onLogout ? (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              className="flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2 transition-colors hover:bg-[var(--os-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-teal)]"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-controls={menuId}
              aria-label="Menú de usuario"
            >
              <span className="flex size-8 items-center justify-center rounded-full bg-[var(--os-teal-soft)] text-xs font-semibold text-[var(--os-teal)]">
                {userInitials}
              </span>
              <ChevronDown
                className={`size-3.5 text-[var(--os-text-muted)] transition-transform duration-[var(--genus-duration-hover,140ms)] ${
                  menuOpen ? "rotate-180" : ""
                }`}
                aria-hidden="true"
              />
            </button>

            {menuOpen && (
              <div
                id={menuId}
                role="menu"
                className="os-fade-in absolute right-0 top-[calc(100%+0.35rem)] z-[var(--os-z-modal)] min-w-[12.5rem] overflow-hidden rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] shadow-[var(--os-shadow-card-hover)]"
              >
                {userEmail && (
                  <div className="border-b border-[var(--os-border-subtle)] px-3 py-2.5">
                    <p className="truncate text-xs text-[var(--os-text-muted)]">{userEmail}</p>
                  </div>
                )}
                <InstallGenusOsButton
                  variant="menu"
                  onInteract={() => setMenuOpen(false)}
                />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onLogout();
                  }}
                  className="flex min-h-11 w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-[var(--os-text)] transition-colors hover:bg-[var(--os-bg)] focus-visible:outline-none focus-visible:bg-[var(--os-bg)]"
                >
                  <LogOut className="size-3.5 text-[var(--os-text-muted)]" aria-hidden="true" />
                  Cerrar sesión
                </button>
              </div>
            )}
          </div>
        ) : (
          <div
            className="flex size-8 items-center justify-center rounded-full bg-[var(--os-teal-soft)] text-xs font-semibold text-[var(--os-teal)]"
            title="Usuario de sesión"
          >
            {userInitials}
          </div>
        )}
      </div>
    </header>
  );
}

interface OsStatusBarProps {
  syncTime?: Date;
}

export function OsStatusBar({ syncTime }: OsStatusBarProps) {
  const time = syncTime ?? new Date();

  return (
    <footer
      className="flex shrink-0 items-center justify-between border-t border-[var(--os-border-subtle)] bg-[var(--os-bg)]/80 px-4 text-[11px] text-[var(--os-text-muted)] backdrop-blur-sm sm:px-6 md:px-8"
      style={{
        height: "calc(var(--os-status-height) + env(safe-area-inset-bottom, 0px))",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <span className="flex items-center gap-2">
        SEMANAS 2026 · Digital Twin
        <StandaloneBuildBadge />
      </span>
      <span>Última sync · {formatTime(time)}</span>
    </footer>
  );
}
