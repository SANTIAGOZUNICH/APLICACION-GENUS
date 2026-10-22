import { describe, expect, it } from "vitest";
import {
  canonicalUnit, classifyDuplicates, convertQuantity, parseNumber, preselectFromHistory, remitoKey, sanitizeExtraction, splitPackages, suggestMaterials, supplierKey,
  validateReceipt, autoMatchMaterial, recoverSupplierCode, emptyHeader, emptyLine, canWriteReceipts, type CatalogItem, type MappingHistory, type ReceiptDraftPayload, mappingKey,
} from "./receipt-rules";

const catalogMP = new Map<string, CatalogItem>([
  ["GLI-001", { code: "GLI-001", description: "GLICERINA VEGETAL USP", unit: "kg" }],
  ["ALC-010", { code: "ALC-010", description: "ALCOHOL CETILICO", unit: "kg" }],
]);
const catalogME = new Map<string, CatalogItem>([["FR-250", { code: "FR-250", description: "FRASCO PET 250 ML", unit: "u" }]]);
const draft = (over: Partial<ReceiptDraftPayload["header"]> = {}, lines = [{ ...emptyLine("a"), materialCode: "GLI-001", quantity: "100", unit: "kg", lote: "L1", vencimiento: "2028-01-31" }]): ReceiptDraftPayload => ({
  header: { ...emptyHeader(), supplier: "Droguería Sur SA", remitoNumber: "0001-00012345", receivedDate: "2026-10-15", ...over }, lines,
});

describe("normalización", () => {
  it("proveedor y n.º de remito se comparan sin ruido", () => {
    expect(supplierKey("Droguería  Sur S.A.")).toBe(supplierKey("DROGUERIA SUR"));
    expect(remitoKey("0001-00012345")).toBe(remitoKey("1 - 12345"));
    expect(remitoKey("R-0042")).toBe("R-42");
  });
  it("números es-AR e internacionales", () => {
    expect(parseNumber("1.200,5")).toBe(1200.5);
    expect(parseNumber("1200.5")).toBe(1200.5);
    expect(parseNumber("1.200")).toBe(1200);
    expect(parseNumber("12,5")).toBe(12.5);
    expect(parseNumber("abc")).toBeNull();
    expect(parseNumber("")).toBeNull();
  });
  it("unidades: alias, conversión de masa y rechazo de lo inconvertible", () => {
    expect(canonicalUnit("Kgs.")).toBe("kg");
    expect(canonicalUnit("Unidades")).toBe("u");
    expect(convertQuantity(500, "g", "kg")).toEqual({ ok: true, value: 0.5, unit: "kg" });
    expect(convertQuantity(2, "t", "kg")).toEqual({ ok: true, value: 2000, unit: "kg" });
    expect(convertQuantity(10, "l", "kg").ok).toBe(false);
    expect(convertQuantity(10, "u", "u").ok).toBe(true);
    expect(convertQuantity(10, "kg", "u").ok).toBe(false);
  });
  it("bultos solo si dividen exacto", () => {
    expect(splitPackages(100, 4)).toEqual({ bultos: 4, cantidad: 25 });
    expect(splitPackages(100, 3)).toEqual({ bultos: null, cantidad: 100 });
    expect(splitPackages(12.5, 5)).toEqual({ bultos: null, cantidad: 12.5 });
  });
});

