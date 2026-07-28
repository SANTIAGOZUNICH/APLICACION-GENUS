"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/dialog";
import { usePreviewSession } from "@/features/os/session/preview-context";
import {
  dismissReadOsNotificationsApi,
  fetchOsNotifications,
  patchOsNotificationApi,
} from "@/lib/orders/orders-client";
import {
  dismissNotification as dismissLocalNotification,
  dismissReadNotifications as dismissLocalReadNotifications,
  getNotificationsForSector,
  markNotificationRead as markLocalNotificationRead,
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
type TabId = "activas" | "archivadas";

/** Campana: une notificaciones demo locales + notificaciones Neon de órdenes OE/OA. */
export function NotificationBell() {
  const { sectorId, email } = usePreviewSession();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TabId>("activas");
  const [activeItems, setActiveItems] = useState<BellItem[]>([]);
  const [archivedItems, setArchivedItems] = useState<BellItem[]>([]);
  const [confirmDismissRead, setConfirmDismissRead] = useState(false);

  const session = email ? { email, sector: sectorId } : null;

  useEffect(() => {
    const loadLocal = () => {
      const local = getNotificationsForSector(sectorId).map((n) => ({
        ...n,
        source: "local" as const,
      }));
      setActiveItems((prev) => {
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

  const pullServer = useCallback(async () => {
    if (!session) return;
    try {
      const [active, archived] = await Promise.all([
        fetchOsNotifications(session, { includeDismissed: false }),
        fetchOsNotifications(session, { includeDismissed: true }),
      ]);
      const mapServer = (list: typeof active, dismissed: boolean): BellItem[] =>
        list.map((n) => ({
          id: n.id,
          kind: n.kind as OsNotification["kind"],
          title: n.title,
          message: n.message,
          sectors: n.sectors,
          createdAt: n.createdAt,
          read: n.readBy.includes(session.email),
          dismissed,
          source: "server" as const,
        }));

      setActiveItems((prev) => {
        const local = prev.filter((p) => p.source !== "server");
        return [...mapServer(active, false), ...local];
      });
      setArchivedItems(mapServer(archived, true));
    } catch {
      // Sin Neon u otros errores: se conservan notificaciones locales.
    }
  }, [session]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const run = async () => {
      await pullServer();
      if (cancelled) return;
    };
    void run();
    const id = window.setInterval(() => void pullServer(), 30000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [session, pullServer]);

  const items = tab === "activas" ? activeItems : archivedItems;
  const unreadCount = activeItems.filter((n) => !n.read).length;

  async function handleMarkRead(n: BellItem) {
    if (n.source === "server" && session) {
      try {
        await patchOsNotificationApi(session, n.id, "read");
      } catch {
        // Optimistic UI anyway
      }
    } else {
      markLocalNotificationRead(n.id);
    }
    const mark = (list: BellItem[]) =>
      list.map((x) => (x.id === n.id ? { ...x, read: true } : x));
    setActiveItems(mark);
    setArchivedItems(mark);
  }

  async function handleDismiss(n: BellItem) {
    if (n.source === "server" && session) {
      try {
        await patchOsNotificationApi(session, n.id, "dismiss");
      } catch {
        return;
      }
      setActiveItems((prev) => prev.filter((x) => x.id !== n.id));
      setArchivedItems((prev) => [
        { ...n, dismissed: true, read: true },
        ...prev.filter((x) => x.id !== n.id),
      ]);
    } else {
      dismissLocalNotification(n.id);
      setActiveItems((prev) => prev.filter((x) => x.id !== n.id));
    }
  }

  async function handleRestore(n: BellItem) {
    if (n.source === "server" && session) {
      try {
        await patchOsNotificationApi(session, n.id, "restore");
      } catch {
        return;
      }
      setArchivedItems((prev) => prev.filter((x) => x.id !== n.id));
      setActiveItems((prev) => [{ ...n, dismissed: false }, ...prev.filter((x) => x.id !== n.id)]);
    }
  }

  async function handleDismissRead() {
    const hasServerRead = activeItems.some((n) => n.read && n.source === "server");
    const hasLocalRead = activeItems.some((n) => n.read && n.source !== "server");
    if (hasServerRead && session) {
      try {
        await dismissReadOsNotificationsApi(session);
      } catch {
        // fall through for local
      }
    }
    if (hasLocalRead) dismissLocalReadNotifications(sectorId);
    setActiveItems((prev) => prev.filter((n) => !n.read));
    void pullServer();
  }

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
          <span
            key={unreadCount}
            className="os-pulse-success absolute right-1.5 top-1.5 flex size-4 items-center justify-center rounded-full bg-[var(--genus-error,#b91c1c)] text-[9px] font-bold text-white"
          >
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
              <div className="mt-2 flex gap-1">
                {(["activas", "archivadas"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`rounded px-2 py-0.5 text-[11px] capitalize ${
                      tab === t
                        ? "bg-[var(--os-teal)] text-white"
                        : "text-[var(--os-text-muted)] hover:bg-[var(--os-bg)]"
                    }`}
                    onClick={() => setTab(t)}
                  >
                    {t === "activas" ? "Activas" : "Archivadas"}
                  </button>
                ))}
              </div>
            </div>
            <div className="os-scroll-main max-h-96 overflow-y-auto">
              {items.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-[var(--os-text-muted)]">
                  {tab === "activas" ? "Sin notificaciones" : "Sin archivadas"}
                </p>
              ) : (
                <ul className="divide-y divide-[var(--os-border-subtle)]">
                  {items.map((n) => (
                    <li key={n.id} className="px-4 py-3">
                      <button
                        type="button"
                        className="w-full text-left"
                        onClick={() => void handleMarkRead(n)}
                      >
                        <p className={`text-sm ${n.read ? "font-normal" : "font-semibold"}`}>
                          {n.title}
                        </p>
                        <p className="mt-0.5 text-xs text-[var(--os-text-muted)]">{n.message}</p>
                        <p className="mt-1 text-[10px] text-[var(--os-text-muted)]">
                          {relativeTime(n.createdAt)}
                          {n.source === "server" ? " · servidor" : " · demo"}
                        </p>
                      </button>
                      {tab === "activas" ? (
                        <button
                          type="button"
                          className="mt-1 text-[11px] text-[var(--os-teal)] hover:underline"
                          onClick={() => void handleDismiss(n)}
                        >
                          Descartar
                        </button>
                      ) : n.source === "server" ? (
                        <button
                          type="button"
                          className="mt-1 text-[11px] text-[var(--os-teal)] hover:underline"
                          onClick={() => void handleRestore(n)}
                        >
                          Restaurar
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {tab === "activas" && activeItems.some((n) => n.read) && (
              <div className="border-t border-[var(--os-border-subtle)] px-4 py-2">
                <button
                  type="button"
                  className="text-xs text-[var(--os-text-muted)] hover:underline"
                  onClick={() => setConfirmDismissRead(true)}
                >
                  Descartar leídas
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
        description="Se archivarán las notificaciones ya leídas. No elimina órdenes."
        confirmLabel="Descartar"
        onConfirm={() => {
          void handleDismissRead();
          setConfirmDismissRead(false);
        }}
      />
    </div>
  );
}
