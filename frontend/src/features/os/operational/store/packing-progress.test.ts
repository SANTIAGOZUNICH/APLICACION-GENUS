import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyWorkProgressToItems,
  clearWorkProgress,
  recordWorkPackaging,
} from "./operational-store";
import type { WorkItem } from "@/types/operational/work-item";

describe("work progress packing overlay", () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    const localStorageMock = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
      clear: () => {
        for (const k of Object.keys(store)) delete store[k];
      },
    };
    vi.stubGlobal("localStorage", localStorageMock);
    vi.stubGlobal("window", { localStorage: localStorageMock });
  });

  afterEach(() => {
    clearWorkProgress();
    vi.unstubAllGlobals();
  });

  it("aplica packingGroups al WorkItem vía applyWorkProgressToItems", () => {
    recordWorkPackaging("wi-1", {
      updatedBy: "masivo",
      packagingLote: "L-CREMA",
      packagingVto: "30/07/2028",
      packagingTotalUnits: 952,
      packingGroups: [
        { cajas: 10, unidadesPorCaja: 20 },
        { cajas: 20, unidadesPorCaja: 20 },
        { cajas: 11, unidadesPorCaja: 32 },
      ],
      packagingCajas: 10,
      packagingUnidadesPorCaja: 20,
    });

    const base: WorkItem[] = [
      {
        id: "wi-1",
        sector: "ENVASADO_MASIVO",
        status: "en_curso",
        product: "CREMA TEST",
        client: "TEST_CLIENTE",
      } as WorkItem,
    ];

    const next = applyWorkProgressToItems(base);
    expect(next[0]?.packagingLote).toBe("L-CREMA");
    expect(next[0]?.packagingTotalUnits).toBe(952);
    expect(next[0]?.packingGroups).toEqual([
      { cajas: 10, unidadesPorCaja: 20 },
      { cajas: 20, unidadesPorCaja: 20 },
      { cajas: 11, unidadesPorCaja: 32 },
    ]);
  });
});
