"use client";

import { ArrowLeft } from "lucide-react";
import { formatTime } from "@/features/work/lib/calendar";
import { NotificationBell } from "@/features/os/feedback/notification-bell";

interface OsHeaderProps {
  title: string;
  userInitials: string;
  showBack?: boolean;
  onBack?: () => void;
}

function todayLabel(): string {
  const formatted = new Date().toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

/** Header — título de pantalla, fecha real, notificaciones y avatar. */
export function OsHeader({ title, userInitials, showBack, onBack }: OsHeaderProps) {
  return (
    <header
      className="flex shrink-0 items-center justify-between border-b border-[var(--os-border)] bg-[var(--os-surface)] px-8"
      style={{ height: "var(--os-header-height)" }}
    >
      <div className="flex min-w-0 items-center gap-3">
        {showBack && (
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 rounded-[var(--os-radius-sm)] px-2 py-1.5 text-sm text-[var(--os-text-muted)] transition-colors hover:bg-[var(--os-bg)] hover:text-[var(--os-text)]"
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

      <div className="flex items-center gap-3">
        <NotificationBell />

        <div className="flex size-8 items-center justify-center rounded-full bg-[var(--os-teal-soft)] text-xs font-semibold text-[var(--os-teal)]">
          {userInitials}
        </div>
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
      className="flex shrink-0 items-center justify-between border-t border-[var(--os-border-subtle)] bg-[var(--os-bg)] px-8 text-[11px] text-[var(--os-text-muted)]"
      style={{ height: "var(--os-status-height)" }}
    >
      <span>SEMANAS 2026 · Digital Twin F9.6</span>
      <span>Última sync · {formatTime(time)}</span>
    </footer>
  );
}
