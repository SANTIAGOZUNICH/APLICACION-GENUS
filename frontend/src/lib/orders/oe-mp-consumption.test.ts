import { describe, expect, it } from "vitest";
import { emptyOeMaterial, normalizeOrderContent, parseKgInput, recomputeOeDerived, createEmptyOeContent } from "@/lib/orders/content";
import {
  buildOeConsumptionPlan,
  fillCodigoMpSuggestions,
  lotShortages,
  suggestCodigoMp,
  type MpCatalogLot,
} from "@/lib/orders/oe-mp-consumption";
import type { OeContent } from "@/lib/orders/types";

const catalog: MpCatalogLot[] = [
  { id: "lot-agua-a", codigo: "MP-AGUA", descripcion: "AGUA DESMINERALIZADA", lote: "A1", cantidadKg: 500 },
  { id: "lot-agua-b", codigo: "MP-AGUA", descripcion: "AGUA DESMINERALIZADA", lote: "A2", cantidadKg: 100 },
  { id: "lot-gli", codigo: "MP-GLI", codigosAnteriores: ["GLI-OLD"], descripcion: "GLICERINA", lote: "G1", cantidadKg: 30 },
  { id: "lot-1", codigo: "MP1", descripcion: "UNO", lote: "X", cantidadKg: 10 },
  { id: "lot-10", codigo: "MP10", descripcion: "DIEZ", lote: "X", cantidadKg: 10 },
  { id: "lot-arch", codigo: "MP-ARCH", descripcion: "ARCHIVADA", lote: "Z", cantidadKg: 10, archived: true },
];

const row = (o: Parameters<typeof emptyOeMaterial>[0]) => emptyOeMaterial({ materiaPrima: "AGUA", kgAPesar: 25, ...o });

describe("KG REAL UTILIZADO: carga y migración", () => {
  it("acepta coma decimal", () => {
    expect(parseKgInput("24,8")).toBe(24.8);
    expect(parseKgInput("151,2")).toBe(151.2);
    expect(parseKgInput("1.234,5")).toBe(1234.5);
    expect(parseKgInput("")).toBeNull();
  });

  it("OE anteriores sin ajuste: KG REAL queda vacío (nunca se copia el teórico)", () => {
    const legacy = createEmptyOeContent({ productName: "X" }) as OeContent;
    const raw = structuredClone(legacy) as unknown as { materials: Record<string, unknown>[] };
    raw.materials = [
      { id: "a", materiaPrima: "AGUA", kgAPesar: 25, ajuste: null },
      { id: "b", materiaPrima: "GLI", kgAPesar: 10, ajuste: -0.2 },
    ];
    const out = normalizeOrderContent(raw as unknown as OeContent) as OeContent;
    expect(out.materials[0]!.kgReal).toBeNull();
    expect(out.materials[1]!.kgReal).toBe(9.8);
    expect(out.materials.every((m) => m.codigoMp === "")).toBe(true);
  });

  it("totales: suma de kg reales (incluye lotes adicionales); la diferencia se deriva", () => {
    const c = createEmptyOeContent({ productName: "X" }) as OeContent;
    const parent = row({ id: "p", kgReal: 20 });
    c.materials = [parent, row({ id: "c", parentRowId: "p", kgReal: 4.8, kgAPesar: null })];
    const r = recomputeOeDerived(c);
    expect(r.materials[0]!.ajuste).toBeCloseTo(-0.2, 6);
    expect(r.totals.kgRealSum).toBeCloseTo(24.8, 6);
  });
});

