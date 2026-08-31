import { describe, expect, it } from "vitest";
import { computeKg, formatKg, parseOptionalDecimal } from "./kg";
import {
  normalizeHeaderKey,
  parseExcelPaste,
  resolveHeaderField,
  splitCols,
} from "./excel-paste";
import {
  canAccessProductionPedidos,
  coercePedidoFields,
  normalizeFecha,
  normalizeStatus,
  PRODUCTION_PEDIDO_STATUS_LABELS,
  PRODUCTION_PEDIDO_STATUSES,
} from "./types";
import {
  getProductionPedidosService,
  resetProductionPedidosMemoryForTests,
} from "./service";

describe("EN_CODIFICADO — estado real y distinto (migración 0029)", () => {
  it("normaliza variantes de EN_CODIFICADO", () => {
    expect(normalizeStatus("EN_CODIFICADO")).toBe("EN_CODIFICADO");
    expect(normalizeStatus("EN CODIFICADO")).toBe("EN_CODIFICADO");
    expect(normalizeStatus("en codificado")).toBe("EN_CODIFICADO");
  });

  it("está en la lista oficial de estados, entre EN_ENVASADO y LISTO_PARA_ENTREGAR", () => {
    const idxEnvasado = PRODUCTION_PEDIDO_STATUSES.indexOf("EN_ENVASADO");
    const idxCodificado = PRODUCTION_PEDIDO_STATUSES.indexOf("EN_CODIFICADO");
    const idxListo = PRODUCTION_PEDIDO_STATUSES.indexOf("LISTO_PARA_ENTREGAR");
    expect(idxCodificado).toBeGreaterThan(idxEnvasado);
    expect(idxCodificado).toBeLessThan(idxListo);
  });

  it("tiene etiqueta propia, distinta de EN_ENVASADO", () => {
    expect(PRODUCTION_PEDIDO_STATUS_LABELS.EN_CODIFICADO).toBe("EN CODIFICADO");
    expect(PRODUCTION_PEDIDO_STATUS_LABELS.EN_CODIFICADO).not.toBe(
      PRODUCTION_PEDIDO_STATUS_LABELS.EN_ENVASADO
    );
  });
});

describe("production pedidos kg", () => {
  it("Q=100 ML=30 → KG=3", () => {
    expect(computeKg(100, 30)).toBe(3);
    expect(formatKg(3)).toBe("3");
  });

  it("admite coma decimal y formatea sin ceros", () => {
    expect(parseOptionalDecimal("30,5")).toBe(30.5);
    expect(formatKg(computeKg(10, 33.3))).toBe("0.333");
  });

  it("deja vacío si falta Q o ML", () => {
    expect(computeKg(null, 30)).toBeNull();
    expect(computeKg(100, null)).toBeNull();
    expect(formatKg(null)).toBe("");
  });
});

describe("header aliases", () => {
  it("normaliza acentos, grados y puntuación", () => {
    expect(normalizeHeaderKey(" N° OC ")).toBe("n oc");
    expect(normalizeHeaderKey("Nº OC")).toBe("n oc");
    expect(normalizeHeaderKey("O.P.")).toBe("o p");
    expect(normalizeHeaderKey("M.L.")).toBe("m l");
    expect(normalizeHeaderKey("RAZÓN SOCIAL")).toBe("razon social");
    expect(normalizeHeaderKey("PRODUCTO / DESCRIPCIÓN")).toBe("producto descripcion");
  });

  it("resuelve aliases ampliados", () => {
    expect(resolveHeaderField("ORDEN DE COMPRA")).toBe("nroOc");
    expect(resolveHeaderField("CANTIDAD")).toBe("q");
    expect(resolveHeaderField("UNIDADES")).toBe("q");
    expect(resolveHeaderField("MILILITROS")).toBe("ml");
    expect(resolveHeaderField("SITUACION")).toBe("estado");
    expect(resolveHeaderField("KILOS")).toBe("kgIgnored");
    expect(resolveHeaderField("EXTRA COL")).toBeNull();
  });
});

