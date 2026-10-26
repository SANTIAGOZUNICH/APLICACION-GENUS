import { describe, expect, it } from "vitest";
import { identifyMaterial, pickAutoIdentity, specConflict } from "./mp-identity";
import { computeAvailability, impliedCodeAliases, type StockLot } from "./availability";
import { suggestMaterials, autoMatchMaterial, descriptionKey, type CatalogItem } from "@/lib/inventory/receipt-rules";

const cat = [
  { code: "MP-001", description: "GLICERINA VEGETAL" },
  { code: "MP-002", description: "D-PANTENOL 75%" },
  { code: "MP-003", description: "PANTENOL 50%" },
  { code: "MP-004", description: "HIALURONATO DE SODIO" },
  { code: "MP-005", description: "ALCOHOL CETILICO" },
];

describe("identifyMaterial", () => {
  it("código exacto único → ALTA", () => {
    const r = identifyMaterial({ name: "algo raro", code: "mp-002" }, cat);
    expect(pickAutoIdentity(r.candidates)?.code).toBe("MP-002");
  });
  it("mismo nombre normalizado → ALTA", () => {
    expect(pickAutoIdentity(identifyMaterial({ name: "Glicerina  Vegetal", code: "" }, cat).candidates)?.code).toBe("MP-001");
  });
  it("sinónimo inglés → candidato MEDIA, nunca automático", () => {
    const r = identifyMaterial({ name: "Glycerin", code: "" }, cat);
    expect(r.candidates[0]).toMatchObject({ code: "MP-001", confidence: "MEDIA", kind: "sinonimo" });
    expect(pickAutoIdentity(r.candidates)).toBeNull();
  });
  it("INCI de hialurónico → MEDIA", () => {
    expect(identifyMaterial({ name: "Sodium Hyaluronate", code: "" }, cat).candidates[0]).toMatchObject({ code: "MP-004", confidence: "MEDIA" });
  });
  it("concentraciones distintas no se mezclan", () => {
    const r = identifyMaterial({ name: "D-Panthenol 50%", code: "" }, cat);
    expect(r.candidates.map((c) => c.code)).toContain("MP-003");
    expect(r.candidates.map((c) => c.code)).not.toContain("MP-002");
    expect(r.discarded.map((d) => d.code)).toContain("MP-002");
    expect(specConflict("PANTENOL 75%", "PANTENOL 50%")).toMatch(/concentración/);
  });
  it("función parecida pero otro material: no se ofrece", () => {
    const c = identifyMaterial({ name: "Alcohol cetoestearílico", code: "" }, cat).candidates.find((x) => x.code === "MP-005");
    expect(c?.confidence ?? "BAJA").toBe("BAJA"); // a lo sumo «comparte palabras»: nunca ALTA/MEDIA
  });
  it("alias confirmado antes → ALTA", () => {
    const r = identifyMaterial({ name: "Provitamina B5", code: "" }, cat, { confirmed: [{ denomination: "provitamina b5", code: "MP-003" }] });
    expect(pickAutoIdentity(r.candidates)?.code).toBe("MP-003");
  });
  it("varios candidatos se devuelven acotados", () => {
    expect(identifyMaterial({ name: "pantenol", code: "" }, cat, { limit: 1 }).candidates).toHaveLength(1);
  });
});

describe("receipt-rules con identidad", () => {
  const catalog = new Map<string, CatalogItem>(cat.map((c) => [c.code, { ...c, unit: "kg" }]));
  it("sugiere por sinónimo con motivo y confianza", () => {
    const s = suggestMaterials({ supplier: "X", supplierCode: "", description: "Glycerin" }, catalog.values(), new Map());
    expect(s[0]).toMatchObject({ code: "MP-001", confidence: "MEDIA" });
  });
  it("denominación ya confirmada con el proveedor se reutiliza (sin código en el remito)", () => {
    const h = new Map([[descriptionKey("Droguería Sur", "Provitamina B5"), { code: "MP-003", count: 2 }]]);
    expect(autoMatchMaterial({ supplier: "Droguería Sur", supplierCode: "", description: "provitamina  B5", unit: "kg" }, catalog, h, "MP")).toMatchObject({ code: "MP-003", source: "previo" });
    // otro proveedor: no se reutiliza
    expect(autoMatchMaterial({ supplier: "Otro", supplierCode: "", description: "Provitamina B5", unit: "kg" }, catalog, h, "MP")).toBeNull();
  });
  it("no preselecciona nombre con concentración contradictoria", () => {
    expect(autoMatchMaterial({ supplier: "X", supplierCode: "", description: "Pantenol 50%", unit: "kg" }, new Map([["MP-002", { code: "MP-002", description: "PANTENOL 75%", unit: "kg" }]]), new Map(), "MP")).toBeNull();
  });
});

describe("código exacto en Control de MP", () => {
  const lot = (o: Partial<StockLot>): StockLot => ({ id: "1", codigo: "MP-001", descripcion: "GLICERINA VEGETAL", proveedor: "P", lote: "L1", cantidadKg: 100, ...o });
  const prod = { id: "p1", label: "P", reliable: true, lines: [{ materiaPrima: "Glycerin", codigo: "mp-001", kg: 30 }] };
  it("la fórmula con otro nombre y mismo código usa el stock", () => {
    const r = computeAvailability({ lots: [lot({})], productions: [prod], todayIso: "2026-01-01" });
    expect(r.rows[0]).toMatchObject({ estado: "SUFICIENTE" });
  });
  it("código ambiguo (apunta a dos nombres) no infiere nada", () => {
    expect(impliedCodeAliases([lot({}), lot({ id: "2", descripcion: "OTRA COSA" })], [prod])).toEqual([]);
  });
  it("sin código ni nombre igual sigue NO IDENTIFICADA", () => {
    const r = computeAvailability({ lots: [lot({})], productions: [{ ...prod, lines: [{ materiaPrima: "Glycerin", kg: 30 }] }], todayIso: "2026-01-01" });
    expect(r.rows[0]!.estado).toBe("MP NO IDENTIFICADA");
  });
});
