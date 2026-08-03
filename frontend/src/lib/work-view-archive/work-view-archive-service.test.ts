/**
 * Archivar de mi vista — filtro + servicio memoria (no borra work items).
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createManualWorkItem,
  getManualWorkItemById,
  listAllManualWorkItems,
  mergeManualWorkItems,
} from "@/features/os/operational/adapters/manual-work-items-repository";
import {
  excludeArchivedFromView,
  onlyArchivedFromView,
} from "@/lib/work-view-archive";
import {
  getWorkViewArchiveService,
  resetWorkViewArchiveMemoryForTests,
} from "@/lib/work-view-archive/work-view-archive-service";

describe("work-view-archive filter", () => {
  const items = [
    { id: "w1", product: "A" },
    { id: "w2", product: "B" },
    { id: "w3", product: "C" },
  ];

  it("archive hides from main list filter helper", () => {
    const archived = ["w2"];
    expect(excludeArchivedFromView(items, archived).map((i) => i.id)).toEqual([
      "w1",
      "w3",
    ]);
    expect(onlyArchivedFromView(items, archived).map((i) => i.id)).toEqual(["w2"]);
  });

  it("restore brings back (empty archive set shows all)", () => {
    expect(excludeArchivedFromView(items, []).map((i) => i.id)).toEqual([
      "w1",
      "w2",
      "w3",
    ]);
    expect(onlyArchivedFromView(items, []).map((i) => i.id)).toEqual([]);
  });
});

describe("WorkViewArchiveService", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    resetWorkViewArchiveMemoryForTests();
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
  });

  it("archive then restore updates list ids; does not delete work item from manual repo", async () => {
    const item = createManualWorkItem({
      sector: "ENVASADO_MASIVO",
      ownerPerson: null,
      line: "1",
      client: "Cliente Test",
      product: "Producto Test",
      plannedDate: "2026-07-24",
      deliveryDate: "2026-07-30",
      quantity: "100",
      unit: "un",
      oeRef: null,
      oaRef: null,
      notes: null,
      assignedBy: "Produccion",
    });

    expect(listAllManualWorkItems().map((w) => w.id)).toContain(item.id);
    expect(mergeManualWorkItems("ENVASADO_MASIVO", []).map((w) => w.id)).toContain(
      item.id
    );

    const svc = getWorkViewArchiveService();
    const actor = {
      email: "emasivo@laboratoriogenus.com.ar",
      sector: "ENVASADO_MASIVO" as const,
    };

    await svc.archive(actor, "ENVASADO_MASIVO", item.id);
    const ids = await svc.listWorkItemIds(actor, "ENVASADO_MASIVO");
    expect(ids).toContain(item.id);

    const main = excludeArchivedFromView(
      mergeManualWorkItems("ENVASADO_MASIVO", []),
      ids
    );
    expect(main.map((w) => w.id)).not.toContain(item.id);

    const archivedOnly = onlyArchivedFromView(
      mergeManualWorkItems("ENVASADO_MASIVO", []),
      ids
    );
    expect(archivedOnly.map((w) => w.id)).toContain(item.id);

    // Registro operativo intacto
    expect(getManualWorkItemById(item.id)?.id).toBe(item.id);
    expect(listAllManualWorkItems().map((w) => w.id)).toContain(item.id);

    await svc.restore(actor, "ENVASADO_MASIVO", item.id);
    const after = await svc.listWorkItemIds(actor, "ENVASADO_MASIVO");
    expect(after).not.toContain(item.id);
    expect(
      excludeArchivedFromView(
        mergeManualWorkItems("ENVASADO_MASIVO", []),
        after
      ).map((w) => w.id)
    ).toContain(item.id);
  });

  it("archivo es por actor email (otro actor sigue viendo)", async () => {
    const svc = getWorkViewArchiveService();
    await svc.archive(
      { email: "emasivo@laboratoriogenus.com.ar", sector: "ENVASADO_MASIVO" },
      "ENVASADO_MASIVO",
      "shared-work-1"
    );
    const other = await svc.listWorkItemIds(
      { email: "other@laboratoriogenus.com.ar", sector: "ENVASADO_MASIVO" },
      "ENVASADO_MASIVO"
    );
    expect(other).not.toContain("shared-work-1");
  });
});
