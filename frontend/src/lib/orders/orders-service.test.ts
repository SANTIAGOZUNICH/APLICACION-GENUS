import { describe, expect, it, beforeEach } from "vitest";
import { MemoryOrdersRepository } from "@/lib/orders/memory-repository";
import { OrdersService } from "@/lib/orders/orders-service";
import { canDeleteOa, canOrderAction } from "@/lib/orders/rbac";
import { assertBlankSignatures } from "@/lib/orders/pdf-document";
import { buildSerumAntiageOeTemplateContent } from "@/lib/orders/seed-templates";
import { normalizeOrderContent } from "@/lib/orders/content";
import { classifyDeliverMissing, validateDeliver } from "@/lib/orders/validators";
import type { OrdersActor, OeContent, OrderContent } from "@/lib/orders/types";
import { ampleTestLots, fillMaterialsForConsumption, seedMpStockForTests } from "@/lib/orders/oe-mp-test-fixture";
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
    // Consumo real cargado por Elaboración (código de Stock MP, lote y kg reales): sin esto no se entrega.
    materials: fillMaterialsForConsumption(form.materials),
  }) as OeContent;
}

describe("operational orders RBAC + lifecycle", () => {
  let service: OrdersService;
  let repo: MemoryOrdersRepository;

  beforeEach(async () => {
    await seedMpStockForTests(ampleTestLots());
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

  it(
    "guardar avance no modifica la maestra; entregar tampoco",
    async () => {
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
    },
    30000
  );
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
      deletedAt: null,
      deletedBy: null,
      deleteReason: null,
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
    // Circuito sin Calidad: el aviso operativo de OE completada/devuelta va a Producción, ya no a Calidad.
    const notifs = await service.listNotifications(produccion);
    expect(notifs.some((n) => n.kind === "oe_completada" || n.kind === "order_returned")).toBe(
      true
    );
    const calidadNotifs = await service.listNotifications(calidad);
    expect(
      calidadNotifs.some((n) => n.kind === "oe_completada" || n.kind === "order_returned")
    ).toBe(false);
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

  it("anular OE acepta motivo vacío (Sin motivo informado), es idempotente y RBAC bloquea sectores no autorizados", async () => {
    const t = (await service.listTemplates("OE"))[0]!;
    const order = await service.createOrder(
      { type: "OE", templateId: t.id, assignedSector: "ELABORACION" },
      calidad
    );
    const filled = fillOeForDeliver(order.formData);
    const saved = await service.saveProgress(
      order.id,
      { expectedVersion: order.version, formData: filled },
      elaboracion
    );
    const delivered = await service.deliver(order.id, elaboracion, true);
    expect(
      delivered.status === "COMPLETA" || delivered.status === "COMPLETA_CON_PENDIENTES"
    ).toBe(true);

    await expect(service.annul(order.id, elaboracion, "x")).rejects.toBeInstanceOf(
      OrdersForbiddenError
    );

    const annulled = await service.annul(order.id, produccion, "");
    expect(annulled.status).toBe("ANULADA");
    const again = await service.annul(order.id, produccion, "segundo intento");
    expect(again.status).toBe("ANULADA");
    void saved;
  });

  it("completar OE con observación opcional la persiste con autor y fecha", async () => {
    const t = (await service.listTemplates("OE"))[0]!;
    const order = await service.createOrder(
      { type: "OE", templateId: t.id, assignedSector: "ELABORACION" },
      calidad
    );
    const filled = fillOeForDeliver(order.formData);
    const saved = await service.saveProgress(
      order.id,
      { expectedVersion: order.version, formData: filled },
      elaboracion
    );
    const done = await service.deliver(saved.id, elaboracion, true, {
      observation: "  Mezcla más densa de lo habitual  ",
    });
    expect(done.formData.kind).toBe("OE");
    if (done.formData.kind !== "OE") return;
    expect(done.formData.deliveryObservation).toBe("Mezcla más densa de lo habitual");
    expect(done.formData.deliveryObservationBy).toBe(elaboracion.email);
    expect(done.formData.deliveryObservationAt).toBeTruthy();

    const reloaded = await service.getOrder(done.id, calidad);
    expect(reloaded.formData.kind).toBe("OE");
    if (reloaded.formData.kind !== "OE") return;
    expect(reloaded.formData.deliveryObservation).toBe("Mezcla más densa de lo habitual");
    expect(reloaded.formData.deliveryObservationBy).toBe(elaboracion.email);
  });

  it("completar OE sin observación guarda null y no muestra texto vacío", async () => {
    const t = (await service.listTemplates("OE"))[0]!;
    const order = await service.createOrder(
      { type: "OE", templateId: t.id, assignedSector: "ELABORACION" },
      calidad
    );
    const filled = fillOeForDeliver(order.formData);
    const saved = await service.saveProgress(
      order.id,
      { expectedVersion: order.version, formData: filled },
      elaboracion
    );
    const done = await service.deliver(saved.id, elaboracion, true, {
      observation: "   ",
    });
    expect(done.formData.kind).toBe("OE");
    if (done.formData.kind !== "OE") return;
    expect(done.formData.deliveryObservation).toBeNull();
    expect(done.formData.deliveryObservationBy).toBeNull();
    expect(done.formData.deliveryObservationAt).toBeNull();

    const again = await service.getOrder(done.id, produccion);
    expect(again.formData.kind).toBe("OE");
    if (again.formData.kind !== "OE") return;
    expect(again.formData.deliveryObservation).toBeNull();
  });

  it("no sobrescribe una observación de entrega OE ya persistida", async () => {
    const t = (await service.listTemplates("OE"))[0]!;
    const order = await service.createOrder(
      { type: "OE", templateId: t.id, assignedSector: "ELABORACION" },
      calidad
    );
    const filled = fillOeForDeliver(order.formData);
    const saved = await service.saveProgress(
      order.id,
      { expectedVersion: order.version, formData: filled },
      elaboracion
    );
    const first = await service.deliver(saved.id, elaboracion, true, {
      observation: "Original de elaboración",
    });
    expect(first.formData.kind).toBe("OE");
    if (first.formData.kind !== "OE") return;
    expect(first.formData.deliveryObservation).toBe("Original de elaboración");

    const returned = await service.returnForCorrection(
      first.id,
      calidad,
      "reabrir para prueba"
    );
    expect(returned.status).toBe("DEVUELTA_PARA_CORRECCION");

    const second = await service.deliver(returned.id, elaboracion, true, {
      observation: "Intento de sobrescribir",
    });
    expect(second.formData.kind).toBe("OE");
    if (second.formData.kind !== "OE") return;
    expect(second.formData.deliveryObservation).toBe("Original de elaboración");
    expect(second.formData.deliveryObservationBy).toBe(elaboracion.email);
  });
});

describe("deleteOa — eliminación manual de OA (soft-delete/tombstone)", () => {
  let service: OrdersService;
  let repo: MemoryOrdersRepository;

  beforeEach(() => {
    repo = new MemoryOrdersRepository();
    service = new OrdersService(repo);
  });

  async function makeOa(actor: OrdersActor = calidad) {
    const oaT = (await service.listTemplates("OA"))[0]!;
    return service.createOrder(
      { type: "OA", templateId: oaT.id, assignedSector: "ENVASADO_MASIVO" },
      actor
    );
  }

  it("Calidad ve permitido eliminar OA (test obligatorio #7)", () => {
    expect(canDeleteOa("CALIDAD")).toBe(true);
    expect(canDeleteOa("PRODUCCION")).toBe(true);
    expect(canDeleteOa("DIRECCION")).toBe(true);
  });

  it("un sector operativo no autorizado no puede eliminar (test obligatorio #8)", () => {
    expect(canDeleteOa("ENVASADO_MASIVO")).toBe(false);
    expect(canDeleteOa("CODIFICADO")).toBe(false);
    expect(canDeleteOa("ELABORACION")).toBe(false);
  });

  it("la API/servicio rechaza a un actor sin permiso, aunque el sector no viera el botón (test obligatorio #9)", async () => {
    const oa = await makeOa();
    await expect(service.deleteOa(oa.id, masivo, "Duplicado")).rejects.toBeInstanceOf(
      OrdersForbiddenError
    );
    const stillThere = await repo.getOrder(oa.id);
    expect(stillThere?.deletedAt).toBeNull();
  });

  it("el motivo es opcional: eliminar sin motivo funciona y registra usuario/fecha", async () => {
    const oa = await makeOa();
    const deleted = await service.deleteOa(oa.id, produccion, "");
    expect(deleted.deletedAt).not.toBeNull();
    expect(deleted.deletedBy).toBe(produccion.email);
    const event = repo.audits.find((a) => a.orderId === oa.id && a.eventType === "ORDER_OA_DELETED");
    expect(event?.actor).toBe(produccion.email);
  });

  it("duplicado sin relaciones: elimina la OA candidata y conserva la OA correcta (test obligatorio #1, #11)", async () => {
    const keeper = await makeOa(produccion);
    const candidate = await makeOa(calidad);

    const deleted = await service.deleteOa(candidate.id, calidad, "Duplicado — mismo lote y producto");
    expect(deleted.deletedAt).not.toBeNull();
    expect(deleted.deletedBy).toBe(calidad.email);
    expect(deleted.deleteReason).toBe("Duplicado — mismo lote y producto");

    // Segunda lectura: la correcta sigue existiendo intacta, la duplicada ya no aparece activa.
    const keeperAfter = await repo.getOrder(keeper.id);
    expect(keeperAfter).not.toBeNull();
    expect(keeperAfter?.deletedAt).toBeNull();
    expect(keeperAfter?.status).toBe(keeper.status);

    const candidateAfter = await repo.getOrder(candidate.id);
    expect(candidateAfter?.deletedAt).not.toBeNull();

    const listed = await service.listOrders({ type: "OA" }, calidad);
    expect(listed.items.map((o) => o.id)).toContain(keeper.id);
    expect(listed.items.map((o) => o.id)).not.toContain(candidate.id);
  });

  it("eliminación deja audit trail (test obligatorio #10)", async () => {
    const oa = await makeOa();
    await service.deleteOa(oa.id, calidad, "Duplicado de prueba");
    const event = repo.audits.find(
      (a) => a.orderId === oa.id && a.eventType === "ORDER_OA_DELETED"
    );
    expect(event).toBeTruthy();
    expect(event?.actor).toBe(calidad.email);
    expect(event?.actorSector).toBe("CALIDAD");
    expect((event?.metadata as { reason?: string })?.reason).toBe("Duplicado de prueba");
  });

  // REGLA NUEVA (reemplaza los bloqueos anteriores): Calidad puede eliminar
  // CUALQUIER OA que elija — vacía, completa, con lote/VTO, con cantidad/
  // operarios, vinculada a un trabajo, entregada, con decisión de Calidad,
  // anulada — sin que el servidor la rechace por contenido ni relaciones.
  // El soft-delete nunca toca el work_item/pedido/remito/entrega/historial
  // de Calidad vinculados: la OA simplemente deja de listarse activa.

  it("Calidad elimina una OA vacía (test obligatorio #1)", async () => {
    const oa = await makeOa();
    const deleted = await service.deleteOa(oa.id, calidad, "Duplicada — se conserva OA-2026-000150");
    expect(deleted.deletedAt).not.toBeNull();
  });

  it("una OA COMPLETA con producción cargada se conserva: no se elimina (nada pendiente para cancelar)", async () => {
    const oa = await makeOa();
    const withData = {
      ...(await repo.getOrder(oa.id))!,
      status: "COMPLETA" as const,
      lot: "G26080",
      client: "SC Beauty",
      product: "SERUM CAPIXYL",
      formData: {
        ...oa.formData,
        header: { ...oa.formData.header, vto: "08/2028" },
        rendimientos: { ...oa.formData.rendimientos, cantidadUnidades: 1000 },
        envasado: { ...oa.formData.envasado, operarios: "Belén, Joaquín" },
      },
    };
    repo.orders.set(oa.id, withData);

    await expect(service.deleteOa(oa.id, calidad, "")).rejects.toBeInstanceOf(OrdersValidationError);
    const after = await repo.getOrder(oa.id);
    expect(after?.deletedAt).toBeNull();
    expect(after?.status).toBe("COMPLETA");
    expect(after?.lot).toBe("G26080");
  });

  it("OA con decisión de Calidad se conserva; OA en curso con entregas se cancela solo lo pendiente (ANULADA) sin borrarla", async () => {
    const q = await makeOa();
    repo.oaReferences.set(q.id, { activeWorkItemCount: 1, activeDeliveryCount: 2, hasQualityDecision: true });
    await expect(service.deleteOa(q.id, produccion, "")).rejects.toBeInstanceOf(OrdersValidationError);

    const oa = await makeOa();
    repo.oaReferences.set(oa.id, { activeWorkItemCount: 1, activeDeliveryCount: 2, hasQualityDecision: false });
    const res = await service.deleteOa(oa.id, produccion, "");
    expect(res.deletedAt).toBeNull();
    expect(res.status).toBe("ANULADA");
    const event = repo.audits.find((a) => a.orderId === oa.id && a.eventType === "ORDER_OA_CANCELLED_SAFE");
    expect(event).toBeTruthy();
    expect((event?.metadata as { hadActiveDeliveries?: number }).hadActiveDeliveries).toBe(2);
    // idempotente
    await expect(service.deleteOa(oa.id, produccion, "")).resolves.toMatchObject({ status: "ANULADA" });
  });

  it("Calidad elimina una OA ANULADA — el soft-delete no destruye nada, solo la retira del listado activo", async () => {
    const oa = await makeOa();
    const withStatus = { ...(await repo.getOrder(oa.id))!, status: "ANULADA" as const };
    repo.orders.set(oa.id, withStatus);
    const deleted = await service.deleteOa(oa.id, calidad, "Duplicada, ya estaba anulada");
    expect(deleted.deletedAt).not.toBeNull();
    expect(deleted.status).toBe("ANULADA");
  });

  it("Producción y Dirección conservan el mismo permiso que Calidad", async () => {
    const oaProd = await makeOa();
    await expect(service.deleteOa(oaProd.id, produccion, "Motivo")).resolves.toMatchObject({
      deletedAt: expect.any(String),
    });
  });

  it("es idempotente: eliminar una OA ya eliminada no falla ni la vuelve a auditar", async () => {
    const oa = await makeOa();
    await service.deleteOa(oa.id, calidad, "Duplicado");
    const auditCountAfterFirst = repo.audits.filter((a) => a.orderId === oa.id).length;
    const result = await service.deleteOa(oa.id, calidad, "Duplicado de nuevo");
    expect(result.deletedAt).not.toBeNull();
    const auditCountAfterSecond = repo.audits.filter((a) => a.orderId === oa.id).length;
    expect(auditCountAfterSecond).toBe(auditCountAfterFirst);
  });

  it("una OA eliminada deja de aparecer en el listado normal, pero sigue existiendo en la DB para auditoría (test obligatorio #8, #9)", async () => {
    const oa = await makeOa();
    await service.deleteOa(oa.id, calidad, "Duplicada de prueba");

    const normalList = await service.listOrders({ type: "OA" }, calidad);
    expect(normalList.items.map((o) => o.id)).not.toContain(oa.id);

    const stillInDb = await repo.getOrder(oa.id);
    expect(stillInDb).not.toBeNull();
    expect(stillInDb?.deletedAt).not.toBeNull();
    expect(stillInDb?.deleteReason).toBe("Duplicada de prueba");
  });

  it("Ver eliminadas (includeDeleted) solo funciona para sectores con permiso de eliminar OA — otros sectores se ignoran en silencio", async () => {
    const oa = await makeOa();
    await service.deleteOa(oa.id, calidad, "Duplicada de prueba");

    const asCalidad = await service.listOrders({ type: "OA", includeDeleted: true }, calidad);
    expect(asCalidad.items.map((o) => o.id)).toContain(oa.id);

    const asMasivo = await service.listOrders({ type: "OA", includeDeleted: true }, masivo);
    expect(asMasivo.items.map((o) => o.id)).not.toContain(oa.id);
  });

  it("no aplica a OE — deleteOa es exclusivo de OA", async () => {
    const oeT = (await service.listTemplates("OE"))[0]!;
    const oe = await service.createOrder(
      { type: "OE", templateId: oeT.id, assignedSector: "ELABORACION" },
      calidad
    );
    await expect(service.deleteOa(oe.id, calidad, "motivo")).rejects.toBeInstanceOf(
      OrdersValidationError
    );
  });
});

describe("notificaciones dismiss por usuario", () => {
  let service: OrdersService;
  let repo: MemoryOrdersRepository;

  beforeEach(() => {
    repo = new MemoryOrdersRepository();
    service = new OrdersService(repo);
  });

  it("dismiss solo oculta para el actor que descartó", async () => {
    await repo.insertNotification({
      id: "ntf-shared",
      kind: "order_created",
      title: "Orden nueva",
      message: "OE creada",
      sectors: ["CALIDAD", "PRODUCCION"],
      href: null,
      orderId: null,
      readBy: [],
      dismissedBy: [],
      deletedBy: [],
      createdAt: new Date().toISOString(),
    });

    await service.dismissNotification("ntf-shared", calidad);

    expect(await service.listNotifications(calidad)).toHaveLength(0);
    expect(await service.listNotifications(produccion)).toHaveLength(1);

    const archived = await service.listNotifications(calidad, { includeDismissed: true });
    expect(archived).toHaveLength(1);
    expect(archived[0]!.dismissedBy).toContain(calidad.email);

    await service.restoreNotification("ntf-shared", calidad);
    expect(await service.listNotifications(calidad)).toHaveLength(1);
  });
});

describe("OE: completar con datos secundarios pendientes", () => {
  let service: OrdersService;

  beforeEach(async () => {
    await seedMpStockForTests(ampleTestLots());
    service = new OrdersService(new MemoryOrdersRepository());
  });

  async function oeWith(mutate: (f: OeContent) => OeContent) {
    const t = (await service.listTemplates("OE"))[0]!;
    const order = await service.createOrder({ type: "OE", templateId: t.id, assignedSector: "ELABORACION" }, calidad);
    const filled = mutate(fillOeForDeliver(order.formData));
    return service.saveProgress(order.id, { expectedVersion: order.version, formData: filled }, elaboracion);
  }

  it("classifyDeliverMissing separa dispensables de críticos", () => {
    const base = fillOeForDeliver(buildSerumAntiageOeTemplateContent());
    expect(classifyDeliverMissing(base)).toEqual({ critical: [], secondary: [] });
    const sinFin = { ...base, processControl: { ...base.processControl, fechaFin: "" } } as OeContent;
    const c = classifyDeliverMissing(sinFin);
    expect(c.critical).toEqual([]);
    expect(c.secondary).toContain("Fecha de finalización");
    const sinLote = { ...base, header: { ...base.header, lot: "" } } as OeContent;
    expect(classifyDeliverMissing(sinLote).critical.length).toBeGreaterThan(0);
  });

  it("completa con COMPLETA + registro de pendientes, y no permite omitir datos críticos", async () => {
    const crit = await oeWith((f) => ({ ...f, header: { ...f.header, lot: "" } }) as OeContent);
    await expect(service.deliver(crit.id, elaboracion, true, { allowIncomplete: true })).rejects.toBeInstanceOf(OrdersValidationError);

    const sec = await oeWith((f) => ({ ...f, processControl: { ...f.processControl, fechaFin: "" } }) as OeContent);
    const done = await service.deliver(sec.id, elaboracion, true, { allowIncomplete: true });
    expect(done.status).toBe("COMPLETA");
    const fd = done.formData as OeContent;
    expect(fd.completion?.confirmedBy).toBe(elaboracion.email);
    expect(fd.completion?.pendingAtCompletion).toContain("Fecha de finalización");
  });

  it("completePendingFields completa después sin reabrir ni duplicar y deja registro", async () => {
    const sec = await oeWith((f) => ({ ...f, processControl: { ...f.processControl, fechaFin: "" } }) as OeContent);
    const done = await service.deliver(sec.id, elaboracion, true, { allowIncomplete: true });
    const late = await service.completePendingFields(done.id, elaboracion, { fechaFin: "2026-07-21" });
    expect(late.status).toBe("COMPLETA");
    const fd = late.formData as OeContent;
    expect(fd.processControl.fechaFin).toBe("2026-07-21");
    expect(fd.completion?.resolved.map((r) => r.field)).toContain("Fecha de finalización");
    // No pisa lo ya cargado.
    await expect(service.completePendingFields(done.id, elaboracion, { fechaFin: "2026-08-01" })).rejects.toBeInstanceOf(OrdersValidationError);
    expect(((await service.getOrder(done.id, calidad))?.formData as OeContent).processControl.fechaFin).toBe("2026-07-21");
  });
});
