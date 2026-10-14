/**
 * Eliminación de OE por Producción: cualquier estado, motivo obligatorio, soft-delete, sin tocar stock MP y sin
 * que la OE eliminada pueda volver a modificarse ni a mover inventario.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryOrdersRepository } from "@/lib/orders/memory-repository";
import { OrdersService } from "@/lib/orders/orders-service";
import { canDeleteOe } from "@/lib/orders/rbac";
import { normalizeOrderContent } from "@/lib/orders/content";
import { getMpStockLedger, resetMpStockMemoryForTests } from "@/lib/mp-stock/mp-stock-ledger";
import { buildOrderLifecycleMenuItems } from "@/features/os/operational/components/order-lifecycle-row-actions";
import type { OeContent, OrderContent, OrdersActor } from "@/lib/orders/types";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";

const actor = (sector: string, email: string): OrdersActor => ({ email, sector, displayName: sector }) as OrdersActor;
const produccion = actor("PRODUCCION", "produccion@laboratoriogenus.com.ar");
const direccion = actor("DIRECCION", "direccion@laboratoriogenus.com.ar");
const calidad = actor("CALIDAD", "calidad@laboratoriogenus.com.ar");
const elaboracion = actor("ELABORACION", "elaboracion@laboratoriogenus.com.ar");

function fillOe(form: OrderContent): OeContent {
  if (form.kind !== "OE") throw new Error("OE");
  return normalizeOrderContent({
    ...form,
    header: { ...form.header, productName: "SERUM", date: "2026-10-13", quantityKg: 100, lot: "L-1", client: "CLIENTE" },
    materials: [
      { ...form.materials[0]!, materiaPrima: "Agua", codigo: "MP-AGUA", formulaPct: 90, kgAPesar: 90 },
      { ...form.materials[0]!, id: "m2", materiaPrima: "Glicerina", codigo: "MP-GLI", formulaPct: 10, kgAPesar: 10 },
    ],
    processControl: { ...form.processControl, cantidadObtenida: 98, fechaFin: "2026-10-13" },
    qualityControl: { ...form.qualityControl, resultado: "OK" },
  }) as OeContent;
}

describe("Eliminar OE (Producción, cualquier estado)", () => {
  let service: OrdersService;
  let repo: MemoryOrdersRepository;

  beforeEach(() => {
    repo = new MemoryOrdersRepository();
    service = new OrdersService(repo);
    resetMpStockMemoryForTests();
  });

  async function newOe() {
    const t = (await service.listTemplates("OE"))[0]!;
    return service.createOrder({ type: "OE", templateId: t.id, assignedSector: "ELABORACION" }, calidad);
  }
  async function deliveredOe() {
    const oe = await newOe();
    const saved = await service.saveProgress(oe.id, { expectedVersion: oe.version, formData: fillOe(oe.formData) }, produccion);
    return service.deliver(saved.id, elaboracion, true);
  }

  it("solo Producción y Dirección pueden eliminar OE", () => {
    expect(canDeleteOe("PRODUCCION")).toBe(true);
    expect(canDeleteOe("DIRECCION")).toBe(true);
    for (const s of ["CALIDAD", "ELABORACION", "MATERIA_PRIMA", "DEPOSITO", "ENVASADO_MASIVO"] as const) {
      expect(canDeleteOe(s)).toBe(false);
    }
  });

  it("el servidor rechaza a otros sectores y exige motivo", async () => {
    const oe = await newOe();
    await expect(service.deleteOe(oe.id, calidad, "Duplicada")).rejects.toBeInstanceOf(OrdersForbiddenError);
    await expect(service.deleteOe(oe.id, elaboracion, "Duplicada")).rejects.toBeInstanceOf(OrdersForbiddenError);
    await expect(service.deleteOe(oe.id, produccion, "")).rejects.toBeInstanceOf(OrdersValidationError);
    await expect(service.deleteOe(oe.id, produccion, "   ")).rejects.toBeInstanceOf(OrdersValidationError);
    expect((await repo.getOrder(oe.id))?.deletedAt).toBeNull();
  });

  it("elimina en cualquier estado: borrador, entregada, archivada y anulada; registra usuario, fecha y motivo", async () => {
    const borrador = await newOe();
    const entregada = await deliveredOe();
    const archivada = await service.archive((await deliveredOe()).id, produccion);
    const anulada = await service.annul((await deliveredOe()).id, produccion, "Error de carga");
    expect(archivada.status).toBe("ARCHIVADA");
    expect(anulada.status).toBe("ANULADA");
    for (const o of [borrador, entregada, archivada, anulada]) {
      const deleted = await service.deleteOe(o.id, o === anulada ? direccion : produccion, `Motivo ${o.status}`);
      expect(deleted.deletedAt).toBeTruthy();
      expect(deleted.deleteReason).toBe(`Motivo ${o.status}`);
      expect(deleted.deletedBy).toBe(o === anulada ? direccion.email : produccion.email);
      // El estado anterior se conserva (no se reescribe).
      expect(deleted.status).toBe(o.status);
    }
  });

  it("una OE entregada que ya descontó MP: eliminarla NO devuelve stock ni borra movimientos", async () => {
    const oe = await deliveredOe();
    const ledger = getMpStockLedger();
    const before = await ledger.listMovementsForRef("oe", oe.id);
    expect(before.length).toBeGreaterThan(0); // la entrega descontó MP-AGUA y MP-GLI
    const balAgua = (await ledger.getBalance("MP-AGUA"))?.stockActual;
    const balGli = (await ledger.getBalance("MP-GLI"))?.stockActual;

    await service.deleteOe(oe.id, produccion, "Cargada dos veces");

    const after = await ledger.listMovementsForRef("oe", oe.id);
    expect(after).toEqual(before);
    expect((await ledger.getBalance("MP-AGUA"))?.stockActual).toBe(balAgua);
    expect((await ledger.getBalance("MP-GLI"))?.stockActual).toBe(balGli);

    const audit = repo.audits.filter((a) => a.orderId === oe.id).find((a) => a.eventType === "ORDER_OE_DELETED");
    expect(audit?.metadata).toMatchObject({
      reason: "Cargada dos veces",
      orderNumber: oe.orderNumber,
      previousStatus: oe.status,
      stockReverted: false,
    });
    expect((audit?.metadata as { stockMovementsKept: unknown[] }).stockMovementsKept).toHaveLength(2);
  });

  it("eliminada: no se edita, no se entrega, no se anula/archiva/restaura/devuelve y no vuelve a mover stock", async () => {
    const oe = await deliveredOe();
    const ledger = getMpStockLedger();
    const movs = (await ledger.listMovementsForRef("oe", oe.id)).length;
    const deleted = await service.deleteOe(oe.id, produccion, "Duplicada");

    await expect(service.annul(oe.id, produccion, "x")).rejects.toThrow(/fue eliminada/);
    await expect(service.archive(oe.id, produccion)).rejects.toThrow(/fue eliminada/);
    await expect(service.returnForCorrection(oe.id, produccion, "x")).rejects.toThrow(/fue eliminada/);
    await expect(service.deliver(oe.id, elaboracion, true)).rejects.toThrow(/fue eliminada/);
    await expect(
      service.saveProgress(oe.id, { expectedVersion: deleted.version, formData: deleted.formData }, elaboracion)
    ).rejects.toThrow(/fue eliminada/);
    expect((await ledger.listMovementsForRef("oe", oe.id)).length).toBe(movs);
  });

  it("borrador eliminado no se puede editar ni entregar (nunca genera consumo)", async () => {
    const oe = await newOe();
    const deleted = await service.deleteOe(oe.id, produccion, "No corresponde");
    await expect(
      service.saveProgress(oe.id, { expectedVersion: deleted.version, formData: fillOe(deleted.formData) }, elaboracion)
    ).rejects.toThrow(/fue eliminada/);
    await expect(service.deliver(oe.id, elaboracion, true)).rejects.toThrow(/fue eliminada/);
    expect(await getMpStockLedger().listMovementsForRef("oe", oe.id)).toEqual([]);
  });

  it("idempotente: eliminar dos veces no cambia nada", async () => {
    const oe = await newOe();
    const first = await service.deleteOe(oe.id, produccion, "Duplicada");
    const second = await service.deleteOe(oe.id, produccion, "Otro motivo");
    expect(second.deletedAt).toBe(first.deletedAt);
    expect(second.deleteReason).toBe("Duplicada");
    expect(repo.audits.filter((a) => a.orderId === oe.id).filter((a) => a.eventType === "ORDER_OE_DELETED")).toHaveLength(1);
  });

  it("desaparece del listado operativo; Producción la ve en «Ver eliminadas»", async () => {
    const oe = await newOe();
    await service.deleteOe(oe.id, produccion, "Duplicada");
    expect((await service.listOrders({ type: "OE" }, produccion)).items.map((o) => o.id)).not.toContain(oe.id);
    expect((await service.listOrders({ type: "OE" }, elaboracion)).items.map((o) => o.id)).not.toContain(oe.id);
    const withDeleted = await service.listOrders({ type: "OE", includeDeleted: true }, produccion);
    expect(withDeleted.items.find((o) => o.id === oe.id)?.deleteReason).toBe("Duplicada");
  });

  it("deleteOe es solo para OE", async () => {
    const oaT = (await service.listTemplates("OA"))[0]!;
    const oa = await service.createOrder({ type: "OA", templateId: oaT.id, assignedSector: "ENVASADO_MASIVO" }, calidad);
    await expect(service.deleteOe(oa.id, produccion, "x")).rejects.toBeInstanceOf(OrdersValidationError);
  });

  it("menú: «Eliminar OE» para Producción en cualquier estado (también archivada); nada para otros sectores ni para una ya eliminada", () => {
    const base = { id: "1", type: "OE" as const, lot: "L", product: "P", client: "C", orderNumber: "OE-2026-000001" };
    for (const status of ["BORRADOR", "PENDIENTE", "COMPLETA", "ARCHIVADA", "ANULADA"] as const) {
      const items = buildOrderLifecycleMenuItems({ ...base, status }, "PRODUCCION");
      const del = items.find((i) => i.label === "Eliminar OE");
      expect(del?.requireReasonMandatory).toBe(true);
      expect(del?.decision.requireDoubleConfirm).toBe(true);
    }
    expect(buildOrderLifecycleMenuItems({ ...base, status: "COMPLETA" }, "CALIDAD").some((i) => i.label === "Eliminar OE")).toBe(false);
    expect(buildOrderLifecycleMenuItems({ ...base, status: "COMPLETA" }, "ELABORACION").some((i) => i.label === "Eliminar OE")).toBe(false);
    expect(buildOrderLifecycleMenuItems({ ...base, status: "COMPLETA", deletedAt: "2026-10-13T00:00:00Z" }, "PRODUCCION")).toEqual([]);
  });
});
