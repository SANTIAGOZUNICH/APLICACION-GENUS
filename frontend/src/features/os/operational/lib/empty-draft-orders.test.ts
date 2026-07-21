import { describe, expect, it } from "vitest";
import { MemoryOrdersRepository } from "@/lib/orders/memory-repository";
import { OrdersService } from "@/lib/orders/orders-service";
import { canOrderAction } from "@/lib/orders/rbac";
import {
  displayClient,
  displayProduct,
  isEmptyDraftOrder,
  resolveInitialAssignedSector,
  SIN_ASIGNAR,
} from "@/lib/orders/empty-draft";
import { sanitizeLegalPrintValue } from "@/lib/orders/oa-simple-form";
import type { OrdersActor } from "@/lib/orders/types";

const calidad: OrdersActor = {
  email: "calidad@laboratoriogenus.com.ar",
  sector: "CALIDAD",
  displayName: "Calidad",
};
const produccion: OrdersActor = {
  email: "produccion@laboratoriogenus.com.ar",
  sector: "PRODUCCION",
  displayName: "Producción",
};
const masivo: OrdersActor = {
  email: "emasivo@laboratoriogenus.com.ar",
  sector: "ENVASADO_MASIVO",
  displayName: "Masivo",
};
const premium: OrdersActor = {
  email: "epremium@laboratoriogenus.com.ar",
  sector: "ENVASADO_PREMIUM",
  displayName: "Premium",
};
const codificado: OrdersActor = {
  email: "codificado@laboratoriogenus.com.ar",
  sector: "CODIFICADO",
  displayName: "Codificado",
};

function service() {
  return new OrdersService(new MemoryOrdersRepository());
}

