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

  it("lote explícito: se respeta (no se reparte a otros lotes); si el lote no alcanza, se descuenta igual y ese lote queda negativo", async () => {
    await seedMpStockForTests([{ codigo: "MP001", lote: "A", kg: 2 }, { codigo: "MP001", lote: "B", kg: 8 }, { codigo: "MP-AGUA", lote: "A1", kg: 100 }]);
    const oe = await makeOe();
    const a = await avance(oe.id, (m) => [{ ...m[0]!, codigoMp: "MP001", kgReal: 5, lote: "A" }]); // A solo tiene 2
    expect(a.mpConsumption?.applied).toEqual([{ codigo: "MP001", lote: "A", delta: -5 }]);
    expect(a.mpConsumption?.shortages.map((s) => s.lote)).toEqual(["A"]); // advertencia, no bloqueo
    expect([lotKg("MP001", "A"), lotKg("MP001", "B")]).toEqual([-3, 8]); // el faltante NO se traslada al lote B
    // Corregir el lote: se devuelve lo del A y se descuenta del B (solo diferencias, trazables).
    const b = await avance(oe.id, (m) => [{ ...m[0]!, codigoMp: "MP001", kgReal: 5, lote: "B" }]);
    expect(b.mpConsumption?.applied).toEqual(expect.arrayContaining([{ codigo: "MP001", lote: "B", delta: -5 }, { codigo: "MP001", lote: "A", delta: 5 }]));
    expect([lotKg("MP001", "A"), lotKg("MP001", "B")]).toEqual([2, 3]);
  });

  it("stock insuficiente sin lote: se descuenta igual (queda negativo); MP vencida / en cuarentena: no se consume; código inexistente: error claro", async () => {
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
    // Los 10 kg que hay (FEFO: 2 de A y 8 de B) más el faltante (40) sobre el primer lote apto (A): nada se traslada a otra MP.
    expect(corto.mpConsumption?.applied.reduce((n, a) => n + a.delta, 0)).toBe(-50);
    expect(corto.mpConsumption?.shortages.length).toBeGreaterThan(0);
    expect(await codeKg("MP001")).toBe(-40);
    expect(Number(lotKg("MP001", "A")) + Number(lotKg("MP001", "B"))).toBe(-40);
    for (const code of ["MP-CUA", "MP-VEN"]) {
      const r = await run(code, 1);
      expect(r.mpConsumption?.pendingIssues.join(" ")).toMatch(/no se consume/);
      expect(await codeKg(code)).toBe(50);
    }
    const no = await run("NO-EXISTE", 1);
    expect(no.mpConsumption?.pendingIssues.join(" ")).toContain("no existe en Stock MP");
    expect(await codeKg("MP-AGUA")).toBe(100);
  });

  it("sin KG REAL todavía: no es faltante ni descuenta; con más kg que stock: se descuenta y queda negativo (-400)", async () => {
    const oe = await makeOe();
    const a = await avance(oe.id, kg(null));
    expect(a.mpConsumption).toMatchObject({ applied: [], pendingIssues: [], shortages: [] });
    const b = await avance(oe.id, kg(500)); // más de lo que hay (100)
    expect(b.mpConsumption?.applied).toEqual([{ codigo: "MP-AGUA", lote: "A1", delta: -500 }]);
    expect(b.mpConsumption?.shortages.length).toBeGreaterThan(0);
    expect(lotKg("MP-AGUA", "A1")).toBe(-400);
    expect(await codeKg("MP-AGUA")).toBe(-400);
  });

  it("stock exactamente en cero: sin advertencia; con saldo inicial negativo: el consumo se suma al saldo y la entrada posterior no re-descuenta", async () => {
    const oe = await makeOe();
    const justo = await avance(oe.id, kg(100)); // usa justo los 100 kg
    expect(justo.mpConsumption?.shortages).toEqual([]);
    expect(await codeKg("MP-AGUA")).toBe(0);
    // Saldo en 0 y la OE usa 5 kg más → -5 (stock inicial 0 no se "arregla" artificialmente).
    const mas = await avance(oe.id, kg(105));
    expect(mas.mpConsumption?.applied).toEqual([{ codigo: "MP-AGUA", lote: "A1", delta: -5 }]);
    expect(await codeKg("MP-AGUA")).toBe(-5);
    // Guardar igual (recargar/cambiar de pestaña) NO descuenta otra vez.
    const igual = await avance(oe.id, kg(105));
    expect(igual.mpConsumption?.applied).toEqual([]);
    expect(await codeKg("MP-AGUA")).toBe(-5);
    expect(await movs("MP-AGUA")).toBe(2);
    // Ingresa stock después: el saldo se actualiza por movimientos y la OE no vuelve a descontar.
    await getMpStockLedger().applyIngreso({ email: "mp@genus.test", sector: "MATERIA_PRIMA" }, { codigo: "MP-AGUA", quantity: 50, ingresoId: "ing-av-1", versionTag: "v1", lote: "A2", descripcion: "AGUA" });
    expect(await codeKg("MP-AGUA")).toBe(45);
    const otra = await avance(oe.id, kg(105));
    expect(otra.mpConsumption?.applied).toEqual([]);
    expect(await codeKg("MP-AGUA")).toBe(45);
    // Corregir a menos kg: se registra solo la diferencia (+5 devolución), trazable.
    const menos = await avance(oe.id, kg(100));
    expect(menos.mpConsumption?.applied).toEqual([{ codigo: "MP-AGUA", lote: "A1", delta: 5 }]);
    expect(await codeKg("MP-AGUA")).toBe(50);
    // Saldo ya NEGATIVO antes de otra OE: primero otra OE lo deja en -10 (50 − 60) y esta suma 4 más → -14.
    const oe2 = await makeOe();
    await avance(oe2.id, (m) => [{ ...m[0]!, kgReal: 60, lote: "A1" }]);
    expect(await codeKg("MP-AGUA")).toBe(-10);
    const oe3 = await makeOe();
    const neg = await avance(oe3.id, kg(4));
    expect(neg.mpConsumption?.applied).toEqual([{ codigo: "MP-AGUA", lote: "A1", delta: -4 }]);
    expect(await codeKg("MP-AGUA")).toBe(-14);
    // Cada OE conserva SU consumo y el saldo de ese momento (coincide con el historial del código).
    const r3 = await getMpStockLedger().oeConsumptionReport(oe3.id);
    expect(r3[0]).toMatchObject({ consumido: 4, stockAntes: -10, stockDespues: -14, negativo: true });
    const hist = await getMpStockLedger().history("MP-AGUA");
    // Coincidencia: el saldo mostrado = suma de los movimientos reales del código (saldo inicial incluido).
    expect(Math.round(hist.reduce((n, m) => n + m.quantity, 0) * 1000) / 1000).toBe(await codeKg("MP-AGUA"));
  });
});
