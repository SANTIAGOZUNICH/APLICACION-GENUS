import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkForChanges,
  getLiveSyncCheckMetrics,
  getRememberedSheetHash,
  getSemanasVersion,
  rememberSheetHash,
  resetOperationalSheetsWatcherForTests,
  setSemanasDigestReaderForTests,
} from "@/lib/live-sync/operational-sheets-watcher";

vi.mock("@/lib/adapters/drive/operations-document-repository", () => ({
  operationsDocumentRepository: {
    ensureOperationalReady: vi.fn(async () => undefined),
    tryGetCriticalSheetRef: vi.fn(async () => ({
      fileId: "semanas-test-id",
      name: "SEMANAS 2026",
    })),
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

describe("operational-sheets-watcher request-driven", () => {
  beforeEach(() => {
    resetOperationalSheetsWatcherForTests();
  });

  it("recuerda hash local", () => {
    rememberSheetHash("semanas_2026", "abc");
    expect(getRememberedSheetHash("semanas_2026")).toBe("abc");
  });

  it("check hash igual → changed false", async () => {
    setSemanasDigestReaderForTests(async () => ({
      hash: "same-hash",
      readDurationMs: 12,
      hashDurationMs: 1,
      tabs: [{ tab: "ELABORACION", rows: [["x"]] }],
    }));

    const first = await checkForChanges(null);
    expect(first.changed).toBe(false);
    const second = await checkForChanges("same-hash");
    expect(second.changed).toBe(false);
    expect(getLiveSyncCheckMetrics().hashUnchanged).toBe(1);
  });

  it("check hash distinto → changed true", async () => {
    setSemanasDigestReaderForTests(async () => ({
      hash: "new-hash",
      readDurationMs: 20,
      hashDurationMs: 1,
      tabs: [{ tab: "ELABORACION", rows: [["y"]] }],
    }));

    const result = await checkForChanges("old-hash");
    expect(result.changed).toBe(true);
    expect(getLiveSyncCheckMetrics().hashChanged).toBe(1);
  });

  it("múltiples checks simultáneos → una lectura Sheets + tabs reutilizables", async () => {
    let reads = 0;
    setSemanasDigestReaderForTests(async () => {
      reads += 1;
      await new Promise((r) => setTimeout(r, 30));
      return {
        hash: "shared",
        readDurationMs: 30,
        hashDurationMs: 1,
        tabs: [{ tab: "ELABORACION", rows: [["a"]] }],
      };
    });

    const [a, b, c] = await Promise.all([
      getSemanasVersion(),
      getSemanasVersion(),
      getSemanasVersion(),
    ]);

    expect(reads).toBe(1);
    expect(a.tabs[0]?.rows[0]?.[0]).toBe("a");
    expect(b.version).toBe("shared");
    expect(c.version).toBe("shared");
    expect(getLiveSyncCheckMetrics().sheetsReads).toBe(1);
    expect(getLiveSyncCheckMetrics().checksDeduped).toBeGreaterThanOrEqual(2);
  });
});