describe("production pedidos paste by header order", () => {
  it("columnas completamente desordenadas se asocian por título", () => {
    const text = [
      "CLIENTE\tPRODUCTO\tFECHA\tQ\tML\tOP\tESTADO\tN° OC\tS",
      "Acme\tGel\t3/8/2026\t100\t30\t0012\tINGRESO\t0009\tA",
    ].join("\n");
    const { rows, headerDetected, mode, associations } = parseExcelPaste(text);
    expect(headerDetected).toBe(true);
    expect(mode).toBe("by-header");
    expect(rows[0]!.op).toBe("0012");
    expect(rows[0]!.nroOc).toBe("0009");
    expect(rows[0]!.cliente).toBe("Acme");
    expect(rows[0]!.producto).toBe("Gel");
    expect(rows[0]!.q).toBe(100);
    expect(rows[0]!.ml).toBe(30);
    expect(rows[0]!.kg).toBe(3);
    expect(rows[0]!.fecha).toBe("2026-08-03");
    expect(associations.some((a) => a.sourceHeader === "CLIENTE" && a.field === "cliente")).toBe(
      true
    );
  });

  it("Q antes de Cliente y ML antes de Producto", () => {
    const text = [
      "Q\tCLIENTE\tML\tPRODUCTO\tOP",
      "100\tBeta\t30\tCrema\t07",
    ].join("\n");
    const { rows } = parseExcelPaste(text);
    expect(rows[0]!.q).toBe(100);
    expect(rows[0]!.cliente).toBe("Beta");
    expect(rows[0]!.ml).toBe(30);
    expect(rows[0]!.producto).toBe("Crema");
    expect(rows[0]!.op).toBe("07");
    expect(rows[0]!.kg).toBe(3);
  });

  it("celdas vacías intermedias no desplazan columnas", () => {
    const line = "A\t\tC\t";
    expect(splitCols(line)).toEqual(["A", "", "C", ""]);
    const text = ["OP\tFECHA\tNRO OC\tCLIENTE", "01\t\t008\t"].join("\n");
    const { rows } = parseExcelPaste(text);
    expect(rows[0]!.op).toBe("01");
    expect(rows[0]!.fecha).toBeNull();
    expect(rows[0]!.nroOc).toBe("008");
    expect(rows[0]!.cliente).toBeNull();
  });

  it("columnas desconocidas se ignoran", () => {
    const text = ["OP\tFOO\tQ\tML", "1\tx\t100\t30"].join("\n");
    const { rows, ignoredHeaders } = parseExcelPaste(text);
    expect(ignoredHeaders).toContain("FOO");
    expect(rows[0]!.kg).toBe(3);
  });

  it("solo algunas columnas", () => {
    const text = ["CLIENTE\tPRODUCTO", "Solo\tEsto"].join("\n");
    const { rows, headerDetected } = parseExcelPaste(text);
    expect(headerDetected).toBe(true);
    expect(rows[0]!.cliente).toBe("Solo");
    expect(rows[0]!.producto).toBe("Esto");
    expect(rows[0]!.valid).toBe(true);
  });

  it("encabezados minúsculas y con acentos", () => {
    const text = ["cliente\tproducto\tfecha", "x\ty\t5/8/26"].join("\n");
    const { rows } = parseExcelPaste(text);
    expect(rows[0]!.fecha).toBe("2026-08-05");
  });

  it("variantes N°/Nº/NRO OC", () => {
    for (const h of ["N° OC", "Nº OC", "NRO OC", "NRO. OC", "ORDEN DE COMPRA"]) {
      const text = `${h}\tQ\tML\n0001\t100\t30`;
      const { rows } = parseExcelPaste(text);
      expect(rows[0]!.nroOc).toBe("0001");
      expect(rows[0]!.kg).toBe(3);
    }
  });

  it("KG pegado incorrecto se recalcula", () => {
    const text = [
      "OP\tFECHA\tN° OC\tCLIENTE\tPRODUCTO\tS\tQ\tML\tKG\tESTADO",
      "07\t5/8/26\t008\tAcme\tGel\tB\t100\t30\t999\tEN PROCESO",
    ].join("\n");
    const { rows, headerDetected } = parseExcelPaste(text);
    expect(headerDetected).toBe(true);
    expect(rows[0]!.kg).toBe(3);
    expect(rows[0]!.estado).toBe("EN_ELABORACION");
  });

  it("sin encabezados usa orden estándar", () => {
    const text = "0012\t03/08/2026\t0C99\tCliente\tProd\tA\t100\t30\tINGRESO";
    const { rows, headerDetected, mode } = parseExcelPaste(text);
    expect(headerDetected).toBe(false);
    expect(mode).toBe("by-position");
    expect(rows[0]!.op).toBe("0012");
    expect(rows[0]!.kg).toBe(3);
  });

  it("forcePosition ignora encabezados", () => {
    const text = ["CLIENTE\tPRODUCTO", "Acme\tGel"].join("\n");
    const forced = parseExcelPaste(text, { forcePosition: true });
    expect(forced.mode).toBe("by-position");
    expect(forced.rows[0]!.op).toBe("CLIENTE");
  });

  it("encabezados duplicados marcan conflicto y usan el primero", () => {
    const text = ["OP\tOP\tQ\tML", "01\t99\t100\t30"].join("\n");
    const { associations, rows } = parseExcelPaste(text);
    expect(associations.some((a) => a.status === "conflict")).toBe(true);
    expect(rows[0]!.op).toBe("01");
    expect(rows[0]!.kg).toBe(3);
  });

  it("coma decimal", () => {
    const text = ["Q\tML", "10,5\t20"].join("\n");
    const { rows } = parseExcelPaste(text);
    expect(rows[0]!.q).toBe(10.5);
    expect(rows[0]!.kg).toBe(0.21);
  });

  it("marca posibles duplicados", () => {
    const text =
      "1\t1/1/2026\tOC1\tC\tP\t\t1\t1\tINGRESO\n1\t1/1/2026\tOC1\tC\tP\t\t1\t1\tINGRESO";
    const { rows } = parseExcelPaste(text, ["1|oc1|c|p|2026-01-01"]);
    expect(rows[1]!.warnings.some((w) => /duplicado/i.test(w))).toBe(true);
  });
});

