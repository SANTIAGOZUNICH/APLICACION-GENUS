import { beforeEach, describe, expect, it } from "vitest";
import { memoryInventoryRepo } from "@/lib/inventory/get-inventory-service";
import { getMpStockLedger } from "@/lib/mp-stock/mp-stock-ledger";
import { emptyOeMaterial } from "@/lib/orders/content";
import { MemoryOrdersRepository } from "@/lib/orders/memory-repository";
import { seedMpStockForTests } from "@/lib/orders/oe-mp-test-fixture";
import { OrdersService } from "@/lib/orders/orders-service";
import type { OeContent, OeMaterialRow, OrdersActor } from "@/lib/orders/types";

const calidad: OrdersActor = { email: "calidad@genus.test", sector: "CALIDAD", displayName: "Calidad" };
const produccion: OrdersActor = { email: "produccion@genus.test", sector: "PRODUCCION", displayName: "Producción" };
const elaboracion: OrdersActor = { email: "elaboracion@genus.test", sector: "ELABORACION", displayName: "Elaboración" };

const lotKg = (codigo: string, lote: string) => memoryInventoryRepo.mpStock.find((l) => l.codigo === codigo && l.lote === lote)?.cantidadKg ?? null;
const codeKg = async (codigo: string) => (await getMpStockLedger().getBalance(codigo))?.stockActual ?? null;
const movs = async (codigo: string) => (await getMpStockLedger().history(codigo)).filter((m) => m.kind === "CONSUMO_OE").length;

