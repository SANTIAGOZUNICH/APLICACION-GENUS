import { beforeEach, describe, expect, it } from "vitest";
import { memoryInventoryRepo } from "@/lib/inventory/get-inventory-service";
import { getMpStockLedger } from "@/lib/mp-stock/mp-stock-ledger";
import { emptyOeMaterial } from "@/lib/orders/content";
import { MemoryOrdersRepository } from "@/lib/orders/memory-repository";
import { seedMpStockForTests } from "@/lib/orders/oe-mp-test-fixture";
import { createSheet } from "@/lib/orders/oe-sheets";
import { OrdersService } from "@/lib/orders/orders-service";
import type { OeContent, OrdersActor } from "@/lib/orders/types";

const calidad: OrdersActor = { email: "calidad@genus.test", sector: "CALIDAD", displayName: "Calidad" };
const produccion: OrdersActor = { email: "produccion@genus.test", sector: "PRODUCCION", displayName: "Producción" };
const elaboracion: OrdersActor = { email: "elaboracion@genus.test", sector: "ELABORACION", displayName: "Elaboración" };
const lotKg = (codigo: string, lote: string) => memoryInventoryRepo.mpStock.find((l) => l.codigo === codigo && l.lote === lote)?.cantidadKg ?? null;
const codeKg = async (codigo: string) => (await getMpStockLedger().getBalance(codigo))?.stockActual ?? null;

describe("OE con varias hojas (tambores): consumo único y trazable", () => {
  let service: OrdersService;
  beforeEach(async () => {
    await seedMpStockForTests([
      { codigo: "MP-AGUA", lote: "A1", kg: 500 },
      { codigo: "MP-AGUA", lote: "A2", kg: 500 },
    ]);
    service = new OrdersService(new MemoryOrdersRepository());
  });

  async function makeOe() {
    const t = (await service.listTemplates("OE"))[0]!;
    const order = await service.createOrder({ type: "OE", templateId: t.id, assignedSector: "ELABORACION", product: "CREMA", client: "C", lot: "L-OE" }, calidad);
    const form = structuredClone(order.formData) as OeContent;
    form.header = { ...form.header, productName: "CREMA", date: "2026-10-13", quantityKg: 380, lot: "L-OE", client: "C" };
    form.processControl = { ...form.processControl, cantidadObtenida: 379, fechaFin: "2026-10-13" };
    form.qualityControl = { ...form.qualityControl, resultado: "OK" };
    form.materials = [emptyOeMaterial({ id: "agua", materiaPrima: "AGUA", formulaPct: 70, codigoMp: "MP-AGUA" })];
    return service.saveProgress(order.id, { expectedVersion: order.version, formData: form }, produccion);
  }
  async function elaboracionSave(id: string, edit: (f: OeContent) => void) {
    const cur = await service.getOrder(id, elaboracion);
    const form = structuredClone(cur.formData) as OeContent;
    edit(form);
    return service.saveProgress(id, { expectedVersion: cur.version, formData: form }, elaboracion);
  }

  it("crear hojas y calcular teóricos no descuenta stock; entregar descuenta UNA vez lo real por hoja y lote; reintento no duplica", async () => {
    const oe = await makeOe();
    await elaboracionSave(oe.id, (f) => {
      f.sheets = [createSheet(f, { kind: "tambor", kg: 200, by: elaboracion.email })];
    });
    await elaboracionSave(oe.id, (f) => {
      f.sheets = [...f.sheets!, createSheet(f, { kind: "tambor", kg: 180, by: elaboracion.email })];
    });
    const saved = await service.getOrder(oe.id, elaboracion);
    const sheets = (saved.formData as OeContent).sheets!;
    expect(sheets.map((s) => s.materials[0]!.kgAPesar)).toEqual([140, 126]);
    expect(lotKg("MP-AGUA", "A1")).toBe(500); // sin consumo por crear hojas
    expect(await codeKg("MP-AGUA")).toBe(1000);

    // Elaboración carga lo real: tambor 1 con dos lotes, tambor 2 con otro lote.
    await elaboracionSave(oe.id, (f) => {
      const [s1, s2] = f.sheets!;
      const r1 = s1!.materials[0]!;
      s1!.materials = [{ ...r1, kgReal: 100, lote: "A1" }, emptyOeMaterial({ id: "x1", parentRowId: r1.id, kgReal: 41, lote: "A2" })];
      s1!.status = "elaborado";
      s2!.materials = [{ ...s2!.materials[0]!, kgReal: 127, lote: "A2" }];
      s2!.status = "elaborado";
    });
    await service.deliver(oe.id, elaboracion, true);
    expect(lotKg("MP-AGUA", "A1")).toBe(400);
    expect(lotKg("MP-AGUA", "A2")).toBe(500 - 41 - 127);
    expect(await codeKg("MP-AGUA")).toBe(1000 - 268); // (100 + 41 + 127), una sola vez
    await expect(service.deliver(oe.id, elaboracion, true)).rejects.toThrow(/ya está completa/);
    expect(await codeKg("MP-AGUA")).toBe(1000 - 268);
  });

  it("Elaboración no puede cambiar la fórmula a través de una hoja", async () => {
    const oe = await makeOe();
    await elaboracionSave(oe.id, (f) => {
      f.sheets = [createSheet(f, { kind: "olla", kg: 100, by: elaboracion.email })];
    });
    await elaboracionSave(oe.id, (f) => {
      const s = f.sheets![0]!;
      s.materials[0] = { ...s.materials[0]!, formulaPct: 1, materiaPrima: "OTRA" };
      s.materials.push(emptyOeMaterial({ id: "nueva", materiaPrima: "ORO", formulaPct: 50 }));
    });
    const s = ((await service.getOrder(oe.id, elaboracion)).formData as OeContent).sheets![0]!;
    expect(s.materials).toHaveLength(1);
    expect(s.materials[0]).toMatchObject({ materiaPrima: "AGUA", formulaPct: 70, kgAPesar: 70 });
  });

  it("una hoja pendiente sin datos no bloquea la entrega ni consume; OE sin hojas sigue igual", async () => {
    const oe = await makeOe();
    await elaboracionSave(oe.id, (f) => {
      const done = createSheet(f, { kind: "tambor", kg: 100, by: elaboracion.email });
      done.materials[0] = { ...done.materials[0]!, kgReal: 70, lote: "A1" };
      done.status = "elaborado";
      f.sheets = [done, createSheet({ ...f, sheets: [done] }, { kind: "tambor", kg: 280, by: elaboracion.email })];
    });
    await service.deliver(oe.id, elaboracion, true);
    expect(await codeKg("MP-AGUA")).toBe(930);
  });
});
