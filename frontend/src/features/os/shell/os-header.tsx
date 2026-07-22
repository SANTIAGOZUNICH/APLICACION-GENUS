"use client";

import { ArrowLeft, LogOut, Menu } from "lucide-react";
import { formatTime } from "@/features/work/lib/calendar";
import { NotificationBell } from "@/features/os/feedback/notification-bell";

interface OsHeaderProps {
  title: string;
  userInitials: string;
  showBack?: boolean;
  onBack?: () => void;
  onOpenMenu?: () => void;
  onLogout?: () => void;
}

function todayLabel(): string {
  const formatted = new Date().toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

/** Header — título de pantalla, fecha real, menú móvil, notificaciones y avatar. */
export function OsHeader({
  title,
  userInitials,
  showBack,
  onBack,
  onOpenMenu,
  onLogout,
}: OsHeaderProps) {
  return (
    <header
      className="flex shrink-0 items-center justify-between border-b border-[var(--os-border)] bg-[var(--os-surface)] px-4 sm:px-6 md:px-8"
      style={{ height: "var(--os-header-height)" }}
    >
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        {onOpenMenu && (
          <button
            type="button"
            onClick={onOpenMenu}
            className="flex size-9 items-center justify-center rounded-[var(--os-radius-sm)] text-[var(--os-text)] transition-colors hover:bg-[var(--os-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-teal)] md:hidden"
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

        <div
          className="flex size-8 items-center justify-center rounded-full bg-[var(--os-teal-soft)] text-xs font-semibold text-[var(--os-teal)]"
          title="Usuario de sesión"
        >
          {userInitials}
        </div>

        {onLogout && (
          <button
            type="button"
            onClick={onLogout}
            className="hidden items-center gap-1.5 rounded-[var(--os-radius-sm)] px-2 py-1.5 text-xs font-medium text-[var(--os-text-muted)] transition-colors hover:bg-[var(--os-bg)] hover:text-[var(--os-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-teal)] sm:flex"
            aria-label="Cerrar sesión"
          >
            <LogOut className="size-3.5" aria-hidden="true" />
            Cerrar sesión
          </button>
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
      className="flex shrink-0 items-center justify-between border-t border-[var(--os-border-subtle)] bg-[var(--os-bg)] px-4 text-[11px] text-[var(--os-text-muted)] sm:px-6 md:px-8"
      style={{ height: "var(--os-status-height)" }}
    >
      <span>SEMANAS 2026 · Digital Twin F9.6</span>
      <span>Última sync · {formatTime(time)}</span>
    </footer>
  );
}
