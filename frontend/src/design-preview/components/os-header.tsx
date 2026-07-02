"use client";

import { Bell } from "lucide-react";
import { formatTime } from "@/design-preview/lib/calendar-mock";

interface OsHeaderProps {
  title: string;
  userInitials: string;
}

/** F9.1 — Header mínimo: título, notificaciones, perfil. Sin KPIs ni fecha fija. */
export function OsHeader({ title, userInitials }: OsHeaderProps) {
  return (
    <header
      className="flex shrink-0 items-center justify-between border-b border-[var(--os-border)] bg-[var(--os-surface)] px-8"
      style={{ height: "var(--os-header-height)" }}
    >
      <h1 className="text-base font-semibold text-[var(--os-text)]">{title}</h1>

      <div className="flex items-center gap-3">
        <button
          type="button"
          className="relative rounded-full p-2 text-[var(--os-text-muted)] transition-colors hover:bg-[var(--os-bg)] hover:text-[var(--os-text)]"
          aria-label="Notificaciones"
        >
          <Bell className="size-5" />
          <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-[var(--os-teal)]" />
        </button>

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
      <span>SEMANAS 2026 · preview mock</span>
      <span>Última sync · {formatTime(time)}</span>
    </footer>
  );
}
