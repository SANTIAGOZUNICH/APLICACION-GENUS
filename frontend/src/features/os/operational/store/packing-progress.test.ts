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

  it("un work item nativo (native:<uuid>) nunca se pisa con el cache local — status fresco del server gana siempre", () => {
    // Regresión: un dispositivo que envió el trabajo a Codificado cacheaba
    // status:"en_codificado" localmente y ese cache nunca se invalidaba —
    // el trabajo quedaba mostrando "En Codificado" para siempre en ese
    // dispositivo aunque Codificado ya lo hubiera entregado a Calidad.
    recordWorkPackaging("native:wi-2", {
      updatedBy: "envasado",
      packagingLote: "STALE-LOTE",
      packagingVto: "01/01/2020",
      packagingTotalUnits: 100,
    });

    const fresh: WorkItem[] = [
      {
        id: "native:wi-2",
        sector: "CODIFICADO",
        status: "codificado_completo",
        product: "CREMA TEST",
        client: "TEST_CLIENTE",
        packagingLote: "LOTE-FRESCO",
        packagingTotalUnits: 1000,
      } as WorkItem,
    ];

    const next = applyWorkProgressToItems(fresh);
    expect(next[0]?.status).toBe("codificado_completo");
    expect(next[0]?.packagingLote).toBe("LOTE-FRESCO");
    expect(next[0]?.packagingTotalUnits).toBe(1000);
  });
});
