import { describe, expect, it } from "vitest";
import {
  canConfigUbicaciones, canReadUbicaciones, canRetireOrRename, canWriteUbicaciones, cellState, checkStockCap, clientsLabel, computeIndicators, groupZones,
  locationMatches, locationStatus, materialKeyOf, mergeQuantity, normalizeText, parseGeometry, parseLineInput, parseLocationCode, parsePolygon, parseQuantity, planMove, searchLocations,
} from "./rules";

const item = (clientName: string, material: string, codigo: string | null = null) => ({ clientName, clientKey: clientName.toLowerCase(), material, codigo });
const loc = (code: string, items: ReturnType<typeof item>[] = [], active = true, zone = "Z") => ({ id: code, code, zone, active, items, sortOrder: 0 });

describe("permisos por sector", () => {
  it("lectura: Depósito, Envasado Masivo/Premium, Producción y Dirección", () => {
    for (const s of ["DEPOSITO", "ENVASADO_MASIVO", "ENVASADO_PREMIUM", "PRODUCCION", "DIRECCION"]) expect(canReadUbicaciones(s)).toBe(true);
    for (const s of ["CODIFICADO", "ELABORACION", "MATERIA_PRIMA", "ADMINISTRACION", "CALIDAD", "", null, undefined]) expect(canReadUbicaciones(s)).toBe(false);
  });
  it("escritura de contenido: solo Depósito; configuración: Depósito y Dirección", () => {
    expect(["DEPOSITO", "DIRECCION", "ENVASADO_MASIVO", "ENVASADO_PREMIUM", "PRODUCCION"].filter(canWriteUbicaciones)).toEqual(["DEPOSITO"]);
    expect(["DEPOSITO", "DIRECCION", "ENVASADO_MASIVO", "ENVASADO_PREMIUM", "PRODUCCION"].filter(canConfigUbicaciones)).toEqual(["DEPOSITO", "DIRECCION"]);
  });
});

describe("búsqueda con normalización", () => {
  const locs = [loc("A02", [item("TRC", "Frascos de shampoo 250 ml", "FR-250"), item("TRC", "Tapas negras")]), loc("B05", [item("B.L. Cosmetics S.A.", "Etiquetas")]), loc("A03"), loc("C01", [item("TRC Cosmetics", "Cajas")], false)];
  it("por cliente (sin acentos ni mayúsculas) y por clave unificada", () => {
    expect(searchLocations(locs, "trc").map((l) => l.code)).toEqual(["A02"]);
    expect(searchLocations(locs, "bl cosmetics").map((l) => l.code)).toEqual(["B05"]);
    expect(searchLocations(locs, "COSMETICS").map((l) => l.code)).toEqual(["B05"]);
  });
  it("por material, por código de material y por código de ubicación (a2 = A02)", () => {
    expect(locationMatches(locs[0]!, "FRÁSCOS")).toBe(true);
    expect(locationMatches(locs[0]!, "fr-250")).toBe(true);
    expect(searchLocations(locs, "a2").map((l) => l.code)).toEqual(["A02"]);
    expect(searchLocations(locs, "B05").map((l) => l.code)).toEqual(["B05"]);
    expect(searchLocations(locs, "a").map((l) => l.code).sort()).toEqual(["A02", "A03", "B05"]);
  });
  it("consulta vacía no resalta nada; las inactivas no aparecen", () => {
    expect(searchLocations(locs, "  ")).toEqual([]);
    expect(searchLocations(locs, "cajas")).toEqual([]);
  });
  it("normalizeText", () => expect(normalizeText("  CÁÑO  Plástico ")).toBe("cano plastico"));
});

