import { describe, expect, it } from "vitest";
import { accessoriesNeededBy, classifyRole } from "./families";
import { buildFindings, decideTransition, evaluateJobs, findingHash, productKey, worsened, type ConfigRow, type MeJob } from "./compute";
import { buildAccessoryPrompt, deterministicSuggestions, parseAccessoryAnswer } from "./suggest";

const cfg = (id: string, codigo: string | null, role: ConfigRow["role"], over: Partial<ConfigRow> = {}): ConfigRow => ({ id, materialCodigo: codigo, role, qtyPerUnit: 1, required: true, status: "CONFIRMADO", source: "MANUAL", reason: "", ...over });
const job = (id: string, qty: number | null, date = "2026-11-02", product = "SERUM", client = "AQUALO"): MeJob => ({ id, client, product, sector: "ENVASADO_PREMIUM", qty, unit: "un.", date, createdAt: `2026-10-01T10:00:0${id.length}.000Z` });
const labels = new Map([["FR", "Frasco gotero 30 ml"], ["DR", "Dropper 30 ml"], ["ET", "Etiqueta serum"], ["POTE", "Pote crema 50 g"], ["BOT", "Botella 100 ml con válvula"], ["VAL", "Válvula 24/410"]]);
const run = (jobs: MeJob[], rows: ConfigRow[], stock: Record<string, number>, product = "SERUM", client = "AQUALO") =>
  evaluateJobs({ jobs, configs: new Map([[productKey(client, product), rows]]), stock: new Map(Object.entries(stock)), labels });

describe("familias de envases", () => {
  it("clasifica por la palabra que aparece primero", () => {
    expect(classifyRole("Frasco gotero 30 ml Aqualo")).toBe("ENVASE");
    expect(classifyRole("Dropper Aqualo 30 ml")).toBe("DISPENSADOR");
    expect(classifyRole("Tapa pote 50 g")).toBe("CIERRE");
    expect(classifyRole("Válvula 24/410")).toBe("DISPENSADOR");
    expect(classifyRole("Etiqueta Aqualo Serum Capilar")).toBe("ETIQUETA");
    expect(classifyRole("Estuche serum")).toBe("ESTUCHE");
    expect(classifyRole("Caja de cartón corrugado")).toBe("ESTUCHE");
    expect(classifyRole("Precinto termocontraíble")).toBe("PRECINTO");
  });
  it("accesorios que suele necesitar cada familia (y ninguno si no se reconoce)", () => {
    expect(accessoriesNeededBy("Frasco gotero 30 ml").map((a) => a.role)).toEqual(["DISPENSADOR"]);
    expect(accessoriesNeededBy("Pote crema 50 g").map((a) => a.role)).toEqual(["CIERRE"]);
    expect(accessoriesNeededBy("Pomo 100 g").map((a) => a.role)).toEqual(["CIERRE"]);
    expect(accessoriesNeededBy("Botella 100 ml con válvula").map((a) => a.role)).toEqual(["DISPENSADOR"]);
    expect(accessoriesNeededBy("Frasco spray 60 ml").map((a) => a.role)).toEqual(["DISPENSADOR"]);
    expect(accessoriesNeededBy("Botella shampoo 250 ml").map((a) => a.role)).toEqual(["CIERRE"]);
    expect(accessoriesNeededBy("Envase airless 30 ml").map((a) => a.role)).toEqual(["DISPENSADOR"]);
    expect(accessoriesNeededBy("Envase roll-on 10 ml").map((a) => a.role).sort()).toEqual(["CIERRE", "DISPENSADOR"]);
    expect(accessoriesNeededBy("Etiqueta serum")).toEqual([]);
    expect(accessoriesNeededBy("Bolsa de polietileno")).toEqual([]);
  });
});