describe("borradores OE/OA completamente vacíos", () => {
  it("crea OA y OE completamente vacías con número único y estado BORRADOR", async () => {
    const svc = service();
    const oa = await svc.createEmptyDraft({ type: "OA" }, calidad);
    expect(oa.order.status).toBe("BORRADOR");
    expect(oa.order.product).toBe("");
    expect(oa.order.client).toBe("");
    expect(oa.order.code).toBe("");
    expect(oa.order.lot).toBe("");
    expect(oa.order.orderNumber).toMatch(/^OA-\d{4}-\d{6}$/);
    expect(oa.template).toBeNull();

    const oe = await svc.createEmptyDraft({ type: "OE" }, produccion);
    expect(oe.order.status).toBe("BORRADOR");
    expect(oe.order.orderNumber).toMatch(/^OE-\d{4}-\d{6}$/);
    expect(oe.order.assignedSector).toBe(SIN_ASIGNAR);
  });

  it("guarda sin producto/cliente/código/lote/sector y aparece en pendientes", async () => {
    const svc = service();
    const { order } = await svc.createEmptyDraft(
      { type: "OA", assignedSector: SIN_ASIGNAR },
      calidad
    );
    const saved = await svc.saveProgress(
      order.id,
      { expectedVersion: order.version, formData: order.formData },
      calidad
    );
    expect(saved.status).toBe("BORRADOR");
    expect(saved.product).toBe("");

    const list = await svc.listOrders({ type: "OA", tab: "pendientes" }, calidad);
    expect(list.items.some((o) => o.id === order.id)).toBe(true);
    expect(list.items.find((o) => o.id === order.id)?.orderNumber).toBe(order.orderNumber);
  });

  it("PDF/display: Sin completar solo visual; sin undefined/null/N/A", () => {
    expect(displayProduct("")).toBe("Sin completar");
    expect(displayClient("")).toBe("Sin completar");
    expect(sanitizeLegalPrintValue(undefined)).toBe("");
    expect(sanitizeLegalPrintValue("N/A")).toBe("");
    expect(sanitizeLegalPrintValue("")).toBe("");
  });

  it("Emasivo/Epremium/Codificado crean OA; asignación automática", async () => {
    expect(canOrderAction("OA", "create", "ENVASADO_MASIVO")).toBe(true);
    expect(canOrderAction("OA", "create", "ENVASADO_PREMIUM")).toBe(true);
    expect(canOrderAction("OA", "create", "CODIFICADO")).toBe(true);

    expect(resolveInitialAssignedSector("OA", "ENVASADO_MASIVO")).toBe("ENVASADO_MASIVO");
    expect(resolveInitialAssignedSector("OA", "ENVASADO_PREMIUM")).toBe("ENVASADO_PREMIUM");
    expect(resolveInitialAssignedSector("OA", "CODIFICADO")).toBe(SIN_ASIGNAR);

    const svc = service();
    const m = await svc.createEmptyDraft({ type: "OA" }, masivo);
    expect(m.order.assignedSector).toBe("ENVASADO_MASIVO");
    const p = await svc.createEmptyDraft({ type: "OA" }, premium);
    expect(p.order.assignedSector).toBe("ENVASADO_PREMIUM");
    const c = await svc.createEmptyDraft({ type: "OA" }, codificado);
    expect(c.order.assignedSector).toBe(SIN_ASIGNAR);
  });

  it("Emasivo no edita OA de Premium y viceversa", async () => {
    const svc = service();
    const prem = await svc.createEmptyDraft({ type: "OA" }, premium);
    await expect(
      svc.saveProgress(
        prem.order.id,
        { expectedVersion: prem.order.version, formData: prem.order.formData },
        masivo
      )
    ).rejects.toMatchObject({ code: "ORDERS_FORBIDDEN" });

    const mas = await svc.createEmptyDraft({ type: "OA" }, masivo);
    await expect(
      svc.saveProgress(
        mas.order.id,
        { expectedVersion: mas.order.version, formData: mas.order.formData },
        premium
      )
    ).rejects.toMatchObject({ code: "ORDERS_FORBIDDEN" });
  });

  it("Codificado completa solo codificado en OA asignada; no materiales/rendimientos", async () => {
    const svc = service();
    const { order } = await svc.createEmptyDraft({ type: "OA" }, masivo);
    const form = structuredClone(order.formData);
    if (form.kind !== "OA") throw new Error("expected OA");
    form.materials[0].nombreInsumo = "ENVASE";
    form.materials[0].recibidos = "10";
    form.rendimientos.produccionTeoricaUnidades = 100;
    form.rendimientos.cantidadUnidades = 100;
    const saved = await svc.saveProgress(
      order.id,
      { expectedVersion: order.version, formData: form },
      masivo
    );

    const patched = structuredClone(saved.formData);
    if (patched.kind !== "OA") throw new Error("expected OA");
    patched.materials[0].nombreInsumo = "HACK";
    patched.rendimientos.produccionTeoricaUnidades = 999;
    patched.etiquetadoCodificado.resultado = "CONFORME";
    patched.etiquetadoCodificado.loteCodificado = "L1";

    const after = await svc.saveProgress(
      saved.id,
      { expectedVersion: saved.version, formData: patched },
      codificado
    );
    if (after.formData.kind !== "OA") throw new Error("expected OA");
    expect(after.formData.materials[0].nombreInsumo).toBe("ENVASE");
    expect(after.formData.rendimientos.produccionTeoricaUnidades).toBe(100);
    expect(after.formData.etiquetadoCodificado.resultado).toBe("CONFORME");
  });

  it("guardar no ejecuta validaciones de entrega; entregar incompleta exige confirmación", async () => {
    const svc = service();
    const { order } = await svc.createEmptyDraft({ type: "OA" }, masivo);
    await expect(
      svc.saveProgress(
        order.id,
        { expectedVersion: order.version, formData: order.formData },
        masivo
      )
    ).resolves.toBeTruthy();

    await expect(svc.deliver(order.id, masivo, true)).rejects.toMatchObject({
      code: "ORDERS_VALIDATION",
    });

    const delivered = await svc.deliver(order.id, masivo, true, { allowIncomplete: true });
    expect(delivered.status).toBe("COMPLETA_CON_PENDIENTES");
  });

  it("borrador vacío no genera notificación; se puede eliminar", async () => {
    const repo = new MemoryOrdersRepository();
    const svc = new OrdersService(repo);
    const before = repo.notifications?.length ?? (repo as never as { notifications: unknown[] });
    void before;
    const { order } = await svc.createEmptyDraft({ type: "OA" }, calidad);
    expect(isEmptyDraftOrder(order)).toBe(true);
    // Memory repo stores notifications in a map/array — count via list
    const notes = await repo.listNotificationsForSector("CALIDAD", calidad.email);
    expect(notes.filter((n) => n.orderId === order.id)).toHaveLength(0);

    const deleted = await svc.deleteEmptyDraft(order.id, calidad);
    expect(deleted.deleted).toBe(true);
    await expect(svc.getOrder(order.id, calidad)).rejects.toMatchObject({
      code: "ORDERS_NOT_FOUND",
    });
  });
});
