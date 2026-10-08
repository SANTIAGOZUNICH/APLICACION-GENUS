import { describe, expect, it } from "vitest";
import { buildOperationalLocks, norm } from "./operational-locks";

describe("buildOperationalLocks", () => {
  const locks = buildOperationalLocks({
    deliveries: [{ client: "TSU", product: "SERUMS X3", date: "2026-02-19" }],
    remitos: [{ client: "Ocean Skin", date: "2026-02-20" }],
    closedWorkItems: [{ product: "MILKY TONER", client: "TMCO", dates: ["2026-02-18"] }],
  });

  it("entrega confirmada o remito generado bloquea por fecha + cliente (insensible a mayúsculas/acentos)", () => {
    expect(locks.deliveryLock({ date: "2026-02-19", client: "tsu", product: "x" })).toMatch(/Entrega confirmada/);
    expect(locks.deliveryLock({ date: "2026-02-20", client: "OCEAN SKIN", product: "x" })).toMatch(/Remito/);
    expect(locks.deliveryLock({ date: "2026-02-21", client: "TSU", product: "x" })).toBeNull();
    expect(locks.deliveryLock({ date: null, client: "TSU", product: "x" })).toBeNull();
  });

  it("producción con cierre real bloquea C/DIA por fecha + producto (el texto de C/DIA suele incluir la marca)", () => {
    expect(locks.dayRecordLock({ date: "2026-02-18", product: "TMCO MILKY TONER" })).toMatch(/cierre/);
    expect(locks.dayRecordLock({ date: "2026-02-18", product: "OTRO PRODUCTO" })).toBeNull();
    expect(locks.dayRecordLock({ date: "2026-02-19", product: "TMCO MILKY TONER" })).toBeNull();
  });

  it("calendario: solo la celda cuyo texto ES el producto cerrado ese día", () => {
    expect(locks.plannedProductionLock({ date: "2026-02-18", product: "milky toner" })).toMatch(/cierre/);
    expect(locks.plannedProductionLock({ date: "2026-02-18", product: "55KG" })).toBeNull();
  });

  it("norm", () => expect(norm("  Crémé  Facial ")).toBe("creme facial"));
});
