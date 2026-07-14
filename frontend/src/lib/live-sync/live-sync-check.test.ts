import { beforeEach, describe, expect, it, vi } from "vitest";

const rebuildCalls: string[] = [];

vi.mock("@/lib/adapters/drive/operations-document-repository", () => ({
  operationsDocumentRepository: {
    ensureOperationalReady: vi.fn(async () => undefined),
    tryGetCriticalSheetRef: vi.fn(async () => ({
      fileId: "semanas-test-id",
      name: "SEMANAS 2026",
    })),
    isBackgroundIndexInFlight: vi.fn(() => false),
  },
}));

vi.mock("@/lib/adapters/drive/cache/server-cache", () => ({
  serverCache: {
    deleteByPrefix: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock("@/lib/parsers/load-operational-pipeline", () => ({
  loadOperationalPipeline: vi.fn(async () => {
    rebuildCalls.push("rebuild");
    return {
      workItems: [
        {
          id: "wi-probiotic",
          sector: "ELABORACION",
          ownerSector: "ELABORACION",
          ownerPerson: "Nicolás",
          source: "semanas_2026",
          sourceFileId: "semanas-test-id",
          sourceSheet: "ELABORACION",
          sourceRange: "ELABORACION!537:2",
          productSourceRange: "ELABORACION!535:2",
          quantitySourceRange: "ELABORACION!536:2",
          originStage: "ELABORACION",
          date: null,
          plannedDate: "2026-07-14",
          dayLabel: null,
          dayOfWeek: null,
          weekLabel: null,
          weekStart: null,
          weekId: null,
          client: "Cliente",
          product: "PROBIOTONIC BALANCE",
          quantity: "161KG",
          unit: null,
          line: null,
          deliveryDate: null,
          status: "pendiente",
          priority: "NORMAL",
          pedidoRef: null,
          oeRef: null,
          oaRef: null,
          loteRef: null,
          notes: null,
          actionLabel: "Abrir OE",
          href: null,
          confidence: "high",
          createdFrom: "test",
          generatedEntities: [],
          dependsOn: null,
          blockedBy: null,
          unblocks: null,
        },
      ],
      qualityItems: [],
      warnings: [],
      sourcesIndexed: {
        semanas_2026: true,
        pedidos_2026: false,
        asignacion_lotes_2026: false,
      },
    };
  }),
}));

vi.mock("@/lib/config/data-mode", () => ({
  getServerDataMode: () => "demo",
}));

vi.mock("@/lib/live-sync/operational-event-bus", () => ({
  operationalEventBus: {
    publish: vi.fn(),
    subscriberCount: 0,
  },
}));

import { liveSyncStore } from "@/lib/live-sync/live-sync-store";
import {
  liveSyncEngine,
  resetLiveSyncEngineCheckStateForTests,
} from "@/lib/live-sync/live-sync-engine";
import {
  rememberSheetHash,
  resetOperationalSheetsWatcherForTests,
  setSemanasDigestReaderForTests,
} from "@/lib/live-sync/operational-sheets-watcher";
import { operationalEventBus } from "@/lib/live-sync/operational-event-bus";

describe("live-sync check orchestration", () => {
  beforeEach(() => {
    rebuildCalls.length = 0;
    resetOperationalSheetsWatcherForTests();
    resetLiveSyncEngineCheckStateForTests();
    liveSyncStore.resetForTests();
    vi.mocked(operationalEventBus.publish).mockClear();
  });

  it("hash igual → no rebuild", async () => {
    setSemanasDigestReaderForTests(async () => ({
      hash: "v-stable",
      readDurationMs: 10,
    }));

    liveSyncStore.setSnapshot({
      revision: 3,
      updatedAt: new Date().toISOString(),
      sheetsSyncedAt: new Date().toISOString(),
      workItems: [],
      qualityItems: [],
      warnings: [],
      sourcesIndexed: {
        semanas_2026: true,
        pedidos_2026: false,
        asignacion_lotes_2026: false,
      },
    });
    rememberSheetHash("semanas_2026", "v-stable");

    const result = await liveSyncEngine.check("v-stable");
    expect(result.changed).toBe(false);
    expect(result.version).toBe("v-stable");
    expect(rebuildCalls.length).toBe(0);
  });

  it("hash distinto → rebuild + SSE snapshot.updated", async () => {
    setSemanasDigestReaderForTests(async () => ({
      hash: "v1",
      readDurationMs: 15,
    }));
    await liveSyncEngine.check(null);

    resetOperationalSheetsWatcherForTests();
    resetLiveSyncEngineCheckStateForTests();
    setSemanasDigestReaderForTests(async () => ({
      hash: "v2",
      readDurationMs: 15,
    }));

    const result = await liveSyncEngine.check("v1");
    expect(result.changed).toBe(true);
    expect(result.version).toBe("v2");
    expect(rebuildCalls.length).toBeGreaterThanOrEqual(1);
    expect(operationalEventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: "snapshot.updated" })
    );
  });

  it("checks simultáneos comparten una sola orquestación/rebuild", async () => {
    let reads = 0;
    setSemanasDigestReaderForTests(async () => {
      reads += 1;
      await new Promise((r) => setTimeout(r, 40));
      return { hash: "v-parallel", readDurationMs: 40 };
    });

    const results = await Promise.all([
      liveSyncEngine.check("old"),
      liveSyncEngine.check("old"),
      liveSyncEngine.check("old"),
    ]);

    expect(reads).toBe(1);
    expect(results.every((r) => r.changed && r.version === "v-parallel")).toBe(true);
    expect(rebuildCalls.length).toBe(1);
  });

  it("WorkItem filtrable por sector/persona tras cambio", async () => {
    setSemanasDigestReaderForTests(async () => ({
      hash: "v-item",
      readDurationMs: 8,
    }));

    const check = await liveSyncEngine.check("prev");
    expect(check.changed).toBe(true);

    const listed = await liveSyncEngine.listForSector("ELABORACION", {
      ownerPerson: "Nicolás",
      date: "2026-07-14",
    });

    expect(listed.workItems).toHaveLength(1);
    expect(listed.workItems[0]?.quantity).toBe("161KG");
    expect(listed.ownerPerson).toBe("Nicolás");
  });
});