describe("estados e indicadores", () => {
  it("ocupada / libre y prioridad seleccionada > resultado > estado", () => {
    expect(locationStatus({ items: [] })).toBe("LIBRE");
    expect(locationStatus({ items: [1] })).toBe("OCUPADA");
    const occ = { active: true, items: [1] };
    expect(cellState(occ, { selected: false, match: false })).toBe("OCUPADA");
    expect(cellState({ active: true, items: [] }, { selected: false, match: false })).toBe("LIBRE");
    expect(cellState(occ, { selected: false, match: true })).toBe("RESULTADO");
    expect(cellState(occ, { selected: true, match: true })).toBe("SELECCIONADA");
    expect(cellState({ active: false, items: [] }, { selected: true, match: true })).toBe("INACTIVA");
  });
  it("indicadores: solo activas; total = ocupadas + libres", () => {
    const ls = [...Array.from({ length: 24 }, () => ({ active: true, items: [1] })), ...Array.from({ length: 12 }, () => ({ active: true, items: [] })), { active: false, items: [] }];
    expect(computeIndicators(ls)).toEqual({ total: 36, ocupadas: 24, libres: 12 });
  });
  it("etiqueta de clientes y zonas", () => {
    expect(clientsLabel([])).toBe("");
    expect(clientsLabel([item("TRC", "a"), item("TRC", "b")])).toBe("TRC");
    expect(clientsLabel([item("TRC", "a"), item("Otro", "b")])).toBe("TRC +1");
    const z = groupZones([{ code: "A02", zone: "Izq", active: true, sortOrder: 2 }, { code: "A01", zone: "Izq", active: true, sortOrder: 1 }, { code: "B01", zone: "Der", active: false, sortOrder: 3 }]);
    expect(z).toEqual([{ zone: "Izq", from: "A01", to: "A02", count: 2, items: expect.any(Array) }]);
  });
});

describe("cantidades", () => {
  it("acepta formatos es-AR y limita decimales", () => {
    expect(parseQuantity("2.000")).toEqual({ ok: true, value: 2000 });
    expect(parseQuantity("2.000,5")).toEqual({ ok: true, value: 2000.5 });
    expect(parseQuantity(1500)).toEqual({ ok: true, value: 1500 });
    expect(parseQuantity("2000.5")).toEqual({ ok: true, value: 2000.5 });
    expect(parseQuantity("")).toMatchObject({ ok: false });
    expect(parseQuantity("", { allowNull: true })).toEqual({ ok: true, value: null });
    for (const bad of [0, -1, "abc", Number.NaN, 1e9, 1.0005]) expect(parseQuantity(bad)).toMatchObject({ ok: false });
  });
  it("línea: cliente normalizado, material, vínculo ME exige código y cantidad", () => {
    expect(parseLineInput({ clientName: " TRC ", material: "Tapas", quantity: "10" })).toMatchObject({ ok: true, value: { clientName: "TRC", quantity: 10, unit: "u", materialKey: "t:tapas" } });
    expect(parseLineInput({ clientName: "", material: "x" })).toMatchObject({ ok: false });
    expect(parseLineInput({ clientName: "sin cliente", material: "x" })).toMatchObject({ ok: false });
    expect(parseLineInput({ clientName: "TRC", material: "" })).toMatchObject({ ok: false });
    expect(parseLineInput({ clientName: "TRC", material: "x", meMaterialId: "id" })).toMatchObject({ ok: false });
    expect(parseLineInput({ clientName: "TRC", material: "x", codigo: " fr 1 ", meMaterialId: "id", quantity: 5 })).toMatchObject({ ok: true, value: { codigo: "FR 1", materialKey: "me:FR 1" } });
    expect(materialKeyOf({ codigo: null, name: "Tapa  Negra" })).toBe("t:tapa negra");
  });
});

