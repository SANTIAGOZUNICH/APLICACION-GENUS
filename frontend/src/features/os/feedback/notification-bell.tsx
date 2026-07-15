"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { usePreviewSession } from "@/features/os/session/preview-context";
import {
  getNotificationsForSector,
  markSectorNotificationsRead,
  subscribeNotifications,
  type OsNotification,
} from "./notifications-store";

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "recién";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return new Date(iso).toLocaleDateString("es-AR");
}

/** Campana de notificaciones — filtrada por sector destinatario, persistida en localStorage. */
export function NotificationBell() {
  const { sectorId } = usePreviewSession();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<OsNotification[]>([]);

  useEffect(() => {
    const load = () => setItems(getNotificationsForSector(sectorId));
    load();
    return subscribeNotifications(load);
  }, [sectorId]);

  const unreadCount = items.filter((n) => !n.read).length;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          if (!open && unreadCount > 0) markSectorNotificationsRead(sectorId);
        }}
        className="relative rounded-full p-2 text-[var(--os-text-muted)] transition-colors hover:bg-[var(--os-bg)] hover:text-[var(--os-text)]"
        aria-label={`Notificaciones${unreadCount > 0 ? ` (${unreadCount} sin leer)` : ""}`}
        aria-expanded={open}
      >
        <Bell className="size-5" />
        {unreadCount > 0 && (
          <span className="absolute right-1.5 top-1.5 flex size-4 items-center justify-center rounded-full bg-[var(--genus-error,#b91c1c)] text-[9px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-label="Notificaciones"
            className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[90vw] rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] shadow-[var(--os-shadow-card)]"
          >
            <div className="border-b border-[var(--os-border-subtle)] px-4 py-3">
              <p className="text-sm font-semibold text-[var(--os-text)]">Notificaciones</p>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {items.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-[var(--os-text-muted)]">
                  Sin notificaciones.
                </p>
              ) : (
                items.slice(0, 30).map((n) => (
                  <div
                    key={n.id}
                    className={`border-b border-[var(--os-border-subtle)] px-4 py-3 last:border-b-0 ${
                      n.read ? "" : "bg-[var(--os-teal-soft)]/40"
                    }`}
                  >
                    <p className="text-sm font-medium text-[var(--os-text)]">{n.title}</p>
                    <p className="mt-0.5 text-xs text-[var(--os-text-muted)]">{n.message}</p>
                    <p className="mt-1 text-[11px] text-[var(--os-text-muted)]">
                      {relativeTime(n.createdAt)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
