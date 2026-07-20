import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dismissNotification,
  dismissReadNotifications,
  getNotificationsForSector,
  markNotificationRead,
  pushNotification,
} from "./notifications-store";

describe("notifications-store dismissal", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    const localStorageMock = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    };
    vi.stubGlobal("localStorage", localStorageMock);
    vi.stubGlobal("window", {
      localStorage: localStorageMock,
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  it("oculta descartadas y descarta todas las leídas por sector", () => {
    const first = pushNotification({
      kind: "trabajo_entregado",
      title: "Entregado",
      message: "Producto entregado",
      sectors: ["PRODUCCION"],
    });
    const second = pushNotification({
      kind: "trabajo_asignado",
      title: "Asignado",
      message: "Producto asignado",
      sectors: ["PRODUCCION"],
    });

    markNotificationRead(first.id);
    dismissReadNotifications("PRODUCCION");
    expect(getNotificationsForSector("PRODUCCION").map((item) => item.id)).toEqual([second.id]);

    dismissNotification(second.id);
    expect(getNotificationsForSector("PRODUCCION")).toEqual([]);
  });
});
