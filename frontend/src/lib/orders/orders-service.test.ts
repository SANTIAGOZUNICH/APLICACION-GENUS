import { describe, expect, it, beforeEach } from "vitest";
import { MemoryOrdersRepository } from "@/lib/orders/memory-repository";
import { OrdersService } from "@/lib/orders/orders-service";
import { canOrderAction } from "@/lib/orders/rbac";
import { assertBlankSignatures } from "@/lib/orders/pdf-document";
import { buildSerumAntiageOeTemplateContent } from "@/lib/orders/seed-templates";
import { normalizeOrderContent } from "@/lib/orders/content";
import { validateDeliver } from "@/lib/orders/validators";
import type { OrdersActor, OeContent, OrderContent } from "@/lib/orders/types";
import {
  OrdersConflictError,
  OrdersForbiddenError,
  OrdersValidationError,
} from "@/lib/orders/types";

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
const elaboracion: OrdersActor = {
  email: "elaboracion@laboratoriogenus.com.ar",
  sector: "ELABORACION",
  displayName: "Elaboración",
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

function fillOeForDeliver(form: OrderContent): OeContent {
  if (form.kind !== "OE") {
    throw new Error("Se esperaba contenido OE");
  }
  return normalizeOrderContent({
    ...form,
    header: {
      ...form.header,
      productName: form.header.productName || "SERUM FACIAL ANTIAGE",
      date: "2026-07-20",
      quantityKg: 98,
      lot: "L26046",
      client: "THELMA Y LOUISE",
    },
    processControl: {
      ...form.processControl,
      cantidadObtenida: 96,
      fechaFin: "2026-07-20",
    },
    qualityControl: { ...form.qualityControl, resultado: "OK" },
  }) as OeContent;
}

describe("operational orders RBAC + lifecycle", () => {
  let service: OrdersService;
  let repo: MemoryOrdersRepository;

  beforeEach(() => {
    repo = new MemoryOrdersRepository();
    service = new OrdersService(repo);
  });

  it("solo Calidad/Producción crean órdenes", async () => {
    expect(canOrderAction("OE", "create", "CALIDAD")).toBe(true);
    expect(canOrderAction("OE", "create", "PRODUCCION")).toBe(true);
    expect(canOrderAction("OE", "create", "ELABORACION")).toBe(false);
    const templates = await service.listTemplates("OE");
    await expect(
      service.createOrder(
        {
          type: "OE",
          templateId: templates[0]!.id,
          assignedSector: "ELABORACION",
        },
        elaboracion
      )
    ).rejects.toBeInstanceOf(OrdersForbiddenError);
    const order = await service.createOrder(
      {
        type: "OE",
        templateId: templates[0]!.id,
        assignedSector: "ELABORACION",
        lot: "L1",
      },
      calidad
    );
    expect(order.orderNumber).toMatch(/^OE-\d{4}-\d{6}$/);
  });

  it("Elaboración edita solamente OE; Masivo/Premium solo sus OA", async () => {
    const oeT = (await service.listTemplates("OE"))[0]!;
    const oaT = (await service.listTemplates("OA"))[0]!;
    const oe = await service.createOrder(
      { type: "OE", templateId: oeT.id, assignedSector: "ELABORACION" },
      calidad
    );
    const oaMasivo = await service.createOrder(
      { type: "OA", templateId: oaT.id, assignedSector: "ENVASADO_MASIVO" },
      produccion
    );
    const oaPremium = await service.createOrder(
      { type: "OA", templateId: oaT.id, assignedSector: "ENVASADO_PREMIUM" },
      produccion
    );

    await expect(
      service.saveProgress(
        oe.id,
        { expectedVersion: oe.version, formData: oe.formData },
        elaboracion
      )
    ).resolves.toBeTruthy();

    await expect(
      service.saveProgress(
        oaPremium.id,
        { expectedVersion: oaPremium.version, formData: oaPremium.formData },
        masivo
      )
    ).rejects.toBeInstanceOf(OrdersForbiddenError);

    await expect(
      service.saveProgress(
        oaMasivo.id,
        { expectedVersion: oaMasivo.version, formData: oaMasivo.formData },
        premium
      )
    ).rejects.toBeInstanceOf(OrdersForbiddenError);
  });

  it("plantilla maestra carga y la orden conserva snapshot; cambiar maestra no altera órdenes", async () => {
    const templates = await service.listTemplates("OE");
    const order = await service.createOrder(
      {
        type: "OE",
        templateId: templates[0]!.id,
        assignedSector: "ELABORACION",
      },
      calidad
    );
    const snap = structuredClone(order.templateSnapshot);
    const filled = fillOeForDeliver(order.formData);
    filled.procedureSteps = [
      ...filled.procedureSteps,
      { id: "extra", text: "7- Paso nuevo propuesto" },
    ];
    const saved = await service.saveProgress(
      order.id,
      { expectedVersion: order.version, formData: filled },
      elaboracion
    );
    await service.saveAsMaster(saved.id, calidad, "Mejora procedimiento", true);
    const after = await service.getOrder(order.id, calidad);
    expect(after.templateSnapshot).toEqual(snap);
    expect(after.templateVersion).toBe(order.templateVersion);
    const vigentes = await service.listTemplates("OE");
    expect(vigentes[0]!.version).toBe(2);
  });

  it("guardar avance no modifica la maestra; entregar tampoco", async () => {
    const t0 = (await service.listTemplates("OE"))[0]!;
    const order = await service.createOrder(
      { type: "OE", templateId: t0.id, assignedSector: "ELABORACION" },
      calidad
    );
    const filled = fillOeForDeliver(order.formData);
    const mid = await service.saveProgress(
      order.id,
      { expectedVersion: order.version, formData: filled },
      elaboracion
    );
    const t1 = await service.getTemplate(t0.id);
    expect(t1.version).toBe(1);
    await service.deliver(mid.id, elaboracion, true);
    const t2 = await service.getTemplate(t0.id);
    expect(t2.content).toEqual(t0.content);
  });

  it("propuesta operativa requiere aprobación de Calidad/Producción", async () => {
    const t0 = (await service.listTemplates("OE"))[0]!;
    const order = await service.createOrder(
      { type: "OE", templateId: t0.id, assignedSector: "ELABORACION" },
      calidad
    );
    const filled = fillOeForDeliver(order.formData);
    filled.materials[0]!.materiaPrima = "AGUA DESMINERALIZADA";
    const mid = await service.saveProgress(
      order.id,
      { expectedVersion: order.version, formData: filled },
      elaboracion
    );
    const result = await service.saveAsMaster(mid.id, elaboracion, "Mejora nombre MP", true);
    expect(result.proposal?.status).toBe("PENDIENTE");
    expect(result.template).toBeNull();
    const decided = await service.decideProposal(
      result.proposal!.id,
      produccion,
      "APROBADA",
      "OK"
    );
    expect(decided.template?.version).toBe(2);
  });

  it("validaciones OE/OA y firmas vacías no bloquean", () => {
    const oe = buildSerumAntiageOeTemplateContent() as OeContent;
    expect(validateDeliver(oe).length).toBeGreaterThan(0);
    const filled = fillOeForDeliver(oe);
    expect(validateDeliver(filled)).toEqual([]);
    assertBlankSignatures({
      id: "x",
      orderNumber: "OE-2026-000001",
      type: "OE",
      templateId: "t",
      templateVersion: 1,
      templateSnapshot: filled,
      product: "p",
      client: "c",
      code: "",
      lot: "L",
      assignedSector: "ELABORACION",
      formulaProductId: null,
      formulaVersionId: null,
      formulaVersionHash: null,
      status: "COMPLETA",
      formData: filled,
      completionPercentage: 100,
      revision: 1,
      version: 1,
      linkedWorkItemId: null,
      reviewedAt: null,
      reviewedBy: null,
      completedAt: null,
      completedBy: null,
      createdBy: "a",
      updatedBy: "a",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  it("pendientes/completas y numeración sin duplicados", async () => {
    const t = (await service.listTemplates("OE"))[0]!;
    const a = await service.createOrder(
      { type: "OE", templateId: t.id, assignedSector: "ELABORACION" },
      calidad
    );
    const b = await service.createOrder(
      { type: "OE", templateId: t.id, assignedSector: "ELABORACION" },
      calidad
    );
    expect(a.orderNumber).not.toBe(b.orderNumber);
    const list = await service.listOrders({ type: "OE", tab: "pendientes" }, calidad);
    expect(list.pendingCount).toBe(2);
    const filled = fillOeForDeliver(a.formData);
    const mid = await service.saveProgress(
      a.id,
      { expectedVersion: a.version, formData: filled },
      elaboracion
    );
    await service.deliver(mid.id, elaboracion, true);
    const after = await service.listOrders({ type: "OE" }, calidad);
    expect(after.completeCount).toBe(1);
    expect(after.pendingCount).toBe(1);
  });

  it("devolver para corrección conserva versión y notifica", async () => {
    const t = (await service.listTemplates("OE"))[0]!;
    const order = await service.createOrder(
      { type: "OE", templateId: t.id, assignedSector: "ELABORACION" },
      calidad
    );
    const filled = fillOeForDeliver(order.formData);
    const mid = await service.saveProgress(
      order.id,
      { expectedVersion: order.version, formData: filled },
      elaboracion
    );
    const done = await service.deliver(mid.id, elaboracion, true);
    const returned = await service.returnForCorrection(done.id, calidad, "Corregir pH");
    expect(returned.status).toBe("DEVUELTA_PARA_CORRECCION");
    expect(returned.revision).toBe(done.revision + 1);
    const versions = await repo.listOrderVersions(done.id);
    expect(versions.some((v) => v.event === "return_keep_delivered")).toBe(true);
    const notifs = await service.listNotifications(calidad);
    expect(notifs.some((n) => n.kind === "oe_completada" || n.kind === "order_returned")).toBe(
      true
    );
  });

  it("conflicto de edición y actorSector ausente/rechazo no muta", async () => {
    const t = (await service.listTemplates("OE"))[0]!;
    const order = await service.createOrder(
      { type: "OE", templateId: t.id, assignedSector: "ELABORACION" },
      calidad
    );
    await expect(
      service.saveProgress(
        order.id,
        { expectedVersion: 999, formData: order.formData },
        elaboracion
      )
    ).rejects.toBeInstanceOf(OrdersConflictError);
    const untouched = await service.getOrder(order.id, calidad);
    expect(untouched.version).toBe(1);

    await expect(
      service.deliver(order.id, elaboracion, false)
    ).rejects.toBeInstanceOf(OrdersValidationError);
    expect((await service.getOrder(order.id, calidad)).status).toBe("PENDIENTE");

    expect(canOrderAction("OA", "edit_codificado", "CODIFICADO")).toBe(true);
    expect(canOrderAction("OA", "deliver", "CODIFICADO")).toBe(false);
    expect(canOrderAction("OE", "edit", "CODIFICADO")).toBe(false);
    void codificado;
  });

  it("diseño legal OE seed conserva título y firmas vacías", () => {
    const content = buildSerumAntiageOeTemplateContent() as OeContent;
    expect(content.title).toBe("OE");
    expect(content.procedureTitle).toBe("PROCEDIMIENTO DE ELABORACIÓN");
    expect(Object.values(content.signatures).every((s) => s === null)).toBe(true);
  });
});
