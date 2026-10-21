import { describe, expect, it } from "vitest";
import { filterDeliveriesBySector, matchesDeliverySector } from "./sector-filter";

describe("filtro de sector de Entregas", () => {
  const sectors = ["ELABORACION", "ENVASADO_MASIVO", "ENVASADO_PREMIUM", "CODIFICADO"];
  it("TODAS no filtra", () => expect(sectors.filter((s) => matchesDeliverySector("TODAS", s))).toEqual(sectors));
  it("ENVASADO junta Masivo y Premium", () => expect(sectors.filter((s) => matchesDeliverySector("ENVASADO", s))).toEqual(["ENVASADO_MASIVO", "ENVASADO_PREMIUM"]));
  it("ELABORACIÓN solo Elaboración", () => expect(sectors.filter((s) => matchesDeliverySector("ELABORACION", s))).toEqual(["ELABORACION"]));
  it("sin sector no aparece en ENVASADO ni ELABORACIÓN", () => {
    expect(matchesDeliverySector("ENVASADO", null)).toBe(false);
    expect(matchesDeliverySector("ELABORACION", undefined)).toBe(false);
    expect(matchesDeliverySector("TODAS", undefined)).toBe(true);
  });
  it("un conjunto de entregas se reparte sin duplicar: Envasado + Elaboración (+ otros) = Todas", () => {
    const rows = [{ id: 1, s: "ELABORACION" }, { id: 2, s: "ENVASADO_MASIVO" }, { id: 3, s: "ENVASADO_PREMIUM" }, { id: 4, s: "ENVASADO_MASIVO" }];
    const env = rows.filter((r) => matchesDeliverySector("ENVASADO", r.s));
    const ela = rows.filter((r) => matchesDeliverySector("ELABORACION", r.s));
    expect(env.length + ela.length).toBe(rows.length);
    expect(new Set([...env, ...ela].map((r) => r.id)).size).toBe(rows.length);
  });

  it("calendario: filtra por el sector de cada producto, sin duplicar ni mutar", () => {
    const d = [
      { id: "a", items: [{ id: 1, sector: "ELABORACION" }, { id: 2, sector: "ENVASADO_MASIVO" }] },
      { id: "b", items: [{ id: 3, sector: "ENVASADO_PREMIUM" }] },
      { id: "c", items: [{ id: 4, sector: null }] },
    ];
    const snap = JSON.stringify(d);
    expect(filterDeliveriesBySector(d, "TODAS")).toBe(d);
    expect(filterDeliveriesBySector(d, "ENVASADO").map((x) => [x.id, x.items.map((i) => i.id)])).toEqual([["a", [2]], ["b", [3]]]);
    expect(filterDeliveriesBySector(d, "ELABORACION").map((x) => [x.id, x.items.map((i) => i.id)])).toEqual([["a", [1]]]);
    expect(JSON.stringify(d)).toBe(snap);
  });
});
