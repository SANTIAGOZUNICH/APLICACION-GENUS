import { describe, expect, it } from "vitest";
import { buildControlNeeds, type ControlInput } from "./control-needs";
import type { ProductSection } from "./product-breakdown";

const ctl = (over: Partial<ControlInput> = {}): ControlInput => ({
  id: "c1",
  client: "THELMA Y LOUISE",
  product: "PROTECTOR SOLAR",
  quantityKg: 610,
  lines: [
    { materiaPrima: "Agua", codigo: "A", formulaPct: 50, kgNecesarios: 305, kgEditados: null, stockActual: 1000 },
    { materiaPrima: "Glicerina", codigo: "G", formulaPct: 2, kgNecesarios: 12.2, kgEditados: null, stockActual: 5 },
    { materiaPrima: "Filtro UV A", codigo: "F", formulaPct: 5, kgNecesarios: 30.5, kgEditados: null, stockActual: 0 },
    { materiaPrima: "Extracto raro", codigo: "X", formulaPct: 1, kgNecesarios: 6.1, kgEditados: null, stockActual: null },
  ],
  ...over,
});

describe("buildControlNeeds", () => {
  it("devuelve solo faltantes: rojo sin stock, rojo no identificada, amarillo insuficiente; no la suficiente", () => {
    const r = buildControlNeeds({ control: ctl(), sections: [] });
    expect(r.items.map((i) => [i.materiaPrima, i.status])).toEqual([
      ["Extracto raro", "NO_IDENTIFICADA"],
      ["Filtro UV A", "SIN_STOCK"],
      ["Glicerina", "INSUFICIENTE"],
    ]);
    const g = r.items.find((i) => i.materiaPrima === "Glicerina")!;
    expect([g.necesarioKg, g.stockFisicoKg, g.faltanteKg]).toEqual([12.2, 5, 7.2]);
    const x = r.items[0];
    expect([x.stockFisicoKg, x.disponibleKg, x.faltanteKg]).toEqual([null, 0, 6.1]);
  });
  it("stock compartido sin sección: lo ya comprometido por controles anteriores no se vuelve a usar", () => {
    const c = ctl({ lines: [{ materiaPrima: "Glicerina", codigo: "G", formulaPct: 100, kgNecesarios: 15, kgEditados: null, stockActual: 20 }] });
    expect(buildControlNeeds({ control: c, sections: [] }).items).toHaveLength(0);
    const r = buildControlNeeds({ control: c, sections: [], earlierNeedByMp: new Map([["glicerina", 15]]) });
    expect(r.items[0]).toMatchObject({ status: "INSUFICIENTE", disponibleKg: 5, faltanteKg: 10 });
  });
  it("con producción programada usa la disponibilidad repartida por fecha", () => {
    const section = {
      client: "THELMA Y LOUISE",
      product: "PROTECTOR SOLAR",
      totalKg: 610,
      lines: [{ materiaPrima: "Glicerina", codigo: "G", stockFisico: 20, availableForThis: 4, shared: true, rowEstado: "FALTANTE" }],
    } as unknown as ProductSection;
    const c = ctl({ lines: [{ materiaPrima: "Glicerina", codigo: "G", formulaPct: 2.4, kgNecesarios: 15, kgEditados: null, stockActual: 20 }] });
    const r = buildControlNeeds({ control: c, sections: [section] });
    expect(r.allocation).toBe("PRODUCCION");
    expect(r.items[0]).toMatchObject({ status: "INSUFICIENTE", stockFisicoKg: 20, disponibleKg: 4, faltanteKg: 11, shared: true });
  });
  it("MP no identificada en el reparto semanal es roja, no stock cero", () => {
    const section = { client: "A", product: "P", totalKg: 10, lines: [{ materiaPrima: "Raro", codigo: "", stockFisico: 0, availableForThis: 0, shared: false, rowEstado: "MP NO IDENTIFICADA" }] } as unknown as ProductSection;
    const c = ctl({ client: "A", product: "P", quantityKg: 10, lines: [{ materiaPrima: "Raro", codigo: "", formulaPct: 10, kgNecesarios: 1, kgEditados: null, stockActual: 0 }] });
    expect(buildControlNeeds({ control: c, sections: [section] }).items[0]).toMatchObject({ status: "NO_IDENTIFICADA", stockFisicoKg: null });
  });
});
