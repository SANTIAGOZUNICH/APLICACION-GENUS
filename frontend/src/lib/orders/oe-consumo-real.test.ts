import { beforeEach, describe, expect, it } from "vitest";
import { memoryInventoryRepo } from "@/lib/inventory/get-inventory-service";
import { getMpStockLedger } from "@/lib/mp-stock/mp-stock-ledger";
import { emptyOeMaterial } from "@/lib/orders/content";
import { MemoryOrdersRepository } from "@/lib/orders/memory-repository";
import { hasMpConsumoPendiente } from "@/lib/orders/oe-mp-consumption";
import { seedMpStockForTests } from "@/lib/orders/oe-mp-test-fixture";
import { OrdersService } from "@/lib/orders/orders-service";
import type { OeContent, OeMaterialRow, OrdersActor } from "@/lib/orders/types";
import { MpConsumptionIncompleteError, MpStockShortageError, OrdersForbiddenError } from "@/lib/orders/types";

const calidad: OrdersActor = { email: "calidad@genus.test", sector: "CALIDAD", displayName: "Calidad" };
const produccion: OrdersActor = { email: "produccion@genus.test", sector: "PRODUCCION", displayName: "Producción" };
const elaboracion: OrdersActor = { email: "elaboracion@genus.test", sector: "ELABORACION", displayName: "Elaboración" };

const lotKg = (codigo: string, lote: string) =>
  memoryInventoryRepo.mpStock.find((l) => l.codigo === codigo && l.lote === lote)?.cantidadKg ?? null;
const codeKg = async (codigo: string) => (await getMpStockLedger().getBalance(codigo))?.stockActual ?? null;

