import { beforeEach, describe, expect, it } from "vitest";
import { getDespachosService, resetDespachosMemoryForTests } from "@/lib/despachos/despachos-service";
import { despachoTotal, formatDespachoFecha, nextEgreso, parseBoolCell, validateDespachoValue } from "@/lib/despachos/cell-edit";
import { canAccessDespachos, canMutateDespachos } from "@/lib/despachos/despachos-rbac";
import { despachosToRows, filterDespachos, resumenPorPedido } from "@/lib/despachos/despachos-view-model";
import { OrdersForbiddenError } from "@/lib/orders/types";

const dep = { email: "deposito@x.com", sector: "DEPOSITO" as const, displayName: "Depósito" };
const prod = { email: "prod@x.com", sector: "PRODUCCION" as const, displayName: "Producción" };
const dir = { email: "dir@x.com", sector: "DIRECCION" as const, displayName: "Dirección" };
const env = { email: "env@x.com", sector: "ENVASADO_MASIVO" as const, displayName: "Envasado" };
const base = { fecha: "2026-10-20", egreso: "B001", remito: "0001-00004567", cliente: "ACME", producto: "Shampoo 1L", bultos: 10, cantidad: 24 };

describe("Entregas Producción (despachos)", () => {
  beforeEach(() => resetDespachosMemoryForTests());

  it("crea y lista; el remito conserva ceros a la izquierda como texto", async () => {
    const svc = getDespachosService();
    const { record } = await svc.create(dep, { ...base, remito: "000123" });
    expect(record.remito).toBe("000123");
    expect((await svc.list(dep))[0].remito).toBe("000123");
    expect(record.createdBy).toBe("Depósito");
  });

  it("idempotente: doble clic / reintento con la misma clave no duplica", async () => {
    const svc = getDespachosService();
    const a = await svc.create(dep, { ...base, idempotencyKey: "k1" });
    const b = await svc.create(dep, { ...base, idempotencyKey: "k1" });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.record.id).toBe(a.record.id);
    expect(await svc.list(dep)).toHaveLength(1);
  });

  it("dos despachos parciales del mismo pedido quedan separados y se suman", async () => {
    const svc = getDespachosService();
    await svc.create(dep, { ...base, pedidoOp: "OP-77", fecha: "2026-10-20", bultos: 4, cantidad: 25 });
    await svc.create(dep, { ...base, pedidoOp: "OP-77", fecha: "2026-10-25", remito: "0001-00004999", bultos: 6, cantidad: 23 });
    const items = await svc.list(dep);
    expect(items).toHaveLength(2);
    const [p] = resumenPorPedido(items);
    expect(p.pedidoOp).toBe("OP-77");
    expect(p.entregas).toHaveLength(2);
    expect(p.cantidadTotal).toBe(100 + 138);
    expect(p.bultos).toBe(10);
  });

  it("edición por celda con auditoría y conflicto de versión; TOTAL se recalcula solo", async () => {
    const svc = getDespachosService();
    const { record } = await svc.create(dep, base);
    expect(record.cantidadTotal).toBe(240);
    const [r1] = await svc.patchCells(dep, [{ id: record.id, field: "cantidad", value: "30", expectedVersion: record.updatedAt }]);
    expect(r1.ok && r1.record.cantidadTotal).toBe(300);
    const hist = await svc.listAudit(dep, record.id);
    expect(hist.map((h) => h.action)).toEqual(["create", "update", "update"]);
    expect(hist[1]).toMatchObject({ field: "cantidad", beforeValue: "24", afterValue: "30", actorName: "Depósito" });
    expect(hist[2]).toMatchObject({ field: "cantidadTotal", beforeValue: "240", afterValue: "300" });
    const [r2] = await svc.patchCells(dep, [{ id: record.id, field: "bultos", value: "1", expectedVersion: record.updatedAt }]);
    expect(r2.ok).toBe(false);
    expect(!r2.ok && r2.code).toBe("CONFLICT");
    // TOTAL no se edita a mano
    const [r3] = await svc.patchCells(dep, [{ id: record.id, field: "cantidadTotal" as never, value: "999", expectedVersion: record.updatedAt }]);
    expect(r3.ok).toBe(false);
    expect(!r3.ok && r3.code).toBe("INVALID");
  });

  it("rechaza negativos y fechas inválidas", async () => {
    const svc = getDespachosService();
    const { record } = await svc.create(dep, base);
    const [r] = await svc.patchCells(dep, [{ id: record.id, field: "bultos", value: "-3", expectedVersion: record.updatedAt }]);
    expect(r.ok).toBe(false);
    await expect(svc.create(dep, { ...base, fecha: "no-es-fecha" })).rejects.toThrow();
    expect((await svc.create(dep, { ...base, fecha: "" })).record.fecha).toBeNull(); // incompleta pero válida
    await expect(svc.create(dep, { ...base, cantidad: -1 })).rejects.toThrow();
    await expect(svc.create(dep, { ...base, bultos: 2.5 })).rejects.toThrow(/entero/);
  });

  it("eliminación lógica: sale de la lista, queda historial; bulk idempotente", async () => {
    const svc = getDespachosService();
    const a = (await svc.create(dep, base)).record;
    const b = (await svc.create(dep, { ...base, remito: "2" })).record;
    expect(await svc.delete(dep, a.id)).toBe(true);
    expect(await svc.delete(dep, a.id)).toBe(false);
    expect((await svc.list(dep)).map((r) => r.id)).toEqual([b.id]);
    expect((await svc.listAudit(dep, a.id)).map((h) => h.action)).toEqual(["create", "delete"]);
    const res = await svc.bulkDelete(dep, { all: true });
    expect(res.deleted).toEqual([b.id]);
    expect(await svc.list(dep)).toHaveLength(0);
  });

  it("pegado múltiple: reintento del lote con la misma clave no duplica y filas inválidas se informan", async () => {
    const svc = getDespachosService();
    const rows = [base, { ...base, remito: "0002" }, { ...base, fecha: "31/02/xx" }];
    const r1 = await svc.createMany(dep, rows, "batch-1");
    expect(r1.map((r) => r.ok)).toEqual([true, true, false]);
    const r2 = await svc.createMany(dep, rows, "batch-1");
    expect(r2.filter((r) => r.ok && r.created)).toHaveLength(0);
    expect(await svc.list(dep)).toHaveLength(2);
  });

  it("permisos: Depósito escribe; Producción y Dirección solo consultan; otros sectores no acceden", async () => {
    const svc = getDespachosService();
    const { record } = await svc.create(dep, base);
    expect(await svc.list(prod)).toHaveLength(1);
    expect(await svc.list(dir)).toHaveLength(1);
    await expect(svc.create(prod, base)).rejects.toBeInstanceOf(OrdersForbiddenError);
    await expect(svc.patchCells(dir, [{ id: record.id, field: "bultos", value: "1", expectedVersion: record.updatedAt }])).rejects.toBeInstanceOf(OrdersForbiddenError);
    await expect(svc.delete(prod, record.id)).rejects.toBeInstanceOf(OrdersForbiddenError);
    await expect(svc.list(env)).rejects.toBeInstanceOf(OrdersForbiddenError);
    expect(canAccessDespachos("DEPOSITO") && canMutateDespachos("DEPOSITO")).toBe(true);
    expect(canMutateDespachos("PRODUCCION")).toBe(false);
  });

  it("no toca stock ni MP (el servicio no depende de inventario)", async () => {
    const mod = await import("node:fs").then((fs) => fs.readFileSync("src/lib/despachos/despachos-service.ts", "utf8"));
    expect(/from "@\/lib\/(inventory|mp-control|orders\/orders-service)/.test(mod)).toBe(false);
  });
});

