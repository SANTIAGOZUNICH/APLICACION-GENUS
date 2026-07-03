import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  filterQualityByKind,
  filterQualityByStatus,
  filterQualityToday,
  filterWorkItemsPendingElaboracion,
  filterWorkItemsPendingEnvasado,
} from "./lib/operational-filters";
import { mockQualityItems, mockWorkItemsForSector } from "./mock/mock-operational-plan";
import {
  clearOperationalDecisions,
  getEffectiveQualityStatus,
  recordQualityDecision,
} from "./store/operational-store";

describe("operational-filters", () => {
  it("filtra elaboración por persona en mock", () => {
    const cristian = mockWorkItemsForSector("ELABORACION", "Cristian");
    const nicolas = mockWorkItemsForSector("ELABORACION", "Nicolás");

    expect(cristian.every((item) => item.ownerPerson === "Cristian")).toBe(true);
    expect(nicolas.every((item) => item.ownerPerson === "Nicolás")).toBe(true);
    expect(cristian).toHaveLength(2);
    expect(nicolas).toHaveLength(2);
  });

  it("separa envasado masivo y premium", () => {
    const masivo = mockWorkItemsForSector("ENVASADO_MASIVO");
    const premium = mockWorkItemsForSector("ENVASADO_PREMIUM");

    expect(masivo.every((i) => i.sector === "ENVASADO_MASIVO")).toBe(true);
    expect(premium.every((i) => i.sector === "ENVASADO_PREMIUM")).toBe(true);
  });

  it("filtra calidad por kind y status", () => {
    const items = mockQualityItems();
    const granelesHoy = filterQualityToday(filterQualityByKind(items, "granel"));
    const rechazados = filterQualityByStatus(items, "rechazado");

    expect(granelesHoy.length).toBeGreaterThan(0);
    expect(rechazados.some((i) => i.id === "q-salida-3")).toBe(true);
  });

  it("filtra pendientes elaboración y envasado", () => {
    const all = mockWorkItemsForSector("PRODUCCION");
    expect(filterWorkItemsPendingElaboracion(all).length).toBeGreaterThan(0);
    expect(filterWorkItemsPendingEnvasado(all).length).toBeGreaterThan(0);
  });
});

describe("operational-store", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    const localStorageMock = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    };
    vi.stubGlobal("localStorage", localStorageMock);
    vi.stubGlobal("window", { localStorage: localStorageMock });
    clearOperationalDecisions();
  });

  it("persiste aprobación y rechazo", () => {
    recordQualityDecision("q-granel-1", "aprobado", "Lucía");
    expect(getEffectiveQualityStatus("q-granel-1", "pendiente")).toBe("aprobado");

    recordQualityDecision("q-salida-1", "rechazado", "Lucía");
    expect(getEffectiveQualityStatus("q-salida-1", "pendiente")).toBe("rechazado");
  });
});

describe("mock users elaboración", () => {
  it("expone usuarios Cristian y Nicolás", async () => {
    const { MOCK_PREVIEW_USERS } = await import("@/features/os/auth/lib/mock-preview-users");
    const cristian = MOCK_PREVIEW_USERS.find((u) => u.email.includes("cristian"));
    const nicolas = MOCK_PREVIEW_USERS.find((u) => u.email.includes("nicolas"));

    expect(cristian?.ownerPerson).toBe("Cristian");
    expect(nicolas?.ownerPerson).toBe("Nicolás");
    expect(cristian?.sector).toBe("ELABORACION");
  });
});
