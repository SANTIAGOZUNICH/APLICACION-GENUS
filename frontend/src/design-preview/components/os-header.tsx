"use client";

import { Bell, ChevronLeft, ChevronRight } from "lucide-react";

interface OsHeaderProps {
  title: string;
  userInitials: string;
  dateLabel?: string;
}

/** F9.1 — Header mínimo: título, fecha, notificaciones, perfil. Sin KPIs. */
export function OsHeader({
  title,
  userInitials,
  dateLabel = "Martes 23 · Jun 2026",
}: OsHeaderProps) {
  return (
    <header
      className="flex shrink-0 items-center justify-between border-b border-[var(--os-border)] bg-[var(--os-surface)] px-8"
      style={{ height: "var(--os-header-height)" }}
    >
      <h1 className="text-base font-semibold text-[var(--os-text)]">{title}</h1>

      <div className="flex items-center gap-3">
        <div className="hidden items-center gap-1 sm:flex">
          <button type="button" className="rounded p-1.5 text-[var(--os-text-muted)]" aria-label="Anterior">
            <ChevronLeft className="size-4" />
          </button>
          <span className="min-w-[8rem] text-center text-sm text-[var(--os-text-muted)]">
            {dateLabel}
          </span>
          <button type="button" className="rounded p-1.5 text-[var(--os-text-muted)]" aria-label="Siguiente">
            <ChevronRight className="size-4" />
          </button>
        </div>

        <button type="button" className="relative rounded-full p-2 text-[var(--os-text-muted)]" aria-label="Notificaciones">
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

export function OsStatusBar() {
  return (
    <footer
      className="flex shrink-0 items-center justify-between border-t border-[var(--os-border-subtle)] bg-[var(--os-bg)] px-8 text-[10px] text-[var(--os-text-muted)]"
      style={{ height: "var(--os-status-height)" }}
    >
      <span>SEMANAS 2026</span>
      <span>09:32</span>
    </footer>
  );
}
