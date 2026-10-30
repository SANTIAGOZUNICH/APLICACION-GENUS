import { beforeEach, describe, expect, it } from "vitest";
import { OrdersForbiddenError } from "@/lib/orders/types";
import { getProductionPedidosService, resetProductionPedidosMemoryForTests } from "./service";
import { filterPedidosDeposito } from "@/features/os/operational/views/pedidos-deposito-view";

const produccion = { email: "produccion@test", sector: "PRODUCCION" as const };
const deposito = { email: "deposito@test", sector: "DEPOSITO" as const };

describe("Depósito → Pedidos (solo lectura)", () => {
  beforeEach(() => resetProductionPedidosMemoryForTests());

  it("ve los mismos pedidos de Producción, un renglón por producto, SOLO producto / cliente / cantidad pedida", async () => {
    const svc = getProductionPedidosService();
    // Un pedido (OP) con tres productos = tres filas.
    await svc.create(produccion, { op: "OP-9", cliente: "ACME", producto: "Crema A", q: 1000, ml: 50, estado: "INGRESO", fecha: "2026-10-01" });
    await svc.create(produccion, { op: "OP-9", cliente: "ACME", producto: "Gel B", q: 250, ml: 30, estado: "EN_ENVASADO" });
    await svc.create(produccion, { op: "OP-9", cliente: "ACME", producto: "Serum C", q: 40, ml: 10, estado: "ENTREGADO" });
    const r = await svc.listForDeposito(deposito);
    expect(r.items).toHaveLength(3);
    expect(r.items.map((i) => [i.producto, i.cliente, i.cantidadTotal]).sort()).toEqual([
      ["Crema A", "ACME", 1000],
      ["Gel B", "ACME", 250],
      ["Serum C", "ACME", 40],
    ]);
    // Nada más que esos campos (+ id para la clave de la fila): sin fechas, estados, OP, responsables ni sectores.
    expect(Object.keys(r.items[0]!).sort()).toEqual(["cantidadTotal", "cliente", "id", "producto"]);
    // Es la cantidad PEDIDA (Q), no kg ni otras cifras.
    expect(r.items.find((i) => i.producto === "Crema A")!.cantidadTotal).toBe(1000);
  });

  it("los pedidos borrados por Producción no aparecen; los nuevos o modificados se reflejan en la siguiente lectura", async () => {
    const svc = getProductionPedidosService();
    const a = await svc.create(produccion, { cliente: "C1", producto: "P1", q: 10 });
    await svc.create(produccion, { cliente: "C2", producto: "P2", q: 20 });
    expect((await svc.listForDeposito(deposito)).items).toHaveLength(2);
    await svc.update(produccion, a.id, { cliente: "C1", producto: "P1", q: 99 });
    expect((await svc.listForDeposito(deposito)).items.find((i) => i.producto === "P1")!.cantidadTotal).toBe(99);
    await svc.remove(produccion, a.id, "prueba");
    expect((await svc.listForDeposito(deposito)).items.map((i) => i.producto)).toEqual(["P2"]);
  });

  it("consultar no modifica nada (estado, cantidades, versión)", async () => {
    const svc = getProductionPedidosService();
    const p = await svc.create(produccion, { cliente: "C", producto: "P", q: 5, estado: "INGRESO" });
    await svc.listForDeposito(deposito);
    await svc.listForDeposito(deposito);
    const after = (await svc.list(produccion)).items.find((i) => i.id === p.id)!;
    expect(after).toMatchObject({ estado: "INGRESO", q: 5, updatedAt: p.updatedAt, updatedBy: p.updatedBy });
  });

  it("Depósito NO puede crear, editar celdas, eliminar, importar ni usar el listado completo de Producción (403 en el servidor)", async () => {
    const svc = getProductionPedidosService();
    const p = await svc.create(produccion, { cliente: "C", producto: "P", q: 5 });
    await expect(svc.create(deposito, { cliente: "X", producto: "Y", q: 1 })).rejects.toBeInstanceOf(OrdersForbiddenError);
    await expect(svc.update(deposito, p.id, { q: 999 })).rejects.toBeInstanceOf(OrdersForbiddenError);
    await expect(svc.patchCells(deposito, [{ id: p.id, field: "q", value: "999", expectedVersion: p.updatedAt }])).rejects.toBeInstanceOf(OrdersForbiddenError);
    await expect(svc.remove(deposito, p.id, "x")).rejects.toBeInstanceOf(OrdersForbiddenError);
    await expect(svc.importMany(deposito, [{ cliente: "Z", producto: "W", q: 1 }], { idempotencyKey: "dep-import-123456" })).rejects.toBeInstanceOf(OrdersForbiddenError);
    await expect(svc.list(deposito)).rejects.toBeInstanceOf(OrdersForbiddenError);
    const intacto = (await svc.list(produccion)).items;
    expect(intacto).toHaveLength(1);
    expect(intacto[0]).toMatchObject({ q: 5, producto: "P" });
  });

  it("otros sectores sin acceso (Envasado, Calidad…) no consultan esta vista; Producción sigue igual", async () => {
    const svc = getProductionPedidosService();
    await expect(svc.listForDeposito({ email: "e@test", sector: "ENVASADO_MASIVO" })).rejects.toBeInstanceOf(OrdersForbiddenError);
    await expect(svc.listForDeposito({ email: "c@test", sector: "CALIDAD" })).rejects.toBeInstanceOf(OrdersForbiddenError);
    await expect(svc.listForDeposito(produccion)).resolves.toBeTruthy();
  });

  it("búsqueda por producto o cliente (sin acentos ni mayúsculas, palabras sueltas)", () => {
    const rows = [
      { id: "1", producto: "Crema Hidratante", cliente: "Laboratorios Gómez", cantidadTotal: 10 },
      { id: "2", producto: "Shampoo", cliente: "ACME", cantidadTotal: 5 },
    ];
    expect(filterPedidosDeposito(rows, "").length).toBe(2);
    expect(filterPedidosDeposito(rows, "hidratante").map((r) => r.id)).toEqual(["1"]);
    expect(filterPedidosDeposito(rows, "gomez").map((r) => r.id)).toEqual(["1"]);
    expect(filterPedidosDeposito(rows, "ACME shampoo").map((r) => r.id)).toEqual(["2"]);
    expect(filterPedidosDeposito(rows, "inexistente")).toHaveLength(0);
  });
});