describe("validación, formato, filtros y export", () => {
  it("fecha DD/MM/AAAA y parseo flexible", () => {
    expect(formatDespachoFecha("2026-01-05")).toBe("05/01/2026");
    const v = validateDespachoValue("fecha", "5/1/2026");
    expect(v).toEqual({ ok: true, value: "2026-01-05" });
    expect(validateDespachoValue("fecha", "")).toEqual({ ok: true, value: "" }); // fecha opcional
  });
  it("remito se valida como texto (ceros a la izquierda)", () => {
    expect(validateDespachoValue("remito", "00045")).toEqual({ ok: true, value: "00045" });
  });
  it("enteros ≥ 0 (sin decimales ni negativos); BULTOS vacío = 0; CANTIDAD vacía = pendiente", () => {
    expect(validateDespachoValue("bultos", "")).toEqual({ ok: true, value: 0 });
    expect(validateDespachoValue("cantidad", "")).toEqual({ ok: true, value: "" });
    expect(validateDespachoValue("cantidad", "1.008")).toEqual({ ok: true, value: 1008 });
    expect(validateDespachoValue("cantidad", "17,5")).toMatchObject({ ok: false, message: expect.stringMatching(/entero/) });
    expect(validateDespachoValue("bultos", "2.5").ok).toBe(false);
    expect(validateDespachoValue("bultos", "-1").ok).toBe(false);
    expect(validateDespachoValue("bultos", "abc").ok).toBe(false);
  });
  const mk = (o: Partial<Parameters<typeof despachosToRows>[0][number]>) => ({
    id: Math.random().toString(), fecha: "2026-10-20", egreso: "B001", remito: "01", cliente: "ACME", producto: "Crema", bultos: 1, cantidad: 10, cantidadTotal: 10, comentarios: "", control: false, controlBy: null, controlAt: null, entregado: false, entregadoBy: null, entregadoAt: null, pedidoOp: "",
    createdBy: "x", createdBySector: "DEPOSITO", createdAt: "2026-10-20T10:00:00Z", updatedBy: null, updatedAt: "2026-10-20T10:00:00Z", ...o,
  });
  it("filtros por fecha, cliente, producto, remito y búsqueda", () => {
    const items = [mk({}), mk({ fecha: "2026-11-02", cliente: "Beta", producto: "Shampoo", remito: "0099" })];
    expect(filterDespachos(items, { desde: "2026-11-01" })).toHaveLength(1);
    expect(filterDespachos(items, { hasta: "2026-10-31" })).toHaveLength(1);
    expect(filterDespachos(items, { cliente: "beta" })).toHaveLength(1);
    expect(filterDespachos(items, { producto: "SHAMPOO" })).toHaveLength(1);
    expect(filterDespachos(items, { remito: "0099" })).toHaveLength(1);
    expect(filterDespachos(items, { q: "02/11/2026" })).toHaveLength(1);
  });
  it("export: fecha DD/MM/AAAA y remito como texto", () => {
    expect(despachosToRows([mk({ remito: "000123", control: true })])).toEqual([["20/10/2026", "B001", "ACME", "000123", "Crema", "1", "10", "10", "TRUE", "FALSE", ""]]);
  });
});

