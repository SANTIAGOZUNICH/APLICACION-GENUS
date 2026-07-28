import { describe, expect, it, beforeEach } from "vitest";
import {
  getFormulaSearchPerfSnapshot,
  resetFormulaSearchPerf,
  timeLocalFilter,
} from "./formula-search-perf";
import { filterClientsRanked } from "./formula-search-rank";

describe("formula-search-perf", () => {
  beforeEach(() => resetFormulaSearchPerf());

  it("mide filtro local con caché caliente < 100ms en catálogo pequeño", () => {
    const clients = [
      { client: "UNICA" },
      { client: "THELMA Y LOUISE" },
      { client: "AGUEDA REY" },
      { client: "UNIVERSAL" },
    ];
    const ranked = timeLocalFilter("clients_filter", "u", clients.length, "hot", () =>
      filterClientsRanked(clients, "u", 10)
    );
    expect(ranked[0]?.client).toBe("UNICA");
    const snap = getFormulaSearchPerfSnapshot();
    expect(snap.localFilters).toBe(1);
    expect(snap.remoteFetches).toBe(0);
    expect(snap.lastEvents[0]?.durationMs).toBeLessThan(100);
  });

  it("cinco tipadas rápidas no incrementan remoteFetches", () => {
    const clients = Array.from({ length: 50 }, (_, i) => ({
      client: `CLIENTE ${String.fromCharCode(65 + (i % 26))}${i}`,
    }));
    for (const q of ["c", "cl", "cli", "clie", "client"]) {
      timeLocalFilter("clients_filter", q, clients.length, "hot", () =>
        filterClientsRanked(clients, q, 10)
      );
    }
    const snap = getFormulaSearchPerfSnapshot();
    expect(snap.localFilters).toBe(5);
    expect(snap.remoteFetches).toBe(0);
  });
});
