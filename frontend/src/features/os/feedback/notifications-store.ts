import type { SectorId } from "@/types/operational/sector";

/** @mock-temp Centro de notificaciones — demo persistida en localStorage, desacoplada de la UI. */

const NOTIFICATIONS_KEY = "genus_os_notifications";
const NOTIFICATIONS_EVENT = "genus_os_notifications_changed";
const MAX_NOTIFICATIONS = 200;

export type NotificationKind =
  | "trabajo_finalizado"
  | "calidad_aprobado"
  | "calidad_rechazado"
  | "mp_faltante"
  | "trabajo_atrasado"
  | "trabajo_asignado";

export interface OsNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  message: string;
  sectors: SectorId[];
  createdAt: string;
  read: boolean;
}

function readAll(): OsNotification[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(NOTIFICATIONS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as OsNotification[];
  } catch {
    return [];
  }
}

function writeAll(items: OsNotification[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(items.slice(0, MAX_NOTIFICATIONS)));
  window.dispatchEvent(new Event(NOTIFICATIONS_EVENT));
}

export function pushNotification(input: {
  kind: NotificationKind;
  title: string;
  message: string;
  sectors: SectorId[];
}): OsNotification {
  const notification: OsNotification = {
    id: `ntf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: input.kind,
    title: input.title,
    message: input.message,
    sectors: input.sectors,
    createdAt: new Date().toISOString(),
    read: false,
  };
  const items = [notification, ...readAll()];
  writeAll(items);
  return notification;
}

export function getNotificationsForSector(sectorId: SectorId): OsNotification[] {
  return readAll()
    .filter((n) => n.sectors.includes(sectorId))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function markSectorNotificationsRead(sectorId: SectorId): void {
  const items = readAll().map((n) => (n.sectors.includes(sectorId) ? { ...n, read: true } : n));
  writeAll(items);
}

export function subscribeNotifications(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => callback();
  window.addEventListener(NOTIFICATIONS_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(NOTIFICATIONS_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}
