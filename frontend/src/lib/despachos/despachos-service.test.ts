import { beforeEach, describe, expect, it } from "vitest";
import { getDespachosService, resetDespachosMemoryForTests } from "@/lib/despachos/despachos-service";
import { formatDespachoFecha, validateDespachoValue } from "@/lib/despachos/cell-edit";
import { canAccessDespachos, canMutateDespachos } from "@/lib/despachos/despachos-rbac";
import { despachosToRows, filterDespachos, resumenPorPedido } from "@/lib/despachos/despachos-view-model";
import { OrdersForbiddenError } from "@/lib/orders/types";

const dep = { email: "deposito@x.com", sector: "DEPOSITO" as const, displayName: "Depósito" };
const prod = { email: "prod@x.com", sector: "PRODUCCION" as const, displayName: "Producción" };
const dir = { email: "dir@x.com", sector: "DIRECCION" as const, displayName: "Dirección" };
const env = { email: "env@x.com", sector: "ENVASADO_MASIVO" as const, displayName: "Envasado" };
const base = { fecha: "2026-10-20", remito: "0001-00004567", cliente: "ACME", producto: "Shampoo 1L", bultos: 10, cantidadTotal: 240 };

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
    await svc.create(dep, { ...base, pedidoOp: "OP-77", fecha: "2026-10-20", bultos: 4, cantidadTotal: 100 });
    await svc.create(dep, { ...base, pedidoOp: "OP-77", fecha: "2026-10-25", remito: "0001-00004999", bultos: 6, cantidadTotal: 140 });
    const items = await svc.list(dep);
    expect(items).toHaveLength(2);
    const [p] = resumenPorPedido(items);
    expect(p.pedidoOp).toBe("OP-77");
    expect(p.entregas).toHaveLength(2);
    expect(p.cantidadTotal).toBe(240);
    expect(p.bultos).toBe(10);
  });

  it("edición por celda con auditoría y conflicto de versión", async () => {
    const svc = getDespachosService();
    const { record } = await svc.create(dep, base);
    const [r1] = await svc.patchCells(dep, [{ id: record.id, field: "cantidadTotal", value: "300", expectedVersion: record.updatedAt }]);
    expect(r1.ok).toBe(true);
    const hist = await svc.listAudit(dep, record.id);
    expect(hist.map((h) => h.action)).toEqual(["create", "update"]);
    expect(hist[1]).toMatchObject({ field: "cantidadTotal", beforeValue: "240", afterValue: "300", actorName: "Depósito" });
    const [r2] = await svc.patchCells(dep, [{ id: record.id, field: "bultos", value: "1", expectedVersion: record.updatedAt }]);
    expect(r2.ok).toBe(false);
    expect(!r2.ok && r2.code).toBe("CONFLICT");
  });

  it("rechaza negativos y fechas inválidas", async () => {
    const svc = getDespachosService();
    const { record } = await svc.create(dep, base);
    const [r] = await svc.patchCells(dep, [{ id: record.id, field: "bultos", value: "-3", expectedVersion: record.updatedAt }]);
    expect(r.ok).toBe(false);
    await expect(svc.create(dep, { ...base, fecha: "no-es-fecha" })).rejects.toThrow();
    expect((await svc.create(dep, { ...base, fecha: "" })).record.fecha).toBeNull(); // incompleta pero válida
    await expect(svc.create(dep, { ...base, cantidadTotal: -1 })).rejects.toThrow();
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
  it("números ≥ 0; vacío = 0", () => {
    expect(validateDespachoValue("bultos", "")).toEqual({ ok: true, value: 0 });
    expect(validateDespachoValue("cantidadTotal", "1.234,5")).toEqual({ ok: true, value: 1234.5 });
    expect(validateDespachoValue("bultos", "-1").ok).toBe(false);
    expect(validateDespachoValue("bultos", "abc").ok).toBe(false);
  });
  const mk = (o: Partial<Parameters<typeof despachosToRows>[0][number]>) => ({
    id: Math.random().toString(), fecha: "2026-10-20", remito: "01", cliente: "ACME", producto: "Crema", bultos: 1, cantidadTotal: 10, pedidoOp: "",
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
    expect(despachosToRows([mk({ remito: "000123" })])).toEqual([["20/10/2026", "000123", "ACME", "Crema", "1", "10"]]);
  });
});
