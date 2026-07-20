"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/dialog";
import { usePreviewSession } from "@/features/os/session/preview-context";
import { fetchOsNotifications } from "@/lib/orders/orders-client";
import {
  dismissNotification,
  dismissReadNotifications,
  getNotificationsForSector,
  markNotificationRead,
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

type BellItem = OsNotification & { source?: "local" | "server" };

/** Campana: une notificaciones demo locales + notificaciones Neon de órdenes OE/OA. */
export function NotificationBell() {
  const { sectorId, email } = usePreviewSession();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<BellItem[]>([]);
  const [confirmDismissRead, setConfirmDismissRead] = useState(false);

  useEffect(() => {
    const loadLocal = () => {
      const local = getNotificationsForSector(sectorId).map((n) => ({
        ...n,
        source: "local" as const,
      }));
      setItems((prev) => {
        const server = prev.filter((p) => p.source === "server");
        const merged = [...server, ...local];
        const seen = new Set<string>();
        return merged.filter((n) => {
          if (seen.has(n.id)) return false;
          seen.add(n.id);
          return true;
        });
      });
    };
    loadLocal();
    return subscribeNotifications(loadLocal);
  }, [sectorId]);

  useEffect(() => {
    if (!email) return;
    let cancelled = false;
    const pull = async () => {
      try {
        const server = await fetchOsNotifications({ email, sector: sectorId });
        if (cancelled) return;
        const mapped: BellItem[] = server.map((n) => ({
          id: n.id,
          kind: n.kind as OsNotification["kind"],
          title: n.title,
          message: n.message,
          sectors: n.sectors,
          createdAt: n.createdAt,
          read: n.readBy.includes(email),
          dismissed: n.dismissedBy.includes(email),
          source: "server",
        }));
        setItems((prev) => {
          const local = prev.filter((p) => p.source !== "server");
          return [...mapped.filter((m) => !m.dismissed), ...local];
        });
      } catch {
        // Sin Neon u otros errores: se conservan notificaciones locales.
      }
    };
    void pull();
    const id = window.setInterval(() => void pull(), 30000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [email, sectorId]);

  const unreadCount = items.filter((n) => !n.read).length;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
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
              <p className="mt-0.5 text-[11px] text-[var(--os-text-muted)]">
                Descartar no elimina la orden asociada.
              </p>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {items.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-[var(--os-text-muted)]">
                  Sin notificaciones
                </p>
              ) : (
                <ul className="divide-y divide-[var(--os-border-subtle)]">
                  {items.map((n) => (
                    <li key={n.id} className="px-4 py-3">
                      <button
                        type="button"
                        className="w-full text-left"
                        onClick={() => {
                          if (n.source !== "server") markNotificationRead(n.id);
                          setItems((prev) =>
                            prev.map((x) => (x.id === n.id ? { ...x, read: true } : x))
                          );
                        }}
                      >
                        <p className={`text-sm ${n.read ? "font-normal" : "font-semibold"}`}>
                          {n.title}
                        </p>
                        <p className="mt-0.5 text-xs text-[var(--os-text-muted)]">{n.message}</p>
                        <p className="mt-1 text-[10px] text-[var(--os-text-muted)]">
                          {relativeTime(n.createdAt)}
                          {n.source === "server" ? " · servidor" : ""}
                        </p>
                      </button>
                      <button
                        type="button"
                        className="mt-1 text-[11px] text-[var(--os-teal)] hover:underline"
                        onClick={() => {
                          if (n.source !== "server") dismissNotification(n.id);
                          setItems((prev) => prev.filter((x) => x.id !== n.id));
                        }}
                      >
                        Descartar
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {items.some((n) => n.read && n.source !== "server") && (
              <div className="border-t border-[var(--os-border-subtle)] px-4 py-2">
                <button
                  type="button"
                  className="text-xs text-[var(--os-text-muted)] hover:underline"
                  onClick={() => setConfirmDismissRead(true)}
                >
                  Descartar leídas (locales)
                </button>
              </div>
            )}
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmDismissRead}
        onOpenChange={setConfirmDismissRead}
        title="Descartar leídas"
        description="Se ocultarán las notificaciones locales ya leídas. No elimina órdenes."
        confirmLabel="Descartar"
        onConfirm={() => {
          dismissReadNotifications(sectorId);
          setItems((prev) => prev.filter((n) => n.source === "server" || !n.read));
        }}
      />
    </div>
  );
}