describe("buildOeConsumptionPlan", () => {
  it("descuenta los kg REALES (24,8 en vez de 25; 151,2 en vez de 150)", () => {
    const { lines, issues } = buildOeConsumptionPlan(
      [
        row({ codigoMp: "MP-AGUA", lote: "A1", kgReal: 24.8 }),
        row({ materiaPrima: "GLICERINA", kgAPesar: 150, codigoMp: "MP-GLI", lote: "G1", kgReal: 151.2 }),
      ],
      catalog
    );
    expect(issues).toEqual([]);
    expect(lines.map((l) => [l.codigo, l.lote, l.kg])).toEqual([
      ["MP-AGUA", "A1", 24.8],
      ["MP-GLI", "G1", 151.2],
    ]);
  });

  it("informa la fila exacta que falta completar y no arma consumo de esa fila", () => {
    const { lines, issues } = buildOeConsumptionPlan(
      [
        row({ codigoMp: "MP-AGUA", lote: "A1", kgReal: null }),
        row({ materiaPrima: "GLI", codigoMp: "", lote: "G1", kgReal: 1 }),
        row({ materiaPrima: "INEX", codigoMp: "NO-EXISTE", lote: "G1", kgReal: 1 }),
        row({ materiaPrima: "SINLOTE", codigoMp: "MP-AGUA", lote: "", kgReal: 1 }),
        row({ materiaPrima: "LOTEMAL", codigoMp: "MP-AGUA", lote: "ZZ", kgReal: 1 }),
        row({ materiaPrima: "ARCH", codigoMp: "MP-ARCH", lote: "Z", kgReal: 1 }),
      ],
      catalog
    );
    // La fila 4 no tiene lote (opcional): se identifica por código y se reparte entre los lotes del código.
    expect(lines.map((l) => [l.codigo, l.lote, l.kg])).toEqual([["MP-AGUA", "A1", 1]]);
    expect(issues.map((i) => [i.rowNumber, i.field])).toEqual([
      [1, "kgReal"],
      [2, "codigoMp"],
      [3, "codigoMp"],
      [5, "lote"],
      [6, "codigoMp"],
    ]);
    expect(issues[0]!.message).toBe("Fila 1 — AGUA: falta KG REAL UTILIZADO.");
    expect(issues[3]!.message).toContain("«ZZ» no está en Stock MP");
  });

  it("KG REAL 0 = no se usó: no exige código ni lote y no descuenta; filas vacías se ignoran", () => {
    const { lines, issues } = buildOeConsumptionPlan(
      [row({ kgReal: 0 }), emptyOeMaterial({})],
      catalog
    );
    expect(lines).toEqual([]);
    expect(issues).toEqual([]);
  });

  it("misma MP en varias fases (mismo código y lote): se suma en una sola línea", () => {
    const { lines } = buildOeConsumptionPlan(
      [
        row({ codigoMp: "MP-AGUA", lote: "A1", kgReal: 20 }),
        row({ materiaPrima: "GLI", codigoMp: "MP-GLI", lote: "G1", kgReal: 1 }),
        row({ codigoMp: "mp-agua", lote: " a1 ", kgReal: 5.5 }),
      ],
      catalog
    );
    expect(lines.map((l) => [l.codigo, l.lote, l.kg, l.rowIds.length])).toEqual([
      ["MP-AGUA", "A1", 25.5, 2],
      ["MP-GLI", "G1", 1, 1],
    ]);
  });

  it("una MP desde varios lotes: fila de lote adicional hereda el CÓDIGO MP de su MP", () => {
    const parent = row({ id: "p", codigoMp: "MP-AGUA", lote: "A1", kgReal: 20 });
    const child = row({ id: "c", parentRowId: "p", codigoMp: "", lote: "A2", kgReal: 5, kgAPesar: null });
    const { lines, issues } = buildOeConsumptionPlan([parent, child], catalog);
    expect(issues).toEqual([]);
    expect(lines.map((l) => [l.lotId, l.kg])).toEqual([
      ["lot-agua-a", 20],
      ["lot-agua-b", 5],
    ]);
  });

  it("código anterior (reclasificado) se acepta; MP1 y MP10 no se mezclan", () => {
    const { lines } = buildOeConsumptionPlan(
      [
        row({ codigoMp: "GLI-OLD", lote: "G1", kgReal: 1 }),
        row({ codigoMp: "MP1", lote: "X", kgReal: 1 }),
        row({ codigoMp: "MP10", lote: "X", kgReal: 2 }),
      ],
      catalog
    );
    expect(lines.map((l) => [l.lotId, l.kg])).toEqual([
      ["lot-gli", 1],
      ["lot-1", 1],
      ["lot-10", 2],
    ]);
  });

  it("lote sin fila propia: si el código tiene UNA sola fila en Stock MP se descuenta de esa fila con el lote real; si tiene varias, se pide corregir", () => {
    const one = buildOeConsumptionPlan([row({ materiaPrima: "GLI", codigoMp: "MP-GLI", lote: "g-77", kgReal: 2 })], catalog);
    expect(one.issues).toEqual([]);
    expect(one.lines.map((l) => [l.lotId, l.lote, l.viaCodigo, l.kg])).toEqual([["lot-gli", "g-77", true, 2]]);
    const many = buildOeConsumptionPlan([row({ codigoMp: "MP-AGUA", lote: "A9", kgReal: 2 })], catalog);
    expect(many.lines).toEqual([]);
    expect(many.issues[0]!.message).toContain("lotes: A1, A2");
  });

  it("dos lotes reales sobre la misma fila del código: dos líneas (trazabilidad) y el faltante se calcula con la suma", () => {
    const { lines } = buildOeConsumptionPlan(
      [
        row({ materiaPrima: "GLI", codigoMp: "MP-GLI", lote: "G1", kgReal: 20 }),
        row({ materiaPrima: "GLI", codigoMp: "MP-GLI", lote: "G2", kgReal: 15 }),
      ],
      catalog
    );
    expect(lines.map((l) => [l.lote, l.lotId])).toEqual([["G1", "lot-gli"], ["G2", "lot-gli"]]);
    const sh = lotShortages(lines.map((l) => ({ codigo: l.codigo, lote: l.lote, lotId: l.lotId, delta: -l.kg })), catalog);
    expect(sh).toEqual([{ codigo: "MP-GLI", lote: "G1 + G2", disponible: 30, requerido: 35, faltante: 5, tipo: "lote" }]);
  });

  it("stock insuficiente por lote", () => {
    expect(lotShortages([{ codigo: "MP-GLI", lote: "G1", lotId: "lot-gli", delta: -31 }], catalog)).toEqual([
      { codigo: "MP-GLI", lote: "G1", disponible: 30, requerido: 31, faltante: 1, tipo: "lote" },
    ]);
    expect(lotShortages([{ codigo: "MP-GLI", lote: "G1", lotId: "lot-gli", delta: -30 }], catalog)).toEqual([]);
    expect(lotShortages([{ codigo: "MP-GLI", lote: "G1", lotId: "lot-gli", delta: 5 }], catalog)).toEqual([]);
  });
});