describe("validación del borrador", () => {
  it("MP completo → ok y cantidades en kg", () => {
    const r = validateReceipt("MP", draft(), catalogMP, "2026-10-16");
    expect(r.ok).toBe(true);
    expect(r.lines[0]).toMatchObject({ materialCode: "GLI-001", quantity: 100, unit: "kg" });
  });
  it("material no encontrado, lote y vencimiento obligatorios, cantidad y unidad incorrectas", () => {
    const bad = draft({}, [
      { ...emptyLine("a"), materialCode: "NOEXISTE", quantity: "5", unit: "kg", lote: "L", vencimiento: "2028-01-01" },
      { ...emptyLine("b"), materialCode: "GLI-001", quantity: "0", unit: "kg", lote: "L", vencimiento: "2028-01-01" },
      { ...emptyLine("c"), materialCode: "GLI-001", quantity: "5", unit: "litros", lote: "L", vencimiento: "2028-01-01" },
      { ...emptyLine("d"), materialCode: "GLI-001", quantity: "5", unit: "kg", lote: "", vencimiento: "2028-01-01" },
      { ...emptyLine("e"), materialCode: "GLI-001", quantity: "5", unit: "kg", lote: "L", vencimiento: "" },
      { ...emptyLine("f"), materialCode: "", quantity: "5", unit: "kg", lote: "L", vencimiento: "" , noExpiry: true },
    ]);
    const r = validateReceipt("MP", bad, catalogMP, "2026-10-16");
    expect(r.ok).toBe(false);
    const codes = r.issues.map((i) => `${i.line}:${i.code}`);
    expect(codes).toEqual(expect.arrayContaining(["0:UNKNOWN_MATERIAL", "1:QTY", "2:UNIT", "3:LOTE", "4:VTO", "5:NO_MATERIAL"]));
  });
  it("«Sin vencimiento» explícito permite continuar; la fecha de recepción futura no", () => {
    const ok = validateReceipt("MP", draft({}, [{ ...emptyLine("a"), materialCode: "GLI-001", quantity: "1", unit: "kg", lote: "L", noExpiry: true }]), catalogMP, "2026-10-16");
    expect(ok.ok).toBe(true);
    const fut = validateReceipt("MP", draft({ receivedDate: "2026-12-01" }), catalogMP, "2026-10-16");
    expect(fut.issues.some((i) => i.field === "receivedDate")).toBe(true);
  });
  it("ME: sin lote ni vencimiento; unidad del material respetada", () => {
    const ok = validateReceipt("ME", draft({}, [{ ...emptyLine("a"), materialCode: "FR-250", quantity: "1.200", unit: "un" }]), catalogME, "2026-10-16");
    expect(ok.ok).toBe(true);
    expect(ok.lines[0]!.quantity).toBe(1200);
    const bad = validateReceipt("ME", draft({}, [{ ...emptyLine("a"), materialCode: "FR-250", quantity: "5", unit: "kg" }]), catalogME, "2026-10-16");
    expect(bad.issues[0]!.code).toBe("UNIT");
  });
  it("fecha del remito distinta de la de recepción y requeridos", () => {
    const r = validateReceipt("MP", draft({ supplier: "", remitoNumber: "", receivedDate: "" }, []), catalogMP, "2026-10-16");
    expect(r.issues.map((i) => i.field)).toEqual(expect.arrayContaining(["supplier", "remitoNumber", "receivedDate", "lines"]));
  });
});

describe("sugerencia de materiales", () => {
  const history: MappingHistory = new Map([[mappingKey("Droguería Sur", "AB-77"), { code: "GLI-001", count: 3 }]]);
  it("solo un uso previo confirmado se pre-selecciona; el código del proveedor no se toma como interno", () => {
    expect(preselectFromHistory({ supplier: "DROGUERIA SUR SA", supplierCode: "ab 77" }, history)).toBe("GLI-001");
    expect(preselectFromHistory({ supplier: "Otro", supplierCode: "AB-77" }, history)).toBe("");
    expect(preselectFromHistory({ supplier: "Droguería Sur", supplierCode: "" }, history)).toBe("");
  });
  it("ordena por parecido de descripción", () => {
    const s = suggestMaterials({ supplier: "X", supplierCode: "", description: "Glicerina vegetal 25kg" }, catalogMP.values(), new Map());
    expect(s[0]!.code).toBe("GLI-001");
    expect(s.find((x) => x.code === "ALC-010")).toBeUndefined();
  });
});

describe("duplicados", () => {
  const existing = [{ source: "recepcion" as const, id: "r1", label: "la recepción del 2026-10-01", supplierKey: supplierKey("Droguería Sur"), remitoKey: remitoKey("1-12345"), lines: [{ materialCode: "GLI-001", quantity: 100 }] }];
  const base = { supplier: "DROGUERIA SUR SA", remitoNumber: "0001-00012345", existing, fileMatches: [] };
  it("mismo remito, material y cantidad → exacto (exige reconocerlo)", () => {
    const w = classifyDuplicates({ ...base, lines: [{ materialCode: "GLI-001", quantity: 100 }] });
    expect(w[0]).toMatchObject({ kind: "remito_exacto", requiresAck: true });
  });
  it("mismo remito con otra cantidad u otro material → parcial (no bloquea)", () => {
    const w = classifyDuplicates({ ...base, lines: [{ materialCode: "GLI-001", quantity: 40 }, { materialCode: "ALC-010", quantity: 5 }] });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ kind: "remito_parcial", requiresAck: false });
  });
  it("otro proveedor u otro remito → sin advertencia; archivo repetido exige reconocerlo", () => {
    expect(classifyDuplicates({ ...base, supplier: "Otra SRL", lines: [{ materialCode: "GLI-001", quantity: 100 }] })).toEqual([]);
    const w = classifyDuplicates({ ...base, remitoNumber: "9-9", lines: [], fileMatches: [{ refId: "r9", source: "recepcion", label: "la recepción X" }, { refId: "r9", source: "recepcion", label: "la recepción X" }] });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ kind: "archivo_repetido", requiresAck: true });
  });
});