describe("entrega de OE: descuento por KG REAL UTILIZADO (código MP + lote)", () => {
  let service: OrdersService;

  beforeEach(async () => {
    await seedMpStockForTests([
      { codigo: "MP-AGUA", lote: "A1", kg: 100 },
      { codigo: "MP-AGUA", lote: "A2", kg: 50 },
      { codigo: "MP-GLI", lote: "G1", kg: 200 },
      { codigo: "MP-POCO", lote: "P1", kg: 3 },
    ]);
    service = new OrdersService(new MemoryOrdersRepository());
  });

  /** OE con la fórmula (Producción) y lo que cargó Elaboración (código MP, kg reales y lotes). */
  async function makeOe(materials: Array<Partial<OeMaterialRow>>) {
    const t = (await service.listTemplates("OE"))[0]!;
    const order = await service.createOrder(
      { type: "OE", templateId: t.id, assignedSector: "ELABORACION", product: "CREMA", client: "C", lot: "L-OE" },
      calidad
    );
    const form = structuredClone(order.formData) as OeContent;
    form.header = { ...form.header, productName: "CREMA", date: "2026-10-13", quantityKg: 100, lot: "L-OE", client: "C" };
    form.processControl = { ...form.processControl, cantidadObtenida: 99, fechaFin: "2026-10-13" };
    form.qualityControl = { ...form.qualityControl, resultado: "OK" };
    form.materials = materials.map((m) => emptyOeMaterial(m));
    const saved = await service.saveProgress(order.id, { expectedVersion: order.version, formData: form }, produccion);
    return saved;
  }

  async function elaboracionCarga(id: string, edit: (m: OeMaterialRow[]) => OeMaterialRow[]) {
    const cur = await service.getOrder(id, elaboracion);
    const form = structuredClone(cur.formData) as OeContent;
    form.materials = edit(form.materials);
    return service.saveProgress(id, { expectedVersion: cur.version, formData: form }, elaboracion);
  }

  it("descuenta los kg REALES (24,8 y 151,2), no los teóricos; MP desde dos lotes; MP repetida en dos fases", async () => {
    const oe = await makeOe([
      { id: "agua", materiaPrima: "AGUA", formulaPct: 25, codigoMp: "MP-AGUA" },
      { id: "gli", materiaPrima: "GLICERINA", formulaPct: 75, codigoMp: "MP-GLI" },
    ]);
    // Producción no carga consumos: los kg reales quedan vacíos (no se copian los teóricos).
    expect((oe.formData as OeContent).materials.map((m) => [m.kgAPesar, m.kgReal])).toEqual([
      [25, null],
      [75, null],
    ]);
    await elaboracionCarga(oe.id, (ms) => [
      { ...ms[0]!, kgReal: 20, lote: "A1" },
      emptyOeMaterial({ id: "agua-2", parentRowId: "agua", kgReal: 4.8, lote: "A2" }),
      { ...ms[1]!, kgReal: 151.2, lote: "G1" },
    ]);
    await service.deliver(oe.id, elaboracion, true);
    expect(lotKg("MP-AGUA", "A1")).toBe(80);
    expect(lotKg("MP-AGUA", "A2")).toBe(45.2);
    expect(lotKg("MP-GLI", "G1")).toBe(48.8);
    expect(await codeKg("MP-AGUA")).toBe(125.2); // 150 − 24,8
    expect(await codeKg("MP-GLI")).toBe(48.8);

    // Confirmación duplicada / reintento: rechazado y sin segundo descuento.
    await expect(service.deliver(oe.id, elaboracion, true)).rejects.toThrow(/ya está completa/);
    expect(await codeKg("MP-AGUA")).toBe(125.2);
    expect(lotKg("MP-AGUA", "A1")).toBe(80);
  });

  it("misma MP en varias fases (mismo código y lote): un solo movimiento por la suma", async () => {
    const oe = await makeOe([
      { id: "f1", materiaPrima: "AGUA", formulaPct: 50, codigoMp: "MP-AGUA" },
      { id: "f2", materiaPrima: "AGUA", formulaPct: 50, codigoMp: "MP-AGUA" },
    ]);
    await elaboracionCarga(oe.id, (ms) => ms.map((m) => ({ ...m, kgReal: 10, lote: "A1" })));
    await service.deliver(oe.id, elaboracion, true);
    expect(lotKg("MP-AGUA", "A1")).toBe(80);
    const consumos = (await getMpStockLedger().history("MP-AGUA")).filter((m) => m.kind === "CONSUMO_OE");
    expect(consumos).toHaveLength(1);
    expect(consumos[0]!.quantity).toBe(-20);
  });

  it("faltan datos: la OE se ENTREGA igual, no se descuenta nada y el consumo queda pendiente; se regulariza una sola vez", async () => {
    const oe = await makeOe([
      { id: "r1", materiaPrima: "AGUA", formulaPct: 50, codigoMp: "MP-AGUA" },
      { id: "r2", materiaPrima: "GLICERINA", formulaPct: 50, codigoMp: "" },
    ]);
    await elaboracionCarga(oe.id, (ms) => [{ ...ms[0]!, kgReal: 10, lote: "A1" }, { ...ms[1]!, kgReal: 5, lote: "G1" }]);
    const done = await service.deliver(oe.id, elaboracion, true);
    expect(done.status).toBe("COMPLETA");
    expect(hasMpConsumoPendiente(done.formData)).toBe(true);
    // Sin descuentos parciales ni inventados.
    expect(lotKg("MP-AGUA", "A1")).toBe(100);
    expect(await codeKg("MP-AGUA")).toBe(150);
    expect(lotKg("MP-GLI", "G1")).toBe(200);
    expect((await service.getOrder(oe.id, produccion)).status).toBe("COMPLETA");
    // Segunda pulsación: no duplica la entrega.
    await expect(service.deliver(oe.id, elaboracion, true)).rejects.toThrow(/ya está completa/);

    // Regularizar sin completar: informa qué falta, no cambia nada.
    const err = await service.settleMpConsumption(oe.id, elaboracion).catch((e) => e);
    expect(err).toBeInstanceOf(MpConsumptionIncompleteError);
    expect((err as MpConsumptionIncompleteError).issues.map((i) => [i.rowNumber, i.field])).toEqual([[2, "codigoMp"]]);
    expect(lotKg("MP-AGUA", "A1")).toBe(100);
    expect(hasMpConsumoPendiente((await service.getOrder(oe.id, produccion)).formData)).toBe(true);

    // Completando el dato: se descuenta UNA vez y queda auditado; reintentar no duplica.
    const settled = await service.settleMpConsumption(oe.id, elaboracion, { rows: [{ rowId: "r2", codigoMp: "MP-GLI" }] });
    expect(hasMpConsumoPendiente(settled.formData)).toBe(false);
    expect(lotKg("MP-AGUA", "A1")).toBe(90);
    expect(lotKg("MP-GLI", "G1")).toBe(195);
    await expect(service.settleMpConsumption(oe.id, elaboracion)).rejects.toThrow(/ya fue procesado/);
    expect(lotKg("MP-GLI", "G1")).toBe(195);
    expect(await codeKg("MP-GLI")).toBe(195);
  });

  it("caso real: 14 MP (sin código, código inexistente, sin KG REAL, sin fórmula) se ENTREGA sin descontar ni bloquear", async () => {
    const rows: Array<Partial<OeMaterialRow>> = Array.from({ length: 14 }, (_, i) => ({
      id: `m${i}`,
      materiaPrima: `MP ${i}`,
      formulaPct: i < 12 ? 5 : null,
      codigoMp: i < 8 ? "" : i === 8 ? "NO-EXISTE" : "MP-AGUA",
      kgReal: null,
    }));
    const oe = await makeOe(rows);
    const done = await service.deliver(oe.id, elaboracion, true);
    expect(done.status).toBe("COMPLETA");
    expect(hasMpConsumoPendiente(done.formData)).toBe(true);
    expect(await codeKg("MP-AGUA")).toBe(150);
    expect(await getMpStockLedger().history("MP-AGUA").then((h) => h.filter((m) => m.kind === "CONSUMO_OE"))).toHaveLength(0);
    // Persistencia: al recargar la entrega sigue registrada y no se puede repetir.
    expect((await service.getOrder(oe.id, produccion)).status).toBe("COMPLETA");
    await expect(service.deliver(oe.id, elaboracion, true)).rejects.toThrow(/ya está completa/);
  });

  it("stock insuficiente: Elaboración entrega igual (consumo pendiente); Producción autoriza con motivo y queda auditado", async () => {
    const oe = await makeOe([
      { id: "a", materiaPrima: "AGUA", formulaPct: 50, codigoMp: "MP-AGUA" },
      { id: "p", materiaPrima: "POCO", formulaPct: 50, codigoMp: "MP-POCO" },
    ]);
    await elaboracionCarga(oe.id, (ms) => [{ ...ms[0]!, kgReal: 10, lote: "A1" }, { ...ms[1]!, kgReal: 5, lote: "P1" }]);
    const done = await service.deliver(oe.id, elaboracion, true);
    expect(done.status).toBe("COMPLETA");
    expect(hasMpConsumoPendiente(done.formData)).toBe(true);
    // Ni la MP con stock se descontó (nada parcial).
    expect(lotKg("MP-AGUA", "A1")).toBe(100);
    expect(await codeKg("MP-AGUA")).toBe(150);

    // Elaboración no puede forzar stock negativo: la regularización informa el faltante y no cambia nada.
    const shortErr = await service.settleMpConsumption(oe.id, elaboracion, { allowNegativeMpStock: true, negativeMpStockReason: "x" }).catch((e) => e);
    expect(shortErr).toBeInstanceOf(MpStockShortageError);
    expect((shortErr as MpStockShortageError).canAuthorize).toBe(false);
    expect((shortErr as MpStockShortageError).shortages.map((s) => [s.codigo, s.tipo, s.faltante])).toEqual([
      ["MP-POCO", "lote", 2],
      ["MP-POCO", "codigo", 2],
    ]);
    expect(lotKg("MP-AGUA", "A1")).toBe(100);
    // Producción sin motivo: tampoco. Calidad no puede autorizar stock negativo.
    await expect(service.settleMpConsumption(oe.id, produccion, { allowNegativeMpStock: true, negativeMpStockReason: " " })).rejects.toBeInstanceOf(MpStockShortageError);
    await expect(service.settleMpConsumption(oe.id, calidad, { allowNegativeMpStock: true, negativeMpStockReason: "x" })).rejects.toBeInstanceOf(MpStockShortageError);

    const settled = await service.settleMpConsumption(oe.id, produccion, { allowNegativeMpStock: true, negativeMpStockReason: "Ingreso pendiente de cargar" });
    expect(hasMpConsumoPendiente(settled.formData)).toBe(false);
    expect(lotKg("MP-POCO", "P1")).toBe(-2);
    expect(await codeKg("MP-POCO")).toBe(-2);
    expect(lotKg("MP-AGUA", "A1")).toBe(90);
  });

  it("devolver para corrección revierte; corregir kg reales y re-entregar descuenta lo nuevo; anular devuelve todo", async () => {
    const oe = await makeOe([{ materiaPrima: "AGUA", formulaPct: 100, codigoMp: "MP-AGUA" }]);
    await elaboracionCarga(oe.id, (ms) => [{ ...ms[0]!, kgReal: 30, lote: "A1" }]);
    await service.deliver(oe.id, elaboracion, true);
    expect(lotKg("MP-AGUA", "A1")).toBe(70);

    await service.returnForCorrection(oe.id, produccion, "Kg mal cargados");
    expect(lotKg("MP-AGUA", "A1")).toBe(100);
    expect(await codeKg("MP-AGUA")).toBe(150);

    // Corrección: 25 kg del lote A2 en vez de 30 del A1.
    await elaboracionCarga(oe.id, (ms) => [{ ...ms[0]!, kgReal: 25, lote: "A2" }]);
    await service.deliver(oe.id, elaboracion, true);
    expect(lotKg("MP-AGUA", "A1")).toBe(100);
    expect(lotKg("MP-AGUA", "A2")).toBe(25);
    expect(await codeKg("MP-AGUA")).toBe(125);

    await service.annul(oe.id, produccion, "Producción cancelada");
    expect(lotKg("MP-AGUA", "A2")).toBe(50);
    expect(await codeKg("MP-AGUA")).toBe(150);
    // Anular dos veces: no devuelve de más.
    await service.annul(oe.id, produccion, "otra vez");
    expect(await codeKg("MP-AGUA")).toBe(150);
    // Historial intacto: consumos y reversos quedan registrados (no se borra nada).
    const kinds = (await getMpStockLedger().history("MP-AGUA")).map((m) => m.kind);
    expect(kinds.filter((k) => k === "CONSUMO_OE")).toHaveLength(2); // 30 del A1 y, tras la devolución, 25 del A2
    expect(kinds.filter((k) => k === "REVERSO").length).toBeGreaterThanOrEqual(2);
  });

  it("sin faltante, Producción no entrega la OE en lugar de Elaboración", async () => {
    const oe = await makeOe([{ materiaPrima: "AGUA", formulaPct: 100, codigoMp: "MP-AGUA" }]);
    await elaboracionCarga(oe.id, (ms) => [{ ...ms[0]!, kgReal: 10, lote: "A1" }]);
    await expect(service.deliver(oe.id, produccion, true, { allowNegativeMpStock: true, negativeMpStockReason: "x" })).rejects.toBeInstanceOf(OrdersForbiddenError);
    expect(lotKg("MP-AGUA", "A1")).toBe(100);
    expect((await service.getOrder(oe.id, produccion)).status).not.toMatch(/COMPLETA/);
  });

  it("guardar avance, autoguardado o recargar la OE no descuentan stock", async () => {
    const oe = await makeOe([{ materiaPrima: "AGUA", formulaPct: 100, codigoMp: "MP-AGUA" }]);
    await elaboracionCarga(oe.id, (ms) => [{ ...ms[0]!, kgReal: 30, lote: "A1" }]);
    await elaboracionCarga(oe.id, (ms) => [{ ...ms[0]!, kgReal: 31, lote: "A1" }]);
    expect(lotKg("MP-AGUA", "A1")).toBe(100);
    expect(await codeKg("MP-AGUA")).toBe(150);
  });
});
