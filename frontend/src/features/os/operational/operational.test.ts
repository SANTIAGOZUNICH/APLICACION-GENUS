import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  buildOperationalActivityFeed,
  mergeQualityItemsWithCompletions,
  qualityItemIdForWorkItem,
  workItemToCompletionEvent,
} from "./lib/completion-events";
import {
  filterQualityByKind,
  filterQualityByStatus,
  filterQualityToday,
  filterWorkItemsCompletedElaboracion,
  filterWorkItemsPendingElaboracion,
  filterWorkItemsPendingEnvasado,
} from "./lib/operational-filters";
import { mockQualityItems, mockWorkItemsForSector } from "./mock/mock-operational-plan";
import {
  clearOperationalStore,
  getEffectiveQualityStatus,
  getEffectiveWorkStatus,
  getWorkFinishedQty,
  readCompletionEvents,
  recordQualityDecision,
  recordWorkCompletion,
  recordWorkProgress,
} from "./store/operational-store";
import {
  formatOperationalDifference,
  parseOperationalQuantity,
  plannedQuantityLabel,
} from "./lib/operational-progress";

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
    clearOperationalStore();
  });

  it("persiste aprobación y rechazo con observación", () => {
    recordQualityDecision("q-granel-1", "aprobado", {
      decidedBy: "Lucía",
      observation: "Conforme",
    });
    expect(getEffectiveQualityStatus("q-granel-1", "pendiente")).toBe("aprobado");

    recordQualityDecision("q-salida-1", "rechazado", { decidedBy: "Lucía" });
    expect(getEffectiveQualityStatus("q-salida-1", "pendiente")).toBe("rechazado");
  });

  it("persiste avance y marca terminado", () => {
    recordWorkProgress("wi-1", {
      finishedQty: "100",
      observation: "OK",
      status: "en_curso",
    });
    expect(getEffectiveWorkStatus("wi-1", "pendiente")).toBe("en_curso");
    expect(getWorkFinishedQty("wi-1")).toBe("100");

    recordWorkProgress("wi-1", {
      finishedQty: "120",
      observation: "Cierre",
      status: "completo",
    });
    expect(getEffectiveWorkStatus("wi-1", "pendiente")).toBe("completo");
  });

  it("recordWorkCompletion emite evento cross-sector", () => {
    const item = mockWorkItemsForSector("ENVASADO_MASIVO")[0]!;
    const { event } = recordWorkCompletion(item, {
      finishedQty: "3300",
      observation: "Lote cerrado",
      completedBy: "Operario Masivo",
    });

    expect(getEffectiveWorkStatus(item.id, item.status)).toBe("completo");
    expect(readCompletionEvents()).toHaveLength(1);
    expect(event.workItemId).toBe(item.id);
    expect(event.sourceSector).toBe("ENVASADO_MASIVO");
    expect(event.completedBy).toBe("Operario Masivo");
  });
});

describe("completion-events", () => {
  it("convierte terminado en ítem Calidad pendiente", () => {
    const item = mockWorkItemsForSector("ELABORACION", "Cristian")[0]!;
    const event = workItemToCompletionEvent(item, {
      finishedQty: "120",
      observation: "Listo",
      completedBy: "Cristian",
      completedAt: "2026-07-01T12:00:00.000Z",
    });

    const merged = mergeQualityItemsWithCompletions(mockQualityItems(), [event]);
    const received = merged.find((q) => q.id === qualityItemIdForWorkItem(item.id));

    expect(received).toBeDefined();
    expect(received?.kind).toBe("granel");
    expect(received?.status).toBe("pendiente");
    expect(received?.receivedFrom).toBe("ELABORACION");
    expect(received?.completedBy).toBe("Cristian");
  });

  it("arma feed de actividad con terminados y decisiones", () => {
    const item = mockWorkItemsForSector("ENVASADO_PREMIUM")[0]!;
    const event = workItemToCompletionEvent(item, {
      finishedQty: "500",
      observation: "",
      completedBy: "Premium",
      completedAt: "2026-07-01T14:00:00.000Z",
    });

    const feed = buildOperationalActivityFeed({
      completions: [event],
      decisions: [
        {
          itemId: "q-granel-1",
          status: "aprobado",
          decidedAt: "2026-07-01T15:00:00.000Z",
          decidedBy: "Lucía",
          label: "Serum Niacinamida",
        },
      ],
    });

    expect(feed).toHaveLength(2);
    expect(feed[0]?.type).toBe("quality_approve");
    expect(feed[1]?.type).toBe("completion");
  });

  it("filtra elaboraciones terminadas para Producción", () => {
    const items = mockWorkItemsForSector("PRODUCCION").map((item, index) =>
      index === 0 ? { ...item, status: "completo" as const } : item
    );
    const completed = filterWorkItemsCompletedElaboracion(items);
    expect(completed.some((i) => i.status === "completo")).toBe(true);
    expect(filterWorkItemsPendingElaboracion(items).every((i) => i.status !== "completo")).toBe(
      true
    );
  });
});

describe("operational-progress", () => {
  it("calcula diferencia planificada vs terminada", () => {
    expect(formatOperationalDifference("3300", "3200")).toBe("-100");
    expect(formatOperationalDifference("120 kg", "120")).toBe("0");
    expect(plannedQuantityLabel("90", "kg")).toBe("90 kg");
    expect(parseOperationalQuantity("1.200 u")).toBe(1200);
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