describe("aritmética de traslado", () => {
  const items = [{ id: "a", quantity: 2000, material: "frascos" }, { id: "b", quantity: null, material: "cajas" }, { id: "c", quantity: 0.3, material: "kg" }];
  it("parcial: 500 de 2.000 → quedan 1.500 y suma exacta", () => {
    const r = planMove(items, [{ itemId: "a", quantity: 500 }]);
    expect(r).toEqual({ ok: true, value: [{ itemId: "a", moveMilli: 500_000, remainMilli: 1_500_000, whole: false }] });
  });
  it("null = completo; igual a lo que hay = completo", () => {
    expect(planMove(items, [{ itemId: "a", quantity: null }])).toMatchObject({ ok: true, value: [{ whole: true, remainMilli: 0 }] });
    expect(planMove(items, [{ itemId: "a", quantity: 2000 }])).toMatchObject({ ok: true, value: [{ whole: true }] });
  });
  it("sin deriva de punto flotante (0,1 + 0,2)", () => {
    const r = planMove([{ id: "x", quantity: 0.3 }], [{ itemId: "x", quantity: 0.1 }]);
    expect(r).toMatchObject({ ok: true, value: [{ moveMilli: 100, remainMilli: 200 }] });
    expect(mergeQuantity(0.1, 200)).toBe(0.3);
  });
  it("rechaza exceso, repetidos, inexistentes, vacío y parcial sin cantidad", () => {
    expect(planMove(items, [{ itemId: "a", quantity: 2000.001 }])).toMatchObject({ ok: false });
    expect(planMove(items, [{ itemId: "a", quantity: 1 }, { itemId: "a", quantity: 1 }])).toMatchObject({ ok: false });
    expect(planMove(items, [{ itemId: "zz", quantity: 1 }])).toMatchObject({ ok: false });
    expect(planMove(items, [])).toMatchObject({ ok: false });
    expect(planMove(items, [{ itemId: "b", quantity: 1 }])).toMatchObject({ ok: false });
    expect(planMove(items, [{ itemId: "b", quantity: null }])).toMatchObject({ ok: true, value: [{ moveMilli: null, remainMilli: null }] });
  });
  it("mezcla en destino", () => {
    expect(mergeQuantity(null, null)).toBeNull();
    expect(mergeQuantity(10, null)).toBe(10);
    expect(mergeQuantity(null, 5000)).toBe(5);
    expect(mergeQuantity(1500, 500_000)).toBe(2000);
  });
});

