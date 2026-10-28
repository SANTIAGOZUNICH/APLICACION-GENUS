import { beforeEach, describe, expect, it } from "vitest";
import { memoryInventoryRepo } from "@/lib/inventory/get-inventory-service";
import { emptyOeMaterial } from "@/lib/orders/content";
import { MemoryOrdersRepository } from "@/lib/orders/memory-repository";
import { seedMpStockForTests } from "@/lib/orders/oe-mp-test-fixture";
import { OrdersService } from "@/lib/orders/orders-service";
import type { OeContent, OrdersActor } from "@/lib/orders/types";

const calidad: OrdersActor = { email: "calidad@genus.test", sector: "CALIDAD", displayName: "Calidad" };
const produccion: OrdersActor = { email: "produccion@genus.test", sector: "PRODUCCION", displayName: "Producción" };
const elaboracion: OrdersActor = { email: "elaboracion@genus.test", sector: "ELABORACION", displayName: "Elaboración" };
const lotKg = (codigo: string, lote: string) => memoryInventoryRepo.mpStock.find((l) => l.codigo === codigo && l.lote === lote)?.cantidadKg ?? null;

describe("OE · «Fórmula pendiente de verificación» (contención)", () => {
  let service: OrdersService;
  beforeEach(async () => {
    await seedMpStockForTests([{ codigo: "MP-ALC", lote: "A1", kg: 500 }, { codigo: "MP-AGUA", lote: "W1", kg: 500 }]);
    service = new OrdersService(new MemoryOrdersRepository());
  });

  /** OE con composición que NO suma 100 (p. ej. 60 % + 24,5 % = 84,5 %): composición sospechosa. */
  async function makeOe(pcts: [number, number]) {
    const t = (await service.listTemplates("OE"))[0]!;
    const order = await service.createOrder({ type: "OE", templateId: t.id, assignedSector: "ELABORACION", product: "AFTER SHAVE BASE", client: "ORIGINAL BLACK", lot: "L1" }, calidad);
    const form = structuredClone(order.formData) as OeContent;
    form.header = { ...form.header, productName: "AFTER SHAVE BASE", date: "2026-10-13", quantityKg: 100, lot: "L1", client: "ORIGINAL BLACK" };
    form.processControl = { ...form.processControl, cantidadObtenida: 99, fechaFin: "2026-10-13" };
    form.qualityControl = { ...form.qualityControl, resultado: "OK" };
    form.materials = [
      emptyOeMaterial({ id: "alc", materiaPrima: "ALCOHOL", formulaPct: pcts[0], codigoMp: "MP-ALC" }),
      emptyOeMaterial({ id: "agua", materiaPrima: "AGUA", formulaPct: pcts[1], codigoMp: "MP-AGUA" }),
    ];
    return service.saveProgress(order.id, { expectedVersion: order.version, formData: form, formulaVersionId: "ver-test" }, produccion);
  }
  async function avance(id: string) {
    const cur = await service.getOrder(id, elaboracion);
    const form = structuredClone(cur.formData) as OeContent;
    form.materials = form.materials.map((m) => ({ ...m, kgReal: m.kgAPesar, lote: m.codigoMp === "MP-ALC" ? "A1" : "W1" }));
    return service.saveProgressWithConsumption(id, { expectedVersion: cur.version, formData: form, registerMpConsumption: true }, elaboracion);
  }

  it("composición que no suma 100: queda pendiente, no descuenta y no se puede entregar", async () => {
    const oe = await makeOe([60, 24.5]);
    const check = await service.getFormulaCheck(oe.id, elaboracion);
    expect(check.pending).toBe(true);
    expect(check.issues).toContain("SUMA_FUERA_DE_RANGO");
    const a = await avance(oe.id);
    expect(a.mpConsumption?.applied).toEqual([]);
    expect(a.mpConsumption?.pendingIssues[0]).toMatch(/pendiente de verificación/i);
    expect(lotKg("MP-ALC", "A1")).toBe(500); // sin movimientos
    await expect(service.deliver(oe.id, elaboracion, true)).rejects.toThrow(/pendiente de verificación/i);
  });

  it("Elaboración no puede verificar; Producción sí (con nota) y luego se libera; el % no se toca", async () => {
    const oe = await makeOe([60, 24.5]);
    await expect(service.verifyFormula(oe.id, elaboracion, { action: "verify", note: "ok" })).rejects.toThrow();
    await expect(service.verifyFormula(oe.id, produccion, { action: "verify", note: "" })).rejects.toThrow();
    const v = await service.verifyFormula(oe.id, produccion, { action: "verify", note: "Fórmula Drive ORIGINAL BLACK v2026-10" });
    expect(v.check.pending).toBe(false);
    expect(v.check.verified).toBe(true);
    const pcts = (v.order.formData as OeContent).materials.map((m) => m.formulaPct);
    expect(pcts).toEqual([60, 24.5]);
    const a = await avance(oe.id);
    expect(a.mpConsumption?.applied.length).toBeGreaterThan(0);
    expect(lotKg("MP-ALC", "A1")).toBe(500 - 60);
  });

  it("si cambia la composición, la verificación deja de valer", async () => {
    const oe = await makeOe([60, 24.5]);
    await service.verifyFormula(oe.id, produccion, { action: "verify", note: "Drive v1" });
    const cur = await service.getOrder(oe.id, produccion);
    const form = structuredClone(cur.formData) as OeContent;
    form.materials = form.materials.map((m) => (m.id === "alc" ? { ...m, formulaPct: 71 } : m));
    const saved = await service.saveProgress(oe.id, { expectedVersion: cur.version, formData: form }, produccion);
    expect((await service.getFormulaCheck(saved.id, produccion)).pending).toBe(true);
  });

  it("un guardado de pantalla no puede fabricar una verificación", async () => {
    const oe = await makeOe([60, 24.5]);
    const cur = await service.getOrder(oe.id, produccion);
    const form = structuredClone(cur.formData) as OeContent;
    form.formulaVerification = { status: "VERIFICADA", signature: "x", by: "x", at: "x", note: "x" };
    const saved = await service.saveProgress(oe.id, { expectedVersion: cur.version, formData: form }, produccion);
    expect((saved.formData as OeContent).formulaVerification).toBeUndefined();
  });

  it("composición completa (suma 100) no se bloquea", async () => {
    const oe = await makeOe([60, 40]);
    expect((await service.getFormulaCheck(oe.id, elaboracion)).pending).toBe(false);
    const a = await avance(oe.id);
    expect(a.mpConsumption?.applied.length).toBeGreaterThan(0);
  });

  it("auditoría: lista la OE con diferencias; solo Producción/Dirección", async () => {
    await makeOe([60, 24.5]);
    await expect(service.auditFormulas(elaboracion)).rejects.toThrow();
    const rep = await service.auditFormulas(produccion);
    expect(rep.summary.oeConDiferencias).toBe(1);
    expect(rep.rows[0]!.revision).toMatch(/PENDIENTE_DE_VERIFICACION/);
  });
});
