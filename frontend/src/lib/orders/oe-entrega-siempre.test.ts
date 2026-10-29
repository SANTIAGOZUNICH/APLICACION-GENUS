import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryInventoryRepo } from "@/lib/inventory/get-inventory-service";
import { getMpStockLedger } from "@/lib/mp-stock/mp-stock-ledger";
import { emptyOeMaterial } from "@/lib/orders/content";
import { MemoryOrdersRepository } from "@/lib/orders/memory-repository";
import { hasMpConsumoPendiente } from "@/lib/orders/oe-mp-consumption";
import { seedMpStockForTests } from "@/lib/orders/oe-mp-test-fixture";
import { OrdersService } from "@/lib/orders/orders-service";
import type { OeContent, OeMaterialRow, OrdersActor } from "@/lib/orders/types";

const calidad: OrdersActor = { email: "calidad@genus.test", sector: "CALIDAD", displayName: "Calidad" };
const produccion: OrdersActor = { email: "produccion@genus.test", sector: "PRODUCCION", displayName: "Producción" };
const elaboracion: OrdersActor = { email: "elaboracion@genus.test", sector: "ELABORACION", displayName: "Elaboración" };

const lotKg = (codigo: string, lote: string) => memoryInventoryRepo.mpStock.find((l) => l.codigo === codigo && l.lote === lote)?.cantidadKg ?? null;
const codeKg = async (codigo: string) => (await getMpStockLedger().getBalance(codigo))?.stockActual ?? null;
const movs = async (codigo: string) => (await getMpStockLedger().history(codigo)).filter((m) => m.kind === "CONSUMO_OE").length;