describe("lectura automática = sugerencia saneada", () => {
  it("descarta lo inválido, no inventa y marca «Revisar»", () => {
    const r = sanitizeExtraction({
      supplier: " Droguería  Sur ", remitoNumber: "0001-0123", remitoDate: "15/10/2026", unclearFields: [],
      lines: [
        { supplierCode: "AB-1", description: "Glicerina", quantity: "1.250,5", unit: "kg", lot: "L9", expiryDate: "2028-02-30", packages: 5 },
        { description: "", quantity: null },
        "basura",
      ],
    })!;
    expect(r.supplier).toBe("Droguería Sur");
    expect(r.remitoDate).toBe("2026-10-15");
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ quantity: "1250.5", lote: "L9", vencimiento: "" });
    expect(r.lines[0]!.review).toContain("vencimiento");
  });
  it("respuesta vacía o no remito → null", () => {
    expect(sanitizeExtraction(null)).toBeNull();
    expect(sanitizeExtraction({ lines: [] })).toBeNull();
    expect(sanitizeExtraction("texto")).toBeNull();
  });
});

describe("permisos por sector", () => {
  it("MP: Materia Prima, Producción y Dirección; ME: Depósito y Dirección; Producción no escribe ME", () => {
    expect(canWriteReceipts("MATERIA_PRIMA", "MP")).toBe(true);
    expect(canWriteReceipts("DEPOSITO", "MP")).toBe(false);
    expect(canWriteReceipts("DEPOSITO", "ME")).toBe(true);
    expect(canWriteReceipts("MATERIA_PRIMA", "ME")).toBe(false);
    expect(canWriteReceipts("PRODUCCION", "MP")).toBe(true);
    expect(canWriteReceipts("PRODUCCION", "ME")).toBe(false);
    expect(canWriteReceipts("DIRECCION", "MP")).toBe(true);
    expect(canWriteReceipts("DIRECCION", "ME")).toBe(true);
  });
});

describe("preselección automática (solo si es inequívoca)", () => {
  const cat = new Map<string, CatalogItem>([
    ["GLI-001", { code: "GLI-001", description: "GLICERINA VEGETAL USP", unit: "kg" }],
    ["GLI-002", { code: "GLI-002", description: "GLICERINA TRIPLE REFINADA", unit: "kg" }],
    ["ALC-010", { code: "ALC-010", description: "ALCOHOL CETILICO", unit: "kg" }],
    ["FR-250", { code: "FR-250", description: "FRASCO PET 250 ML", unit: "u" }],
  ]);
  const none: MappingHistory = new Map();
  const base = { supplier: "Droguería Sur", supplierCode: "", description: "", unit: "kg" };
  it("1) uso previo confirmado del mismo proveedor + código", () => {
    const h: MappingHistory = new Map([[mappingKey("Droguería Sur", "AB-77"), { code: "GLI-002", count: 2 }]]);
    expect(autoMatchMaterial({ ...base, supplierCode: "AB-77", description: "Glicerina" }, cat, h, "MP")).toMatchObject({ code: "GLI-002", source: "previo" });
  });
  it("2) código impreso = código interno exacto (y la descripción no lo contradice)", () => {
    expect(autoMatchMaterial({ ...base, supplierCode: "ALC-010", description: "Alcohol cetilico x 25 kg" }, cat, none, "MP")).toMatchObject({ code: "ALC-010", source: "codigo" });
    // El código coincide pero la descripción es de OTRA cosa → no se preselecciona (podría ser un código del proveedor que casualmente se parece).
    expect(autoMatchMaterial({ ...base, supplierCode: "ALC-010", description: "Tambor de plástico vacío" }, cat, none, "MP")).toBeNull();
  });
  it("3) por nombre: solo si un candidato es claramente mejor y la unidad es compatible", () => {
    expect(autoMatchMaterial({ ...base, description: "Alcohol cetilico" }, cat, none, "MP")).toMatchObject({ code: "ALC-010", source: "nombre" });
    // «Glicerina» parece a dos materiales → ambiguo: no se elige, se muestran opciones.
    expect(autoMatchMaterial({ ...base, description: "Glicerina" }, cat, none, "MP")).toBeNull();
    // Unidad incompatible con el material (ME en unidades vs kg)
    expect(autoMatchMaterial({ ...base, description: "Frasco PET 250 ml", unit: "kg" }, cat, none, "ME")).toBeNull();
    expect(autoMatchMaterial({ ...base, description: "Frasco PET 250 ml", unit: "un" }, cat, none, "ME")).toMatchObject({ code: "FR-250" });
  });
  it("sin datos suficientes: no elige nada y nunca crea", () => {
    expect(autoMatchMaterial({ ...base, description: "" }, cat, none, "MP")).toBeNull();
    expect(autoMatchMaterial({ ...base, supplierCode: "XX-1", description: "Cosa rara" }, cat, none, "MP")).toBeNull();
  });
});