describe("production pedidos dates", () => {
  it("reconoce fechas argentinas e ISO", () => {
    expect(normalizeFecha("3/8/2026")).toBe("2026-08-03");
    expect(normalizeFecha("03-08-26")).toBe("2026-08-03");
    expect(normalizeFecha("2026-08-03")).toBe("2026-08-03");
  });
});

describe("production pedidos rbac + crud + import idempotency", () => {
  it("solo PRODUCCION / SUPERADMIN", () => {
    expect(canAccessProductionPedidos({ email: "a", sector: "PRODUCCION" })).toBe(true);
    expect(canAccessProductionPedidos({ email: "a", sector: "CALIDAD" })).toBe(false);
    expect(canAccessProductionPedidos({ email: "a", sector: "CALIDAD", roleId: "ROL-SU" })).toBe(
      true
    );
  });

  it("CRUD + delete con motivo + KG server-side", async () => {
    resetProductionPedidosMemoryForTests();
    const svc = getProductionPedidosService();
    const actor = { email: "produccion@test", sector: "PRODUCCION" as const };

    const created = await svc.create(actor, {
      op: "001",
      q: "100",
      ml: "30",
      estado: "INGRESO",
    });
    expect(created.kg).toBe(3);

    const updated = await svc.update(actor, created.id, {
      op: "001",
      q: "200",
      ml: "30",
      estado: "EN PROCESO",
    });
    expect(updated.kg).toBe(6);

    const deletedShort = await svc.remove(actor, created.id, "x");
    expect(deletedShort.deletedAt).toBeTruthy();
    expect(deletedShort.deleteReason).toBe("x");
    // recreate for full-reason path
    const created2 = await svc.create(actor, {
      op: "001b",
      q: "100",
      ml: "30",
      estado: "INGRESO",
    });
    const deleted = await svc.remove(actor, created2.id, "Pedido de prueba");
    expect(deleted.deletedAt).toBeTruthy();
    expect(deleted.deleteReason).toBe("Pedido de prueba");

    const created3 = await svc.create(actor, {
      op: "001c",
      q: "50",
      ml: "30",
      estado: "INGRESO",
    });
    const deletedEmpty = await svc.remove(actor, created3.id, "   ");
    expect(deletedEmpty.deleteReason).toBe("Sin motivo informado");
  });

  it("import idempotente no duplica", async () => {
    resetProductionPedidosMemoryForTests();
    const svc = getProductionPedidosService();
    const actor = { email: "produccion@test", sector: "PRODUCCION" as const };
    const rows = [{ op: "IDEM1", q: 100, ml: 30, estado: "INGRESO" }];
    const first = await svc.importMany(actor, rows, { idempotencyKey: "idem-key-12345" });
    expect(first.inserted).toBe(1);
    expect(first.idempotentReplay).toBe(false);
    const second = await svc.importMany(actor, rows, { idempotencyKey: "idem-key-12345" });
    expect(second.idempotentReplay).toBe(true);
    expect(second.inserted).toBe(1);
    const list = await svc.list(actor);
    expect(list.items.filter((i) => i.op === "IDEM1")).toHaveLength(1);
  });

  it("campos opcionales permiten guardar vacío parcial", () => {
    const c = coercePedidoFields({ cliente: "Solo cliente" });
    expect(c.errors).toEqual([]);
    expect(c.kg).toBeNull();
  });

  it("prohíbe otros sectores", async () => {
    resetProductionPedidosMemoryForTests();
    const svc = getProductionPedidosService();
    await expect(svc.list({ email: "x", sector: "CODIFICADO" })).rejects.toThrow(/PRODUCCIÓN/i);
  });

  it("7/8) búsqueda combinada (search): encuentra por N° de Pedido, Cliente o Producto con un solo término", async () => {
    resetProductionPedidosMemoryForTests();
    const svc = getProductionPedidosService();
    const actor = { email: "produccion@test", sector: "PRODUCCION" as const };
    await svc.create(actor, { op: "OP-4521", cliente: "TCL", producto: "Shampoo Anticaspa", q: "5000" });
    await svc.create(actor, { op: "OP-4522", cliente: "Belleza Total", producto: "Crema Base", q: "2000" });
    await svc.create(actor, { op: "OP-9999", cliente: "TCL", producto: "Acondicionador", q: "3000" });

    const byNumero = await svc.list(actor, { search: "OP-4521" });
    expect(byNumero.items.map((i) => i.op)).toEqual(["OP-4521"]);

    const byCliente = await svc.list(actor, { search: "TCL" });
    expect(byCliente.items.map((i) => i.op).sort()).toEqual(["OP-4521", "OP-9999"]);

    const byProducto = await svc.list(actor, { search: "Shampoo" });
    expect(byProducto.items.map((i) => i.op)).toEqual(["OP-4521"]);

    const noMatch = await svc.list(actor, { search: "no-existe-xyz" });
    expect(noMatch.items).toEqual([]);
  });
});