describe("OE: GUARDAR AVANCE descuenta el consumo real de MP (sin doble descuento)", () => {
  let service: OrdersService;

  beforeEach(async () => {
    await seedMpStockForTests([
      { codigo: "MP-AGUA", lote: "A1", kg: 100 },
      { codigo: "MP-GLI", lote: "G1", kg: 200 },
    ]);
    service = new OrdersService(new MemoryOrdersRepository());
  });

  async function makeOe() {
    const t = (await service.listTemplates("OE"))[0]!;
    const order = await service.createOrder({ type: "OE", templateId: t.id, assignedSector: "ELABORACION", product: "CREMA", client: "C", lot: "L-OE" }, calidad);
    const form = structuredClone(order.formData) as OeContent;
    form.header = { ...form.header, productName: "CREMA", date: "2026-10-13", quantityKg: 100, lot: "L-OE", client: "C" };
    form.processControl = { ...form.processControl, cantidadObtenida: 99, fechaFin: "2026-10-13" };
    form.qualityControl = { ...form.qualityControl, resultado: "OK" };
    form.materials = [emptyOeMaterial({ id: "agua", materiaPrima: "AGUA", formulaPct: 100, codigoMp: "MP-AGUA" })];
    return service.saveProgress(order.id, { expectedVersion: order.version, formData: form }, produccion);
  }

  /** «Guardar avance» (botón) con el consumo real indicado; `flag=false` = autoguardado. */
  async function avance(id: string, edit: (m: OeMaterialRow[]) => OeMaterialRow[], flag = true) {
    const cur = await service.getOrder(id, elaboracion);
    const form = structuredClone(cur.formData) as OeContent;
    form.materials = edit(form.materials);
    return service.saveProgressWithConsumption(id, { expectedVersion: cur.version, formData: form, registerMpConsumption: flag }, elaboracion);
  }
  const kg = (n: number | null, lote = "A1") => (m: OeMaterialRow[]) => [{ ...m[0]!, kgReal: n, lote }];

  it("descuenta al guardar avance (OE sigue en curso), no vuelve a descontar al guardar igual, y solo la diferencia si cambia", async () => {
    const oe = await makeOe();
    const a = await avance(oe.id, kg(10));
    expect(a.order.status).not.toBe("COMPLETA");
    expect(a.mpConsumption?.applied).toEqual([{ codigo: "MP-AGUA", lote: "A1", delta: -10 }]);
    expect(lotKg("MP-AGUA", "A1")).toBe(90);
    expect(await codeKg("MP-AGUA")).toBe(90);

    const b = await avance(oe.id, kg(10)); // sin cambios
    expect(b.mpConsumption?.applied).toEqual([]);
    expect(lotKg("MP-AGUA", "A1")).toBe(90);
    expect(await movs("MP-AGUA")).toBe(1);

    const c = await avance(oe.id, kg(12)); // aumenta: solo la diferencia
    expect(c.mpConsumption?.applied).toEqual([{ codigo: "MP-AGUA", lote: "A1", delta: -2 }]);
    expect(lotKg("MP-AGUA", "A1")).toBe(88);

    const d = await avance(oe.id, kg(12)); // sin cambios otra vez
    expect(d.mpConsumption?.applied).toEqual([]);
    expect(await codeKg("MP-AGUA")).toBe(88);

    const e = await avance(oe.id, kg(9)); // baja: compensación auditada de 3 kg
    expect(e.mpConsumption?.applied).toEqual([{ codigo: "MP-AGUA", lote: "A1", delta: 3 }]);
    expect(lotKg("MP-AGUA", "A1")).toBe(91);
    expect(await codeKg("MP-AGUA")).toBe(91);
    expect(lotKg("MP-GLI", "G1")).toBe(200); // otros materiales/OE intactos
  });

  it("el autoguardado (sin el botón) NO descuenta", async () => {
    const oe = await makeOe();
    const r = await avance(oe.id, kg(10), false);
    expect(r.mpConsumption).toBeNull();
    expect(lotKg("MP-AGUA", "A1")).toBe(100);
    expect(await movs("MP-AGUA")).toBe(0);
  });

  it("ENTREGAR después de guardar avance reconoce lo descontado y no lo duplica", async () => {
    const oe = await makeOe();
    await avance(oe.id, kg(10));
    expect(lotKg("MP-AGUA", "A1")).toBe(90);
    await service.deliver(oe.id, elaboracion, true);
    expect(lotKg("MP-AGUA", "A1")).toBe(90); // no vuelve a descontar los 10 kg
    expect(await codeKg("MP-AGUA")).toBe(90);
    expect(await movs("MP-AGUA")).toBe(1);
  });

  it("entregar con un consumo mayor al ya descontado registra solo la diferencia", async () => {
    const oe = await makeOe();
    await avance(oe.id, kg(10));
    await avance(oe.id, kg(13), false); // cambio sin botón: todavía no contabilizado
    expect(lotKg("MP-AGUA", "A1")).toBe(90);
    await service.deliver(oe.id, elaboracion, true);
    expect(lotKg("MP-AGUA", "A1")).toBe(87); // −3 kg adicionales, no −13
    expect(await codeKg("MP-AGUA")).toBe(87);
  });

  it("datos incompletos (sin CÓDIGO MP): guarda igual, no inventa movimientos, avisa sin bloquear y se regulariza después", async () => {
    const oe = await makeOe();
    const a = await avance(oe.id, (m) => [{ ...m[0]!, kgReal: 8, codigoMp: "", lote: "A1" }]); // falta el código
    expect(a.order.version).toBeGreaterThan(oe.version);
    expect(a.mpConsumption?.applied).toEqual([]);
    expect(a.mpConsumption?.pendingIssues.length).toBeGreaterThan(0);
    expect(lotKg("MP-AGUA", "A1")).toBe(100);
    expect(await movs("MP-AGUA")).toBe(0);
    const b = await avance(oe.id, (m) => [{ ...m[0]!, kgReal: 8, codigoMp: "MP-AGUA", lote: "A1" }]); // se completa el dato
    expect(b.mpConsumption?.applied).toEqual([{ codigo: "MP-AGUA", lote: "A1", delta: -8 }]);
    expect(lotKg("MP-AGUA", "A1")).toBe(92);
  });

  it("LOTE MP vacío: descuenta por CÓDIGO (25 kg − 3 kg = 22 kg), queda auditado con la OE y no se duplica al guardar de nuevo", async () => {
    await seedMpStockForTests([{ codigo: "MP001", lote: "G-1", kg: 25, descripcion: "Glicerina" }, { codigo: "MP-AGUA", lote: "A1", kg: 100 }]);
    const oe = await makeOe();
    const sinLote = (n: number) => (m: OeMaterialRow[]) => [{ ...m[0]!, codigoMp: "MP001", kgReal: n, lote: "" }];
    const a = await avance(oe.id, sinLote(3));
    expect(a.mpConsumption?.pendingIssues).toEqual([]);
    expect(a.mpConsumption?.applied).toEqual([{ codigo: "MP001", lote: "G-1", delta: -3 }]);
    expect(await codeKg("MP001")).toBe(22);
    expect(lotKg("MP001", "G-1")).toBe(22);
    const mov = (await getMpStockLedger().history("MP001")).find((x) => x.kind === "CONSUMO_OE")!;
    expect(mov).toMatchObject({ refType: "oe", refId: oe.id, quantity: -3 });
    expect(mov.reason).toContain("kg real");
    const b = await avance(oe.id, sinLote(3)); // guardar dos veces: no duplica
    expect(b.mpConsumption?.applied).toEqual([]);
    expect(await codeKg("MP001")).toBe(22);
    const c = await avance(oe.id, sinLote(5)); // cambia la cantidad: solo la diferencia
    expect(c.mpConsumption?.applied).toEqual([{ codigo: "MP001", lote: "G-1", delta: -2 }]);
    expect(await codeKg("MP001")).toBe(20);
    const d = await avance(oe.id, sinLote(4)); // baja: compensación de la diferencia
    expect(d.mpConsumption?.applied).toEqual([{ codigo: "MP001", lote: "G-1", delta: 1 }]);
    expect(await codeKg("MP001")).toBe(21);
    await service.deliver(oe.id, elaboracion, true); // entregar reconoce lo ya descontado
    expect(await codeKg("MP001")).toBe(21);
  });

  it("dos lotes sin indicar lote: FEFO — 2 kg del lote de vencimiento más próximo y 3 kg del siguiente", async () => {
    await seedMpStockForTests([
      { codigo: "MP001", lote: "B", kg: 8, vencimiento: "2027-06-01" },
      { codigo: "MP001", lote: "A", kg: 2, vencimiento: "2027-01-01" },
      { codigo: "MP-AGUA", lote: "A1", kg: 100 },
    ]);
    const oe = await makeOe();
    const a = await avance(oe.id, (m) => [{ ...m[0]!, codigoMp: "MP001", kgReal: 5, lote: "" }]);
    expect(a.mpConsumption?.applied).toEqual([{ codigo: "MP001", lote: "A", delta: -2 }, { codigo: "MP001", lote: "B", delta: -3 }]);
    expect([lotKg("MP001", "A"), lotKg("MP001", "B"), await codeKg("MP001")]).toEqual([0, 5, 5]);
    const b = await avance(oe.id, (m) => [{ ...m[0]!, codigoMp: "MP001", kgReal: 5, lote: "" }]); // sin cambios: no mueve kg entre lotes
    expect(b.mpConsumption?.applied).toEqual([]);
    const c = await avance(oe.id, (m) => [{ ...m[0]!, codigoMp: "MP001", kgReal: 6, lote: "" }]);
    expect(c.mpConsumption?.applied).toEqual([{ codigo: "MP001", lote: "B", delta: -1 }]);
    expect([lotKg("MP001", "A"), lotKg("MP001", "B")]).toEqual([0, 4]);
  });

  it("lote explícito: se respeta y se valida su disponibilidad (no se reparte a otros lotes)", async () => {
    await seedMpStockForTests([{ codigo: "MP001", lote: "A", kg: 2 }, { codigo: "MP001", lote: "B", kg: 8 }, { codigo: "MP-AGUA", lote: "A1", kg: 100 }]);
    const oe = await makeOe();
    const a = await avance(oe.id, (m) => [{ ...m[0]!, codigoMp: "MP001", kgReal: 5, lote: "A" }]); // A solo tiene 2
    expect(a.mpConsumption?.applied).toEqual([]);
    expect(a.mpConsumption?.shortages.map((s) => s.lote)).toEqual(["A"]);
    expect([lotKg("MP001", "A"), lotKg("MP001", "B")]).toEqual([2, 8]);
    const b = await avance(oe.id, (m) => [{ ...m[0]!, codigoMp: "MP001", kgReal: 5, lote: "B" }]);
    expect(b.mpConsumption?.applied).toEqual([{ codigo: "MP001", lote: "B", delta: -5 }]);
  });

  it("stock insuficiente sin lote: no descuenta parcialmente; MP vencida / en cuarentena: no se consume; código inexistente: error claro", async () => {
    await seedMpStockForTests([
      { codigo: "MP001", lote: "A", kg: 2, vencimiento: "2027-01-01" },
      { codigo: "MP001", lote: "B", kg: 8, vencimiento: "2027-06-01" },
      { codigo: "MP-CUA", lote: "Q", kg: 50, estadoStockManual: "Cuarentena" },
      { codigo: "MP-VEN", lote: "V", kg: 50, vencimiento: "2020-01-01" },
      { codigo: "MP-AGUA", lote: "A1", kg: 100 },
    ]);
    const oe = await makeOe();
    const run = (codigoMp: string, n: number) => avance(oe.id, (m) => [{ ...m[0]!, codigoMp, kgReal: n, lote: "" }]);
    const corto = await run("MP001", 50);
    expect(corto.mpConsumption?.applied).toEqual([]);
    expect(corto.mpConsumption?.shortages.length).toBeGreaterThan(0);
    expect([lotKg("MP001", "A"), lotKg("MP001", "B"), await codeKg("MP001")]).toEqual([2, 8, 10]);
    for (const code of ["MP-CUA", "MP-VEN"]) {
      const r = await run(code, 1);
      expect(r.mpConsumption?.applied).toEqual([]);
      expect(r.mpConsumption?.pendingIssues.join(" ")).toMatch(/no se consume/);
      expect(await codeKg(code)).toBe(50);
    }
    const no = await run("NO-EXISTE", 1);
    expect(no.mpConsumption?.applied).toEqual([]);
    expect(no.mpConsumption?.pendingIssues.join(" ")).toContain("no existe en Stock MP");
    expect(await codeKg("MP-AGUA")).toBe(100);
  });

  it("sin KG REAL todavía: no es faltante ni descuenta; sin stock suficiente queda pendiente sin negativos", async () => {
    const oe = await makeOe();
    const a = await avance(oe.id, kg(null));
    expect(a.mpConsumption).toMatchObject({ applied: [], pendingIssues: [], shortages: [] });
    const b = await avance(oe.id, kg(500)); // más de lo que hay
    expect(b.mpConsumption?.applied).toEqual([]);
    expect(b.mpConsumption?.shortages.length).toBeGreaterThan(0);
    expect(lotKg("MP-AGUA", "A1")).toBe(100);
  });
});