describe("sugerencia de CÓDIGO MP", () => {
  it("una sola coincidencia (por código de fórmula o nombre exacto): sugiere; varias: elige el usuario; ninguna: no inventa", () => {
    expect(suggestCodigoMp({ codigo: "mp-gli", materiaPrima: "" }, catalog)).toEqual({ kind: "one", codigo: "MP-GLI" });
    expect(suggestCodigoMp({ codigo: "GLI-OLD", materiaPrima: "" }, catalog)).toEqual({ kind: "one", codigo: "MP-GLI" });
    expect(suggestCodigoMp({ codigo: "", materiaPrima: "Agua desmineralizada" }, catalog)).toEqual({ kind: "one", codigo: "MP-AGUA" });
    const dup: MpCatalogLot[] = [...catalog, { id: "o", codigo: "MP-AGUA-2", descripcion: "AGUA DESMINERALIZADA", lote: "Q", cantidadKg: 1 }];
    expect(suggestCodigoMp({ codigo: "", materiaPrima: "AGUA DESMINERALIZADA" }, dup)).toEqual({ kind: "many", codigos: ["MP-AGUA", "MP-AGUA-2"] });
    expect(suggestCodigoMp({ codigo: "F-999", materiaPrima: "INEXISTENTE" }, catalog)).toEqual({ kind: "none" });
    expect(suggestCodigoMp({ codigo: "", materiaPrima: "ARCHIVADA" }, catalog)).toEqual({ kind: "none" });
  });

  it("completa solo los vacíos e inequívocos; nunca pisa uno cargado a mano ni las filas de lote adicional", () => {
    const out = fillCodigoMpSuggestions(
      [
        row({ id: "1", materiaPrima: "GLICERINA" }),
        row({ id: "2", materiaPrima: "GLICERINA", codigoMp: "MANUAL" }),
        row({ id: "3", materiaPrima: "NADA" }),
        row({ id: "4", materiaPrima: "GLICERINA", parentRowId: "1" }),
      ],
      catalog
    );
    expect(out.map((m) => m.codigoMp)).toEqual(["MP-GLI", "MANUAL", "", ""]);
  });
});


