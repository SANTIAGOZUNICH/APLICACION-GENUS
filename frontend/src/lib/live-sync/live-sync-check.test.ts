import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

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

vi.mock("@/lib/adapters/drive/drive-folder-config", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/adapters/drive/drive-folder-config")
  >("@/lib/adapters/drive/drive-folder-config");
  return {
    ...actual,
    getCriticalSheetFastPathId: vi.fn(() => "semanas-test-id"),
  };
});

vi.mock("@/lib/adapters/drive/cache/server-cache", () => ({
  serverCache: {
    deleteByPrefix: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock("@/lib/parsers/load-operational-pipeline", () => ({
  loadOperationalPipeline: vi.fn(async () => ({
    workItems: [],
    qualityItems: [],
    warnings: [],
    sourcesIndexed: {
      semanas_2026: true,
      pedidos_2026: false,
      asignacion_lotes_2026: false,
    },
  })),
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
  resetOperationalSheetsWatcherForTests,
  setSemanasDigestReaderForTests,
} from "@/lib/live-sync/operational-sheets-watcher";
import { shouldAcceptLiveSyncUpdate } from "@/lib/live-sync/live-sync-version";
import type { WorkItem } from "@/types/operational/work-item";

/** Geometría Flujo A: B536 quantity bajo Rama Nicolás. */
function probioticRows(qty: string): string[][] {
  return [
    ["", "Lunes", "", "Martes", "", "Miércoles", "", "Jueves", "", "Viernes"],
    ["", "14", "", "15", "", "16", "", "17", "", "18"],
    ["", "Julio", "", "Julio", "", "Julio", "", "Julio", "", "Julio"],
    ["", "NICOLAS"],
    ["", "NIZA", "", "", "", "", "", "", "", ""],
    ["", "PROBIOTONIC BALANCE", "", "", "", "", "", "", "", ""],
    ["", qty, "", "", "", "", "", "", "", ""],
  ];
}

function hashTabs(tabs: { tab: string; rows: string[][] }[]): string {
  const parts = tabs.map(
    (t) =>
      `${t.tab}::${t.rows.map((r) => r.map((c) => String(c ?? "")).join("\t")).join("\n")}`
  );
  return createHash("sha256").update(parts.join("\n")).digest("hex");
}

function tabsWithQty(qty: string) {
  return [
    { tab: "ELABORACION", rows: probioticRows(qty) },
    { tab: "ACONDICIONAMIENTO", rows: [] as string[][] },
  ];
}

describe("live-sync check hot path (bug 160→161)", () => {
  beforeEach(() => {
    resetOperationalSheetsWatcherForTests();
    resetLiveSyncEngineCheckStateForTests();
    liveSyncStore.resetForTests();
  });

  it("hash distinto → changed + WorkItem PROBIOTONIC 161KG sin pipeline completo", async () => {
    const tabs160 = tabsWithQty("160KG");
    const tabs161 = tabsWithQty("161KG");
    const v160 = hashTabs(tabs160);
    const v161 = hashTabs(tabs161);

    setSemanasDigestReaderForTests(async () => ({
      hash: v160,
      readDurationMs: 5,
      hashDurationMs: 1,
      tabs: tabs160,
    }));

    const baseline = await liveSyncEngine.check({
      sector: "ELABORACION",
      ownerPerson: "Nicolás",
      knownVersion: null,
    });
    expect(baseline.version).toBe(v160);

    resetOperationalSheetsWatcherForTests();
    resetLiveSyncEngineCheckStateForTests();
    setSemanasDigestReaderForTests(async () => ({
      hash: v161,
      readDurationMs: 5,
      hashDurationMs: 1,
      tabs: tabs161,
    }));

    const result = await liveSyncEngine.check({
      sector: "ELABORACION",
      ownerPerson: "Nicolás",
      knownVersion: v160,
    });

    expect(result.changed).toBe(true);
    expect(result.version).toBe(v161);
    expect(result.workItems).toBeDefined();

    const probiotic = result.workItems!.find((i) =>
      String(i.product ?? "").toUpperCase().includes("PROBIOTONIC")
    );
    expect(probiotic?.quantity).toBe("161KG");
    expect(result.metrics.parseDurationMs).toBeLessThan(2000);
  });

  it("cliente aplica 161KG sin /work-items y rechaza stale 160KG", async () => {
    const tabs161 = tabsWithQty("161KG");
    const v161 = hashTabs(tabs161);

    setSemanasDigestReaderForTests(async () => ({
      hash: v161,
      readDurationMs: 4,
      hashDurationMs: 1,
      tabs: tabs161,
    }));

    const result = await liveSyncEngine.check({
      sector: "ELABORACION",
      ownerPerson: "Nicolás",
      knownVersion: "hash-160-old",
    });

    expect(result.changed).toBe(true);
    let applied: WorkItem[] = [];
    let appliedRevision = 0;
    let appliedVersion = "";

    if (
      result.changed &&
      result.workItems &&
      shouldAcceptLiveSyncUpdate({
        appliedRevision: null,
        appliedVersion: null,
        incomingRevision: result.revision,
        incomingVersion: result.version,
      })
    ) {
      applied = result.workItems;
      appliedRevision = result.revision;
      appliedVersion = result.version;
    }

    expect(
      applied.find((i) => String(i.product ?? "").toUpperCase().includes("PROBIOTONIC"))
        ?.quantity
    ).toBe("161KG");

    const staleAccept = shouldAcceptLiveSyncUpdate({
      appliedRevision,
      appliedVersion,
      incomingRevision: appliedRevision - 1,
      incomingVersion: "hash-160-old",
    });
    expect(staleAccept).toBe(false);
    expect(appliedVersion).toBe(v161);
  });

  it("Producción recibe proyección 161KG en la misma request", async () => {
    const tabs161 = tabsWithQty("161KG");
    const v161 = hashTabs(tabs161);

    setSemanasDigestReaderForTests(async () => ({
      hash: v161,
      readDurationMs: 4,
      hashDurationMs: 1,
      tabs: tabs161,
    }));

    const result = await liveSyncEngine.check({
      sector: "PRODUCCION",
      knownVersion: "prev",
    });

    expect(result.changed).toBe(true);
    const probiotic = result.workItems!.find(
      (i) =>
        String(i.product ?? "").toUpperCase().includes("PROBIOTONIC") &&
        String(i.ownerPerson ?? "").includes("Nicol")
    );
    expect(probiotic?.quantity).toBe("161KG");
  });

  it("hash igual → no parse / sin workItems de cambio", async () => {
    const tabs = tabsWithQty("160KG");
    const version = hashTabs(tabs);

    setSemanasDigestReaderForTests(async () => ({
      hash: version,
      readDurationMs: 3,
      hashDurationMs: 1,
      tabs,
    }));

    await liveSyncEngine.check({
      sector: "ELABORACION",
      ownerPerson: "Nicolás",
      knownVersion: null,
    });

    const unchanged = await liveSyncEngine.check({
      sector: "ELABORACION",
      ownerPerson: "Nicolás",
      knownVersion: version,
    });

    expect(unchanged.changed).toBe(false);
    expect(unchanged.workItems).toBeUndefined();
    expect(unchanged.metrics.parseDurationMs).toBe(0);
  });

  it("múltiples checks simultáneos comparten una lectura/parse", async () => {
    let reads = 0;
    const tabs = tabsWithQty("161KG");
    const version = hashTabs(tabs);

    setSemanasDigestReaderForTests(async () => {
      reads += 1;
      await new Promise((r) => setTimeout(r, 30));
      return {
        hash: version,
        readDurationMs: 30,
        hashDurationMs: 1,
        tabs,
      };
    });

    const results = await Promise.all([
      liveSyncEngine.check({ sector: "ELABORACION", ownerPerson: "Nicolás", knownVersion: "old" }),
      liveSyncEngine.check({ sector: "ELABORACION", ownerPerson: "Nicolás", knownVersion: "old" }),
      liveSyncEngine.check({ sector: "PRODUCCION", knownVersion: "old" }),
    ]);

    expect(reads).toBe(1);
    expect(results.every((r) => r.changed && r.version === version)).toBe(true);
    expect(results[0]!.workItems!.some((i) => i.quantity === "161KG")).toBe(true);
  });
});