describe("necesidad, stock y faltante", () => {
  it("ejemplo del pedido: 2.000 uds → frasco 1.200 (faltan 800), dropper 0 (faltan 2.000), etiqueta 2.500 (ok)", () => {
    const [r] = run([job("a", 2000)], [cfg("1", "FR", "ENVASE"), cfg("2", "DR", "DISPENSADOR"), cfg("3", "ET", "ETIQUETA")], { FR: 1200, DR: 0, ET: 2500 });
    expect(r!.lines.map((l) => [l.materialCodigo, l.needed, l.stock, l.faltante])).toEqual([["FR", 2000, 1200, 800], ["DR", 2000, 0, 2000], ["ET", 2000, 2500, 0]]);
    expect(r!.state).toBe("STOCK_INSUFICIENTE");
  });
  it("consumo por unidad ≠ 1 y stock negativo se toma como 0 disponible", () => {
    const [r] = run([job("a", 100)], [cfg("1", "ET", "ETIQUETA", { qtyPerUnit: 2 })], { ET: -5 });
    expect(r!.lines[0]).toMatchObject({ needed: 200, stock: 0, faltante: 200 });
  });
  it("dos trabajos con el mismo material: las mismas unidades no alcanzan para ambos", () => {
    const rs = run([job("a", 600, "2026-11-02"), job("b", 600, "2026-11-03")], [cfg("1", "FR", "ENVASE")], { FR: 1000 });
    expect(rs.map((r) => r.lines[0]!.faltante)).toEqual([0, 200]);
  });
  it("stock suficiente para todos → completo", () => {
    const rs = run([job("a", 600), job("b", 400, "2026-11-03")], [cfg("1", "ET", "ETIQUETA")], { ET: 1000 });
    expect(rs.map((r) => r.state)).toEqual(["COMPLETO", "COMPLETO"]);
  });
  it("2) envase con stock pero sin tapa/dispensador → material sin identificar (con la necesidad estimada)", () => {
    const [r] = run([job("a", 500)], [cfg("1", "POTE", "ENVASE")], { POTE: 9999 });
    expect(r!.state).toBe("MATERIAL_SIN_IDENTIFICAR");
    expect(r!.lines.find((l) => l.state === "SIN_IDENTIFICAR")).toMatchObject({ role: "CIERRE", needed: 500, materialCodigo: null, faltante: 0 });
  });
  it("3/4/5) frasco gotero sin dropper, pote sin tapa, botella sin válvula", () => {
    for (const [code, role] of [["FR", "DISPENSADOR"], ["POTE", "CIERRE"], ["BOT", "DISPENSADOR"]] as const) {
      const [r] = run([job("a", 10)], [cfg("1", code, "ENVASE")], { [code]: 100 });
      expect(r!.lines.find((l) => l.state === "SIN_IDENTIFICAR")?.role).toBe(role);
    }
  });
  it("1) producto sin ningún ME asociado → sin asociación (no se inventa ningún faltante de SKU)", () => {
    const [r] = run([job("a", 10)], [], {});
    expect(r).toMatchObject({ sinAsociacion: true, state: "MATERIAL_SIN_IDENTIFICAR", lines: [] });
  });
  it("una sugerencia no reserva stock ni se da por confirmada; un rol pendiente no inventa SKU", () => {
    const rs = run([job("a", 100), job("b", 100, "2026-11-03")], [cfg("1", "FR", "ENVASE"), cfg("2", "DR", "DISPENSADOR", { status: "SUGERIDO", source: "IA" }), cfg("3", null, "ETIQUETA", { status: "PENDIENTE" })], { FR: 150, DR: 500 });
    expect(rs[0]!.lines.map((l) => [l.materialCodigo, l.confirmation, l.state, l.faltante])).toEqual([["FR", "CONFIRMADO", "OK", 0], ["DR", "SUGERIDO", "PENDIENTE_CONFIRMACION", 0], [null, "PENDIENTE", "SIN_IDENTIFICAR", 0]]);
    expect(rs[1]!.lines[0]).toMatchObject({ faltante: 50 });
  });
  it("cantidad no legible (kg): pendiente de confirmación, nunca un faltante inventado", () => {
    const [r] = run([job("a", null)], [cfg("1", "ET", "ETIQUETA")], { ET: 10 });
    expect(r).toMatchObject({ qtyIssue: true, state: "PENDIENTE_CONFIRMACION" });
    expect(r!.lines[0]).toMatchObject({ needed: null, faltante: 0 });
  });
  it("material rechazado no cuenta; código inexistente en el inventario se ve como «sin datos», no 0", () => {
    const [r] = run([job("a", 10)], [cfg("1", "ET", "ETIQUETA"), cfg("2", "DR", "DISPENSADOR", { status: "RECHAZADO" }), cfg("3", "NOEXISTE", "OTRO")], { ET: 100 });
    expect(r!.lines.map((l) => l.materialCodigo)).toEqual(["ET", "NOEXISTE"]);
    expect(r!.lines[1]!.stock).toBe(0);
  });
});