describe("LOTE MP opcional: descuento por CÓDIGO (FEFO / FIFO entre lotes aptos)", () => {
  const lot = (id: string, lote: string, kg: number, over: Partial<MpCatalogLot> = {}): MpCatalogLot => ({ id, codigo: "MP001", descripcion: "GLICERINA", lote, cantidadKg: kg, ...over });
  const plan = (rows: Parameters<typeof row>[0][], cat: MpCatalogLot[], opts = {}) => buildOeConsumptionPlan(rows.map((r) => row({ materiaPrima: "GLICERINA", codigoMp: "MP001", ...r })), cat, opts);
  const out = (p: ReturnType<typeof plan>) => p.lines.map((l) => [l.lote, l.kg]);

  it("un solo registro del código: se descuenta de ese registro aunque el lote esté vacío", () => {
    const p = plan([{ kgReal: 3, lote: "" }], [lot("a", "L1", 25)]);
    expect(p.issues).toEqual([]);
    expect(p.lines).toMatchObject([{ codigo: "MP001", lote: "L1", lotId: "a", kg: 3, viaCodigo: true }]);
  });

  it("dos lotes: primero el de vencimiento más próximo y el resto del siguiente (2 kg del A + 3 kg del B)", () => {
    const cat = [lot("b", "B", 8, { vencimiento: "2027-06-01" }), lot("a", "A", 2, { vencimiento: "2027-01-01" })];
    expect(out(plan([{ kgReal: 5, lote: "" }], cat, { today: new Date("2026-10-23T12:00:00") }))).toEqual([["A", 2], ["B", 3]]);
  });

  it("sin vencimiento: FIFO por fecha de ingreso; los que tienen vencimiento van antes", () => {
    const cat = [lot("n2", "N2", 10, { createdAt: "2026-02-01T00:00:00Z" }), lot("n1", "N1", 10, { createdAt: "2026-01-01T00:00:00Z" }), lot("v", "V", 10, { vencimiento: "2030-01-01" })];
    expect(out(plan([{ kgReal: 25, lote: "" }], cat))).toEqual([["V", 10], ["N1", 10], ["N2", 5]]);
    expect(out(plan([{ kgReal: 4, lote: "" }], cat))).toEqual([["V", 4]]);
  });

  it("no consume lotes vencidos, en cuarentena, bloqueados ni rechazados", () => {
    const cat = [
      lot("v", "VENC", 50, { vencimiento: "2020-01-01" }),
      lot("c", "CUAR", 50, { estadoManual: "Cuarentena" }),
      lot("b", "BLOQ", 50, { estadoManual: "Bloqueado" }),
      lot("r", "RECH", 50, { vencimientoEstadoManual: "Rechazado" }),
      lot("ok", "OK", 5, { vencimiento: "2027-01-01" }),
    ];
    expect(out(plan([{ kgReal: 4, lote: "" }], cat, { today: new Date("2026-10-23T12:00:00") }))).toEqual([["OK", 4]]);
    const todos = plan([{ kgReal: 1, lote: "" }], cat.slice(0, 4), { today: new Date("2026-10-23T12:00:00") });
    expect(todos.lines).toEqual([]);
    expect(todos.issues[0]!.message).toContain("no hay lotes aptos");
    const unico = plan([{ kgReal: 1, lote: "" }], [lot("x", "X", 9, { estadoManual: "Cuarentena" })]);
    expect(unico.lines).toEqual([]);
    expect(unico.issues[0]!.message).toContain("cuarentena");
  });

  it("lote explícito: se respeta (no se reparte) y puede convivir con filas sin lote", () => {
    const cat = [lot("a", "A", 2, { vencimiento: "2027-01-01" }), lot("b", "B", 8, { vencimiento: "2027-06-01" })];
    expect(out(plan([{ kgReal: 1.5, lote: "b" }], cat))).toEqual([["B", 1.5]]);
    expect(out(plan([{ kgReal: 1, lote: "B" }, { kgReal: 1, lote: "" }], cat))).toEqual([["B", 1], ["A", 1]]);
  });

  it("stock insuficiente: el faltante queda en el primer lote apto para que el control de stock lo informe (no se descuenta parcial)", () => {
    const cat = [lot("a", "A", 2, { vencimiento: "2027-01-01" }), lot("b", "B", 8, { vencimiento: "2027-06-01" })];
    const p = plan([{ kgReal: 150, lote: "" }], cat);
    expect(out(p)).toEqual([["A", 142], ["B", 8]]);
    expect(lotShortages(p.lines.map((l) => ({ codigo: l.codigo, lote: l.lote, lotId: l.lotId, delta: -l.kg })), cat).map((s) => s.lote)).toEqual(["A"]);
  });

  it("guardar de nuevo con lo ya consumido: se conserva lo tomado de cada lote y solo se suma lo nuevo", () => {
    const cat = [lot("a", "A", 0, { vencimiento: "2027-01-01" }), lot("b", "B", 5, { vencimiento: "2027-06-01" })]; // A ya se agotó con esta OE
    const consumed = new Map([["MP001|A", 2], ["MP001|B", 3]]);
    expect(out(plan([{ kgReal: 5, lote: "" }], cat, { consumedBefore: consumed }))).toEqual([["A", 2], ["B", 3]]); // igual: sin cambios
    expect(out(plan([{ kgReal: 6, lote: "" }], cat, { consumedBefore: consumed }))).toEqual([["A", 2], ["B", 4]]); // +1 del siguiente apto
    expect(out(plan([{ kgReal: 4, lote: "" }], cat, { consumedBefore: consumed }))).toEqual([["A", 2], ["B", 2]]); // se reduce del último
  });

  it("código ambiguo: error claro, sin elegir otra MP", () => {
    const cat = [lot("a", "A", 5), { id: "z", codigo: "MP002", codigosAnteriores: ["MP001"], descripcion: "OTRA", lote: "Z", cantidadKg: 5 }];
    const p = plan([{ kgReal: 1, lote: "" }], cat);
    expect(p.lines).toEqual([]);
    expect(p.issues[0]!.message).toContain("ambiguo");
  });
});