describe("código de producto en la lectura (fragancias)", () => {
  const ctx = { remitoNumber: "0003-00012345" };
  it("separa el código pegado a la descripción", () => {
    expect(recoverSupplierCode({ supplierCode: "", description: "FR-4521 Fragancia rosa silvestre", lote: "" }, ctx)).toMatchObject({ supplierCode: "FR-4521", description: "Fragancia rosa silvestre", recovered: true });
    expect(recoverSupplierCode({ supplierCode: "", description: "Fragancia vainilla Cód: VN2209", lote: "" }, ctx)).toMatchObject({ supplierCode: "VN2209", description: "Fragancia vainilla", recovered: true });
    expect(recoverSupplierCode({ supplierCode: "", description: "Fragancia coco - Ref. 88-COCO-1", lote: "" }, ctx).supplierCode).toBe("88-COCO-1");
    expect(recoverSupplierCode({ supplierCode: "", description: "SKU: AB123 Esencia lavanda", lote: "" }, ctx).supplierCode).toBe("AB123");
  });
  it("no confunde con remito, lote, fecha ni cantidad; no inventa", () => {
    expect(recoverSupplierCode({ supplierCode: "", description: "0003-00012345 Fragancia", lote: "" }, ctx).recovered).toBe(false);
    expect(recoverSupplierCode({ supplierCode: "", description: "L2210A Fragancia", lote: "L2210A" }, ctx).recovered).toBe(false);
    expect(recoverSupplierCode({ supplierCode: "", description: "12/10/2026 Fragancia", lote: "" }, ctx).recovered).toBe(false);
    expect(recoverSupplierCode({ supplierCode: "", description: "25kg Fragancia", lote: "" }, ctx).recovered).toBe(false);
    expect(recoverSupplierCode({ supplierCode: "", description: "Fragancia rosa sin código", lote: "" }, ctx)).toMatchObject({ supplierCode: "", recovered: false });
  });
  it("descarta como código el n.º de remito o el lote y lo deja para revisar", () => {
    expect(recoverSupplierCode({ supplierCode: "0003-00012345", description: "Fragancia", lote: "" }, ctx)).toMatchObject({ supplierCode: "", discarded: true });
    expect(recoverSupplierCode({ supplierCode: "LOTE77", description: "Fragancia", lote: "LOTE77" }, ctx).discarded).toBe(true);
    expect(recoverSupplierCode({ supplierCode: "FR-4521", description: "Fragancia", lote: "L1" }, ctx)).toMatchObject({ supplierCode: "FR-4521", discarded: false });
  });
  it("sanitizeExtraction aplica la recuperación y marca «Revisar» el código", () => {
    const out = sanitizeExtraction({ supplier: "Esencias SA", remitoNumber: "0003-00012345", lines: [{ supplierCode: "", description: "FR-4521 Fragancia rosa", quantity: 5, unit: "kg" }, { supplierCode: "0003-00012345", description: "Otra", quantity: 1, unit: "kg" }] });
    expect(out!.lines[0]).toMatchObject({ supplierCode: "FR-4521", description: "Fragancia rosa" });
    expect(out!.lines[0]!.review).toContain("supplierCode");
    expect(out!.lines[1]!.supplierCode).toBe("");
  });
});