describe("alertas: agrupación, huella y reapertura", () => {
  const findingOf = (qty: number, stock: number) => buildFindings("2026-11-02", run([job("a", qty)], [cfg("1", "FR", "ENVASE"), cfg("2", "DR", "DISPENSADOR"), cfg("3", "ET", "ETIQUETA")], { FR: stock, DR: 5000, ET: 5000 }))[0]!;
  it("solo hay hallazgo si hay algo que avisar", () => {
    expect(buildFindings("2026-11-02", run([job("a", 10)], [cfg("1", "ET", "ETIQUETA")], { ET: 100 }))).toEqual([]);
  });
  it("misma huella para el mismo problema; cambia al variar el faltante", () => {
    expect(findingHash(findingOf(2000, 1200))).toBe(findingHash(findingOf(2000, 1200)));
    expect(findingHash(findingOf(2000, 1200))).not.toBe(findingHash(findingOf(2000, 1000)));
  });
  it("worsened: faltante que crece ≥ 10 %, clave nueva; no si mejora o crece poco", () => {
    expect(worsened({ "F|CONFIRMADO|FR": 800 }, { "F|CONFIRMADO|FR": 700 })).toBe(false);
    expect(worsened({ "F|CONFIRMADO|FR": 800 }, { "F|CONFIRMADO|FR": 805 })).toBe(false);
    expect(worsened({ "F|CONFIRMADO|FR": 800 }, { "F|CONFIRMADO|FR": 1000 })).toBe(true);
    expect(worsened({ "F|CONFIRMADO|FR": 800 }, { "F|CONFIRMADO|FR": 800, "F|CONFIRMADO|DR": 1 })).toBe(true);
    expect(worsened({ "J|a": 1 }, { "J|a": 1, "J|b": 1 })).toBe(true);
  });
  it("transiciones: crear, actualizar sin duplicar, cerrada no se reabre salvo que empeore, resuelta reaparece, sin hallazgo resuelve", () => {
    const f = findingOf(2000, 1200);
    expect(decideTransition(null, f)).toEqual({ type: "create" });
    expect(decideTransition({ status: "ABIERTA" }, f)).toEqual({ type: "update", status: "ABIERTA", reopened: false });
    expect(decideTransition({ status: "CERRADA", closedKeys: f.keys }, f)).toEqual({ type: "update", status: "CERRADA", reopened: false });
    expect(decideTransition({ status: "CERRADA", closedKeys: f.keys }, findingOf(3000, 1200))).toEqual({ type: "update", status: "ABIERTA", reopened: true });
    expect(decideTransition({ status: "RESUELTA" }, f)).toEqual({ type: "update", status: "ABIERTA", reopened: true });
    expect(decideTransition({ status: "ABIERTA" }, null)).toEqual({ type: "resolve" });
    expect(decideTransition({ status: "RESUELTA" }, null)).toEqual({ type: "noop" });
  });
  it("agrega los trabajos del mismo producto en la semana", () => {
    const [f] = buildFindings("2026-11-02", run([job("a", 600), job("b", 600, "2026-11-03")], [cfg("1", "FR", "ENVASE")], { FR: 1000 }));
    expect(f).toMatchObject({ totalQty: 1200, shortages: [expect.objectContaining({ faltante: 200, needed: 1200 })] });
    expect(f!.jobs).toHaveLength(2);
  });
});