describe("planilla «SALIDAS PROD.»: egreso con varias filas, TOTAL calculado y casillas", () => {
  beforeEach(() => resetDespachosMemoryForTests());
  const egreso = { fecha: "2026-01-05", egreso: "B001", cliente: "LIETA", remito: "2938" };

  it("B001: tres filas del mismo egreso (17×56, 18×56, 1×28) con su TOTAL calculado", async () => {
    const svc = getDespachosService();
    const a = (await svc.create(dep, { ...egreso, producto: "CREMA EXFOLIANTE PARA MANOS", bultos: 17, cantidad: 56 })).record;
    const b = (await svc.create(dep, { ...egreso, producto: "ACEITE PARA MANOS", bultos: 18, cantidad: 56 })).record;
    const c = (await svc.create(dep, { ...egreso, producto: "CREMA EXFOLIANTE PARA MANOS", bultos: 1, cantidad: 28 })).record;
    expect([a.cantidadTotal, b.cantidadTotal, c.cantidadTotal]).toEqual([952, 1008, 28]);
    const items = await svc.list(dep);
    expect(items.filter((r) => r.egreso === "B001")).toHaveLength(3); // el mismo egreso con varias filas y cajas incompletas en una fila aparte
    expect(items.reduce((s, r) => s + r.cantidadTotal, 0)).toBe(1988);
    expect(despachoTotal(17, 56)).toBe(952);
  });

  it("modificar BULTOS o CANTIDAD actualiza TOTAL al instante; datos incompletos no inventan un total", async () => {
    const svc = getDespachosService();
    const r = (await svc.create(dep, { ...egreso, producto: "X", bultos: 17, cantidad: 56 })).record;
    const [u1] = await svc.patchCells(dep, [{ id: r.id, field: "bultos", value: "18", expectedVersion: r.updatedAt }]);
    expect(u1.ok && u1.record.cantidadTotal).toBe(1008);
    const v1 = u1.ok ? u1.record.updatedAt : "";
    const [u2] = await svc.patchCells(dep, [{ id: r.id, field: "cantidad", value: "28", expectedVersion: v1 }]);
    expect(u2.ok && u2.record.cantidadTotal).toBe(504);
    // fila nueva sin datos: TOTAL 0 (no se inventa), CANTIDAD pendiente
    const blank = (await svc.create(dep, { ...egreso, producto: "Y" })).record;
    expect(blank).toMatchObject({ bultos: 0, cantidad: null, cantidadTotal: 0 });
    const bad = await svc.patchCells(dep, [{ id: blank.id, field: "bultos", value: "-2", expectedVersion: blank.updatedAt }]);
    expect(bad[0]!.ok).toBe(false);
    const dec = await svc.patchCells(dep, [{ id: blank.id, field: "cantidad", value: "2,5", expectedVersion: blank.updatedAt }]);
    expect(dec[0]!.ok).toBe(false);
  });

  it("dato anterior sin desglose: el total registrado se conserva hasta que se completa CANTIDAD", async () => {
    const svc = getDespachosService();
    const legacy = (await svc.create(dep, { fecha: "2026-10-20", remito: "R1", cliente: "ACME", producto: "Crema", bultos: 3, cantidadTotal: 250 })).record;
    expect(legacy).toMatchObject({ cantidad: null, cantidadTotal: 250 }); // 250 no es divisible por 3: no se inventa CANTIDAD
    const [e] = await svc.patchCells(dep, [{ id: legacy.id, field: "bultos", value: "4", expectedVersion: legacy.updatedAt }]);
    expect(e.ok && e.record.cantidadTotal).toBe(250); // CANTIDAD pendiente: el total anterior no se pisa
  });

  it("CONTROL y ENTREGADO son independientes y guardan quién y cuándo (también al desmarcar)", async () => {
    const svc = getDespachosService();
    const r = (await svc.create(dep, { ...egreso, producto: "X", bultos: 1, cantidad: 10 })).record;
    expect(r).toMatchObject({ control: false, entregado: false, controlBy: null, entregadoBy: null });
    const [c] = await svc.patchCells(dep, [{ id: r.id, field: "control", value: "TRUE", expectedVersion: r.updatedAt }]);
    expect(c.ok && c.record).toMatchObject({ control: true, controlBy: "Depósito", entregado: false, entregadoBy: null });
    expect(c.ok && c.record.controlAt).toBeTruthy();
    const v1 = c.ok ? c.record.updatedAt : "";
    const [e] = await svc.patchCells(dep, [{ id: r.id, field: "entregado", value: "VERDADERO", expectedVersion: v1 }]);
    expect(e.ok && e.record).toMatchObject({ control: true, entregado: true, entregadoBy: "Depósito" });
    const v2 = e.ok ? e.record.updatedAt : "";
    const [d] = await svc.patchCells(dep, [{ id: r.id, field: "control", value: "FALSE", expectedVersion: v2 }]);
    expect(d.ok && d.record).toMatchObject({ control: false, controlBy: "Depósito", entregado: true });
    const hist = await svc.listAudit(dep, r.id);
    expect(hist.filter((h) => h.field === "control").map((h) => [h.beforeValue, h.afterValue])).toEqual([["false", "true"], ["true", "false"]]);
    expect(hist.filter((h) => h.field === "entregado").map((h) => [h.beforeValue, h.afterValue])).toEqual([["false", "true"]]);
    // marcar ENTREGADO no toca cantidades ni total (no es un movimiento de stock)
    expect(e.ok && e.record.cantidadTotal).toBe(10);
    const bad = await svc.patchCells(dep, [{ id: r.id, field: "control", value: "quizás", expectedVersion: d.ok ? d.record.updatedAt : "" }]);
    expect(bad[0]!.ok).toBe(false);
  });

  it("solo Depósito marca las casillas; Producción y Dirección consultan", async () => {
    const svc = getDespachosService();
    const r = (await svc.create(dep, { ...egreso, producto: "X", bultos: 1, cantidad: 10 })).record;
    await expect(svc.patchCells(prod, [{ id: r.id, field: "entregado", value: "TRUE", expectedVersion: r.updatedAt }])).rejects.toBeInstanceOf(OrdersForbiddenError);
    await expect(svc.patchCells(dir, [{ id: r.id, field: "control", value: "TRUE", expectedVersion: r.updatedAt }])).rejects.toBeInstanceOf(OrdersForbiddenError);
    expect((await svc.list(prod))[0]).toMatchObject({ control: false, entregado: false });
  });

  it("pegado desde Google Sheets: filas con casillas TRUE/FALSE, TOTAL ignorado, sin duplicar al reintentar", async () => {
    const svc = getDespachosService();
    const rows = [
      { ...egreso, producto: "CREMA", bultos: 17, cantidad: 56, control: parseBoolCell("TRUE") ?? false, entregado: false },
      { ...egreso, producto: "ACEITE", bultos: 18, cantidad: 56, control: false, entregado: parseBoolCell("VERDADERO") ?? false },
    ];
    const r1 = await svc.createMany(dep, rows, "sheets-1");
    expect(r1.every((r) => r.ok)).toBe(true);
    const r2 = await svc.createMany(dep, rows, "sheets-1");
    expect(r2.filter((r) => r.ok && r.created)).toHaveLength(0);
    const items = await svc.list(dep);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.cantidadTotal).sort((a, b) => a - b)).toEqual([952, 1008]);
    expect(items.find((i) => i.producto === "CREMA")).toMatchObject({ control: true, controlBy: "Depósito" });
  });

  it("filtros por egreso y por estado; búsqueda incluye egreso y comentarios; siguiente egreso", () => {
    const items = [
      { ...mkRec({ egreso: "B001", control: true }) },
      { ...mkRec({ egreso: "B002", entregado: true, comentarios: "falta una caja" }) },
      { ...mkRec({ egreso: "B002", producto: "Otro" }) },
    ];
    expect(filterDespachos(items, { egreso: "b002" })).toHaveLength(2);
    expect(filterDespachos(items, { estado: "controlado" })).toHaveLength(1);
    expect(filterDespachos(items, { estado: "sin_control" })).toHaveLength(2);
    expect(filterDespachos(items, { estado: "entregado" })).toHaveLength(1);
    expect(filterDespachos(items, { estado: "sin_entregar" })).toHaveLength(2);
    expect(filterDespachos(items, { q: "falta una caja" })).toHaveLength(1);
    expect(nextEgreso([])).toBe("B001");
    expect(nextEgreso(["B001", "B009", "B003", ""])).toBe("B010");
    expect(nextEgreso(["B099"])).toBe("B100");
  });

  it("casillas: TRUE/FALSE de Google Sheets, VERDADERO/FALSO, vacío = sin tildar", () => {
    expect(["TRUE", "true", "Verdadero", "1", "SI", "✓"].map(parseBoolCell)).toEqual([true, true, true, true, true, true]);
    expect(["FALSE", "falso", "", "0", "no"].map(parseBoolCell)).toEqual([false, false, false, false, false]);
    expect(parseBoolCell("tal vez")).toBeNull();
  });
});

function mkRec(o: Record<string, unknown>) {
  return {
    id: Math.random().toString(), fecha: "2026-10-20", egreso: "B001", remito: "01", cliente: "ACME", producto: "Crema", bultos: 1, cantidad: 10, cantidadTotal: 10, comentarios: "", control: false, controlBy: null,
    controlAt: null, entregado: false, entregadoBy: null, entregadoAt: null, pedidoOp: "", createdBy: "x", createdBySector: "DEPOSITO", createdAt: "2026-10-20T10:00:00Z", updatedBy: null, updatedAt: "2026-10-20T10:00:00Z", ...o,
  } as Parameters<typeof despachosToRows>[0][number];
}