describe("tope por stock disponible", () => {
  it("permite hasta el stock y rechaza el exceso con el margen que queda", () => {
    expect(checkStockCap({ available: 1000, elsewhere: 600, adding: 400, label: "Frasco" })).toEqual({ ok: true, value: true });
    const r = checkStockCap({ available: 1000, elsewhere: 600, adding: 401, label: "Frasco" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/hasta 400 más/);
    expect(checkStockCap({ available: -5, elsewhere: 0, adding: 1, label: "x" }).ok).toBe(false);
  });
});

describe("configuración del mapa", () => {
  it("código", () => {
    expect(parseLocationCode(" a 02 ")).toEqual({ ok: true, value: "A02" });
    for (const bad of ["", "bad code!", "X".repeat(13), "-A"]) expect(parseLocationCode(bad)).toMatchObject({ ok: false });
  });
  it("geometría dentro del plano y tamaño mínimo", () => {
    const c = { width: 400, height: 740 };
    expect(parseGeometry({ x: 10, y: "20,5", w: 50, h: 36 }, c)).toEqual({ ok: true, value: { x: 10, y: 20.5, w: 50, h: 36 } });
    expect(parseGeometry({ x: 380, y: 0, w: 50, h: 36 }, c)).toMatchObject({ ok: false });
    expect(parseGeometry({ x: 0, y: 0, w: 4, h: 36 }, c)).toMatchObject({ ok: false });
    expect(parseGeometry({ x: "a", y: 0, w: 10, h: 10 }, c)).toMatchObject({ ok: false });
  });
  it("solo las vacías se renombran / desactivan", () => {
    expect(canRetireOrRename({ items: [] })).toBe(true);
    expect(canRetireOrRename({ items: [1] })).toBe(false);
  });
  it("polígono", () => {
    const c = { width: 400, height: 740 };
    expect(parsePolygon("[[0,0],[400,0],[400,185]]", c)).toMatchObject({ ok: true });
    expect(parsePolygon([[0, 0], [1, 1]], c)).toMatchObject({ ok: false });
    expect(parsePolygon("no json", c)).toMatchObject({ ok: false });
    expect(parsePolygon([[0, 0], [500, 0], [1, 1]], c)).toMatchObject({ ok: false });
  });
});

describe("superposición de posiciones", () => {
  const others = [{ id: "a", code: "A01", active: true, x: 10, y: 10, w: 50, h: 36 }, { id: "b", code: "B01", active: false, x: 100, y: 10, w: 50, h: 36 }];
  it("detecta superposición, ignora bordes que se tocan, inactivas y a sí misma", async () => {
    const { findOverlap } = await import("./rules");
    expect(findOverlap({ x: 30, y: 20, w: 20, h: 20 }, others)?.code).toBe("A01");
    expect(findOverlap({ x: 60, y: 10, w: 20, h: 20 }, others)).toBeNull();
    expect(findOverlap({ x: 100, y: 10, w: 20, h: 20 }, others)).toBeNull();
    expect(findOverlap({ id: "a", x: 10, y: 10, w: 50, h: 36 }, others)).toBeNull();
  });
});

describe("verificadas, identidad e ingresos", () => {
  it("subtotales separados por condición y por unidad; nunca se suman juntas", async () => {
    const { subtotals, fmtSubtotal } = await import("./rules");
    const st = subtotals([
      { quantity: 600, unit: "u", verified: true }, { quantity: 400, unit: "u", verified: true },
      { quantity: 5000, unit: "u", verified: false }, { quantity: 2.5, unit: "kg", verified: false }, { quantity: null, unit: "u", verified: false },
    ]);
    expect(st.verified).toEqual({ rows: 2, byUnit: { u: 1000 } });
    expect(st.unverified).toEqual({ rows: 3, byUnit: { u: 5000, kg: 2.5 } });
    expect(fmtSubtotal({ rows: 1, byUnit: {} })).toBe("sin cantidad");
    expect(fmtSubtotal({ rows: 0, byUnit: {} })).toBe("0");
  });
  it("verificado ⇔ vinculado a un material ME; un código sin vínculo queda libre", async () => {
    const { isVerified } = await import("./rules");
    expect(isVerified({ meMaterialId: "x" })).toBe(true);
    expect(isVerified({ meMaterialId: null })).toBe(false);
    expect(parseLineInput({ clientName: "TRC", material: "x", codigo: "FR-1", quantity: 5 })).toMatchObject({ ok: true, value: { codigo: null, meMaterialId: null } });
    expect(parseLineInput({ clientName: "TRC", material: "x", quantity: 5, meMaterialId: "id", codigo: "A", mergeIntoItemId: "z" })).toMatchObject({ ok: false });
    expect(parseLineInput({ clientName: "TRC", material: "x", quantity: 5, mergeIntoItemId: "z" })).toMatchObject({ ok: true, value: { mergeIntoItemId: "z" } });
  });
  it("identidad: ME = id + cliente; libre = su lote, no el texto", async () => {
    const { identityOf, similarFreeItems } = await import("./rules");
    const a = { id: "1", meMaterialId: "m1", clientKey: "trc", lotKey: null };
    expect(identityOf(a)).toBe(identityOf({ ...a, id: "2" }));
    expect(identityOf(a)).not.toBe(identityOf({ ...a, meMaterialId: "m2" }));
    expect(identityOf({ id: "1", meMaterialId: null, clientKey: "trc", lotKey: null })).not.toBe(identityOf({ id: "2", meMaterialId: null, clientKey: "trc", lotKey: null }));
    expect(identityOf({ id: "9", meMaterialId: null, clientKey: "trc", lotKey: "L" })).toBe(identityOf({ id: "7", meMaterialId: null, clientKey: "trc", lotKey: "L" }));
    const items = [{ id: "1", clientKey: "trc", material: "Pomos 200 ml", meMaterialId: null }, { id: "2", clientKey: "trc", material: "Pomos 200 ml", meMaterialId: "m" }, { id: "3", clientKey: "otro", material: "Pomos 200 ml", meMaterialId: null }];
    expect(similarFreeItems(items, { clientName: "TRC", material: "pomos" }).map((i) => i.id)).toEqual(["1"]);
    expect(similarFreeItems(items, { clientName: "TRC", material: "xx" })).toEqual([]);
  });
  it("itemMatches e ingresoDelta", async () => {
    const { itemMatches, ingresoDelta } = await import("./rules");
    expect(itemMatches({ clientName: "TRC", material: "Tapas", codigo: "TP-1" }, "tp-1")).toBe(true);
    expect(itemMatches({ clientName: "TRC", material: "Tapas", codigo: null }, "zzz")).toBe(false);
    expect(ingresoDelta(1000, 800)).toEqual({ diffMilli: 200_000, kind: "AUMENTO" });
    expect(ingresoDelta(0.3, 0.1)).toEqual({ diffMilli: 200, kind: "AUMENTO" });
    expect(ingresoDelta(700, 900).kind).toBe("BAJA");
    expect(ingresoDelta(900, 900).kind).toBe("IGUAL");
  });
});