describe("sugerencias", () => {
  const catalog = [
    { codigo: "FR", descripcion: "Frasco gotero 30 ml Aqualo", cliente: "AQUALO", producto: "SERUM" },
    { codigo: "DR-A", descripcion: "Dropper Aqualo 30 ml", cliente: "AQUALO", producto: "" },
    { codigo: "DR-B", descripcion: "Dropper otra marca", cliente: "OTRO", producto: "" },
    { codigo: "ET", descripcion: "Etiqueta Aqualo Serum", cliente: "AQUALO", producto: "SERUM" },
  ];
  it("producto sin nada: sugiere (sin confirmar) lo que el Stock ME ya liga a ese cliente y producto, y detecta el hueco del dropper", () => {
    const r = deterministicSuggestions({ client: "AQUALO", product: "SERUM", rows: [], catalog, compat: [] });
    expect(r.suggestions.map((s) => [s.materialCodigo, s.role, s.source])).toEqual([["FR", "ENVASE", "INVENTARIO"], ["ET", "ETIQUETA", "INVENTARIO"]]);
    expect(r.gaps).toHaveLength(1);
    expect(r.gaps[0]!.candidates.map((c) => c.codigo)).toEqual(["DR-A"]); // solo del mismo cliente: el nombre parecido de otro cliente no cuenta
  });
  it("una compatibilidad registrada por una persona se usa; una INCOMPATIBLE jamás", () => {
    const rows = [cfg("1", "FR", "ENVASE")];
    const ok = deterministicSuggestions({ client: "AQUALO", product: "SERUM", rows, catalog, compat: [{ baseCodigo: "FR", accessoryCodigo: "DR-A", status: "COMPATIBLE" }] });
    expect(ok.suggestions).toEqual([expect.objectContaining({ materialCodigo: "DR-A", source: "COMPATIBILIDAD" })]);
    const bad = deterministicSuggestions({ client: "AQUALO", product: "SERUM", rows, catalog, compat: [{ baseCodigo: "FR", accessoryCodigo: "DR-A", status: "INCOMPATIBLE" }] });
    expect(bad.suggestions).toEqual([]);
    expect(bad.gaps[0]!.candidates).toEqual([]);
  });
  it("lo rechazado no se vuelve a sugerir", () => {
    const rows = [cfg("1", "FR", "ENVASE"), cfg("2", "DR-A", "DISPENSADOR", { status: "RECHAZADO" })];
    expect(deterministicSuggestions({ client: "AQUALO", product: "SERUM", rows, catalog, compat: [{ baseCodigo: "FR", accessoryCodigo: "DR-A", status: "COMPATIBLE" }] }).suggestions).toEqual([]);
  });
  it("la respuesta de la IA se valida: código inventado, no_compatible o formato roto se descartan", () => {
    const { gaps } = deterministicSuggestions({ client: "AQUALO", product: "SERUM", rows: [cfg("1", "FR", "ENVASE")], catalog, compat: [] });
    expect(buildAccessoryPrompt("AQUALO", "SERUM", gaps)).toContain("NO asumas compatibilidad");
    expect(parseAccessoryAnswer({ results: [{ gapId: "0", options: [{ code: "XXX", verdict: "compatible", reason: "x" }] }] }, gaps)).toEqual([]);
    expect(parseAccessoryAnswer({ results: [{ gapId: "0", options: [{ code: "DR-A", verdict: "no_compatible", reason: "x" }] }] }, gaps)).toEqual([]);
    expect(parseAccessoryAnswer("basura", gaps)).toEqual([]);
    const ok = parseAccessoryAnswer({ results: [{ gapId: "0", options: [{ code: "dr-a", verdict: "probable", reason: "misma medida" }] }] }, gaps);
    expect(ok[0]!.suggestion).toMatchObject({ materialCodigo: "DR-A", source: "IA", role: "DISPENSADOR" });
    expect(ok[0]!.suggestion.reason).toMatch(/requiere confirmación/);
  });
});