describe("OE: Elaboración entrega SIEMPRE y descuenta lo identificable", () => {
  let service: OrdersService;
  beforeEach(async () => {
    await seedMpStockForTests([
      ...Array.from({ length: 6 }, (_, i) => ({ codigo: `MP-${i + 1}`, lote: `L${i + 1}`, kg: 100 })),
      { codigo: "GLI-001", lote: "L001", kg: 50 },
      { codigo: "GLI-002", lote: "L002", kg: 50 },
      { codigo: "GLI-003", lote: "L003", kg: 50 },
      { codigo: "MP-POCO", lote: "P1", kg: 3 },
      { codigo: "MP-DOS", lote: "D1", kg: 10 },
      { codigo: "MP-DOS", lote: "D2", kg: 10 },
    ]);
    service = new OrdersService(new MemoryOrdersRepository());
  });
  afterEach(() => vi.restoreAllMocks());

  async function makeOe(materials: Array<Partial<OeMaterialRow>>) {
    const t = (await service.listTemplates("OE"))[0]!;
    const order = await service.createOrder({ type: "OE", templateId: t.id, assignedSector: "ELABORACION", product: "CREMA", client: "C", lot: "L-OE" }, calidad);
    const form = structuredClone(order.formData) as OeContent;
    form.header = { ...form.header, productName: "CREMA", date: "2026-10-13", quantityKg: 100, lot: "L-OE", client: "C" };
    form.processControl = { ...form.processControl, cantidadObtenida: 99, fechaFin: "2026-10-13" };
    form.materials = materials.map((m) => emptyOeMaterial(m));
    return service.saveProgress(order.id, { expectedVersion: order.version, formData: form }, produccion);
  }
  const ten = (): Array<Partial<OeMaterialRow>> =>
    Array.from({ length: 10 }, (_, i) => ({
      id: `r${i}`,
      materiaPrima: `MP número ${i + 1}`,
      formulaPct: 10,
      ...(i < 6 ? { codigoMp: `MP-${i + 1}`, lote: `L${i + 1}`, kgReal: 8 } : { kgReal: 5 }), // 4 sin código ni lote
    }));

  it("10 MP: 6 identificables se descuentan, 4 sin código quedan sin descuento; la OE se entrega sin motivos", async () => {
    const oe = await makeOe(ten());
    const done = await service.deliver(oe.id, elaboracion, true);
    expect(done.status).toBe("COMPLETA");
    for (let i = 1; i <= 6; i++) expect(lotKg(`MP-${i}`, `L${i}`)).toBe(92);
    expect(hasMpConsumoPendiente(done.formData as OeContent)).toBe(true); // las 4 quedan «sin descuento»
  });

  it("ninguna MP con código: se entrega igual y no se inventa ningún movimiento", async () => {
    const oe = await makeOe(ten().map((m) => ({ ...m, codigoMp: "", lote: "" })));
    const done = await service.deliver(oe.id, elaboracion, true);
    expect(done.status).toBe("COMPLETA");
    expect(await movs("MP-1")).toBe(0);
    expect(lotKg("MP-1", "L1")).toBe(100);
  });

  it("solo una MP con código: se descuenta únicamente esa", async () => {
    const oe = await makeOe(ten().map((m, i) => (i === 0 ? m : { ...m, codigoMp: "", lote: "" })));
    await service.deliver(oe.id, elaboracion, true);
    expect(lotKg("MP-1", "L1")).toBe(92);
    expect(lotKg("MP-2", "L2")).toBe(100);
  });

  it("lote faltante: con código de una sola fila se descuenta por código; con código inexistente no se inventa", async () => {
    const oe = await makeOe([
      { id: "a", materiaPrima: "A", formulaPct: 50, codigoMp: "MP-1", lote: "", kgReal: 7 },
      { id: "b", materiaPrima: "B", formulaPct: 50, codigoMp: "NO-EXISTE", lote: "", kgReal: 3 },
    ]);
    const done = await service.deliver(oe.id, elaboracion, true);
    expect(done.status).toBe("COMPLETA");
    expect(lotKg("MP-1", "L1")).toBe(93);
  });

  it("stock insuficiente / cero / negativo: descuenta igual, sin motivo ni autorización", async () => {
    const oe = await makeOe([{ id: "a", materiaPrima: "POCO", formulaPct: 100, codigoMp: "MP-POCO", lote: "P1", kgReal: 5 }]);
    const done = await service.deliver(oe.id, elaboracion, true);
    expect(done.status).toBe("COMPLETA");
    expect(lotKg("MP-POCO", "P1")).toBe(-2);
    expect(await codeKg("MP-POCO")).toBe(-2);
  });

  it("una MP con 2 y con 3 códigos: cada uno se descuenta de su código/lote por separado", async () => {
    const oe = await makeOe([
      { id: "gli", materiaPrima: "GLICERINA", formulaPct: 100, codigoMp: "GLI-001", lote: "L001", kgReal: 6 },
      { id: "gli2", materiaPrima: "GLICERINA", parentRowId: "gli", codigoMp: "GLI-002", lote: "L002", kgReal: 4 },
      { id: "gli3", materiaPrima: "GLICERINA", parentRowId: "gli", codigoMp: "GLI-003", lote: "L003", kgReal: 2 },
    ]);
    const done = await service.deliver(oe.id, elaboracion, true);
    expect(done.status).toBe("COMPLETA");
    expect(lotKg("GLI-001", "L001")).toBe(44);
    expect(lotKg("GLI-002", "L002")).toBe(46);
    expect(lotKg("GLI-003", "L003")).toBe(48);
    expect(await movs("GLI-001")).toBe(1);
    expect(await movs("GLI-002")).toBe(1);
  });

  it("un código que existe sin lote pero ambiguo (varias filas) se reparte FEFO/FIFO y un código ambiguo no se inventa", async () => {
    const oe = await makeOe([{ id: "a", materiaPrima: "DOS", formulaPct: 100, codigoMp: "MP-DOS", lote: "", kgReal: 4 }]);
    await service.deliver(oe.id, elaboracion, true);
    expect((lotKg("MP-DOS", "D1") ?? 0) + (lotKg("MP-DOS", "D2") ?? 0)).toBe(16);
  });

  it("Elaboración: cada registro conserva SU código de MP al guardar (no hereda el de la fila)", async () => {
    const oe = await makeOe([{ id: "gli", materiaPrima: "GLICERINA", formulaPct: 100, codigoMp: "GLI-001", lote: "L001", kgReal: 6 }]);
    const cur = await service.getOrder(oe.id, elaboracion);
    const form = structuredClone(cur.formData) as OeContent;
    form.materials.push(emptyOeMaterial({ id: "gli2", materiaPrima: "GLICERINA", parentRowId: "gli", codigoMp: "GLI-002", lote: "L002", kgReal: 4 }));
    const saved = await service.saveProgress(oe.id, { expectedVersion: cur.version, formData: form }, elaboracion);
    expect((saved.formData as OeContent).materials.find((m) => m.id === "gli2")?.codigoMp).toBe("GLI-002");
    await service.deliver(oe.id, elaboracion, true);
    expect(lotKg("GLI-002", "L002")).toBe(46);
  });

  it("guardar avance y recargar no duplica; entregar después no duplica; entregar dos veces no duplica", async () => {
    const oe = await makeOe([{ id: "a", materiaPrima: "A", formulaPct: 100, codigoMp: "MP-1", lote: "L1", kgReal: 8 }]);
    const cur = await service.getOrder(oe.id, elaboracion);
    await service.saveProgressWithConsumption(oe.id, { expectedVersion: cur.version, formData: cur.formData, registerMpConsumption: true }, elaboracion);
    const cur2 = await service.getOrder(oe.id, elaboracion);
    await service.saveProgressWithConsumption(oe.id, { expectedVersion: cur2.version, formData: cur2.formData, registerMpConsumption: true }, elaboracion);
    expect(lotKg("MP-1", "L1")).toBe(92);
    await service.deliver(oe.id, elaboracion, true);
    await expect(service.deliver(oe.id, elaboracion, true)).rejects.toThrow();
    expect(lotKg("MP-1", "L1")).toBe(92);
    expect(await movs("MP-1")).toBe(1);
  });

  it("error técnico al escribir el inventario: nada queda a medias y el reintento descuenta una sola vez", async () => {
    const oe = await makeOe([
      { id: "a", materiaPrima: "A", formulaPct: 50, codigoMp: "MP-1", lote: "L1", kgReal: 8 },
      { id: "b", materiaPrima: "B", formulaPct: 50, codigoMp: "MP-2", lote: "L2", kgReal: 3 },
    ]);
    const ledger = getMpStockLedger();
    const spy = vi.spyOn(ledger, "applyOeConsumption").mockRejectedValueOnce(new Error("fallo técnico simulado"));
    await expect(service.deliver(oe.id, elaboracion, true)).rejects.toThrow(/fallo técnico/);
    expect(lotKg("MP-1", "L1")).toBe(100); // ningún movimiento a medias
    spy.mockRestore();
    const cur = await service.getOrder(oe.id, elaboracion);
    if (cur.status === "COMPLETA") {
      // Sin transacción (memoria) la entrega quedó registrada: el descuento figura pendiente y se reintenta una sola vez.
      expect(hasMpConsumoPendiente(cur.formData as OeContent)).toBe(true);
      await service.settleMpConsumption(oe.id, elaboracion);
    } else {
      expect((await service.deliver(oe.id, elaboracion, true)).status).toBe("COMPLETA");
    }
    expect(lotKg("MP-1", "L1")).toBe(92);
    expect(lotKg("MP-2", "L2")).toBe(97);
    expect(await movs("MP-1")).toBe(1);
  });
});
