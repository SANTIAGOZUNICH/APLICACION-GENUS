import type { SectorId } from "@/types/operational/sector";
import { localNotificationFingerprint } from "@/lib/orders/notification-event-keys";

/** @mock-temp Centro de notificaciones demo — localStorage. Tombstones evitan regeneración. */

const NOTIFICATIONS_KEY = "genus_os_notifications";
const TOMBSTONES_KEY = "genus_os_notifications_deleted";
const NOTIFICATIONS_EVENT = "genus_os_notifications_changed";
const MAX_NOTIFICATIONS = 200;

export type NotificationKind =
  | "trabajo_finalizado"
  | "calidad_aprobado"
  | "calidad_rechazado"
  | "mp_faltante"
  | "trabajo_atrasado"
  | "trabajo_asignado"
  | "trabajo_entregado"
  | "me_aviso";

export interface OsNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  message: string;
  sectors: SectorId[];
  createdAt: string;
  read: boolean;
  dismissed?: boolean;
}

function readAll(): OsNotification[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(NOTIFICATIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as OsNotification[];
    return parsed.map((item) => ({ ...item, dismissed: item.dismissed ?? false }));
  } catch {
    return [];
  }
}

function writeAll(items: OsNotification[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(items.slice(0, MAX_NOTIFICATIONS)));
  window.dispatchEvent(new Event(NOTIFICATIONS_EVENT));
}

function readTombstones(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(TOMBSTONES_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function writeTombstones(keys: Set<string>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOMBSTONES_KEY, JSON.stringify([...keys]));
}

export function pushNotification(input: {
  kind: NotificationKind;
  title: string;
  message: string;
  sectors: SectorId[];
}): OsNotification | null {
  const fp = localNotificationFingerprint(input);
  const tombs = readTombstones();
  if (tombs.has(fp) || tombs.has(`kind:${input.kind}`)) {
    return null;
  }
  const notification: OsNotification = {
    id: `ntf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: input.kind,
    title: input.title,
    message: input.message,
    sectors: input.sectors,
    createdAt: new Date().toISOString(),
    read: false,
    dismissed: false,
  };
  const items = [notification, ...readAll()];
  writeAll(items);
  return notification;
}

export function getNotificationsForSector(sectorId: SectorId): OsNotification[] {
  const tombs = readTombstones();
  return readAll()
    .filter((n) => {
      if (!n.sectors.includes(sectorId) || n.dismissed) return false;
      if (tombs.has(`id:${n.id}`)) return false;
      if (tombs.has(localNotificationFingerprint(n))) return false;
      return true;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function markNotificationRead(id: string): void {
  writeAll(readAll().map((n) => (n.id === id ? { ...n, read: true } : n)));
}

export function markSectorNotificationsRead(sectorId: SectorId): void {
  const items = readAll().map((n) => (n.sectors.includes(sectorId) ? { ...n, read: true } : n));
  writeAll(items);
}

export function dismissNotification(id: string): void {
  writeAll(readAll().map((n) => (n.id === id ? { ...n, dismissed: true, read: true } : n)));
}

export function dismissReadNotifications(sectorId: SectorId): void {
  const items = readAll().map((n) =>
    n.sectors.includes(sectorId) && n.read ? { ...n, dismissed: true } : n
  );
  writeAll(items);
}

/**
 * Eliminación definitiva local: limpia bandeja del sector y deja tombstones
 * para que pushNotification no regenere los mismos avisos.
 */
export function deleteAllNotificationsForSector(sectorId: SectorId): number {
  const tombs = readTombstones();
  const all = readAll();
  let count = 0;
  const remaining: OsNotification[] = [];
  for (const n of all) {
    if (!n.sectors.includes(sectorId)) {
      remaining.push(n);
      continue;
    }
    count += 1;
    tombs.add(`id:${n.id}`);
    tombs.add(localNotificationFingerprint(n));
  }
  writeTombstones(tombs);
  writeAll(remaining);
  return count;
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
