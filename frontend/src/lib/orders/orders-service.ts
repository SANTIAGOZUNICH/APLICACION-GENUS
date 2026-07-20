import { randomUUID } from "node:crypto";
import {
  cloneContent,
  computeCompletionPercentage,
  createEmptyOaContent,
  createEmptyOeContent,
  mergeFormOverrides,
  normalizeOrderContent,
  summarizeContentDiff,
} from "@/lib/orders/content";
import type { OrdersRepository } from "@/lib/orders/repository";
import { assertCanAccessAssignedOrder, assertCanOrderAction } from "@/lib/orders/rbac";
import { seedTemplateRecords } from "@/lib/orders/seed-templates";
import type {
  CreateOrderInput,
  CreateTemplateInput,
  DuplicateTemplateInput,
  ListOrdersFilters,
  OperationalOrderRecord,
  OrderContent,
  OrderDocType,
  OrderTemplateRecord,
  OrdersActor,
  OsNotificationRecord,
  PatchOrderInput,
  TemplateChangeProposalRecord,
} from "@/lib/orders/types";
import {
  OrdersConflictError,
  OrdersForbiddenError,
  OrdersNotFoundError,
  OrdersValidationError,
} from "@/lib/orders/types";
import { assertDeliverable, assertOrderTypeMatch } from "@/lib/orders/validators";

function nowIso(): string {
  return new Date().toISOString();
}

function slugifyProductId(name: string, code: string): string {
  const base = `${name}-${code}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return base || `producto-${randomUUID().slice(0, 8)}`;
}

function notify(
  repo: OrdersRepository,
  input: Omit<OsNotificationRecord, "id" | "readBy" | "dismissedBy" | "createdAt">
): Promise<OsNotificationRecord> {
  return repo.insertNotification({
    id: randomUUID(),
    ...input,
    readBy: [],
    dismissedBy: [],
    createdAt: nowIso(),
  });
}

export class OrdersService {
  constructor(private readonly repo: OrdersRepository) {}

  listTemplates(type?: OrderDocType) {
    return this.repo.listTemplates(type);
  }

  async listAllTemplates(type?: OrderDocType) {
    if (this.repo.listAllTemplates) return this.repo.listAllTemplates(type);
    return this.repo.listTemplates(type);
  }

  async listTemplateHistory(productId: string, type: OrderDocType) {
    if (this.repo.listTemplateHistory) {
      return this.repo.listTemplateHistory(productId, type);
    }
    const all = await this.listAllTemplates(type);
    return all
      .filter((t) => t.productId === productId)
      .sort((a, b) => b.version - a.version);
  }

  async getTemplate(id: string) {
    const t = await this.repo.getTemplate(id);
    if (!t) throw new OrdersNotFoundError("Plantilla no encontrada.");
    return t;
  }

  /** Importa plantillas de referencia seed sin duplicar. */
  async importSeedTemplates(actor: OrdersActor, type?: OrderDocType) {
    assertCanOrderAction(type ?? "OE", "manage_templates", actor);
    if (!type) {
      assertCanOrderAction("OA", "manage_templates", actor);
    }
    if (this.repo.ensureSeed) {
      await this.repo.ensureSeed();
    } else {
      for (const t of seedTemplateRecords()) {
        if (type && t.type !== type) continue;
        const existing = await this.repo.getVigenteTemplate(t.productId, t.type);
        if (!existing) {
          const byId = await this.repo.getTemplate(t.id);
          if (!byId) await this.repo.insertTemplate(t);
        }
      }
    }
    return this.listTemplates(type);
  }

  async createTemplate(input: CreateTemplateInput, actor: OrdersActor) {
    assertCanOrderAction(input.type, "manage_templates", actor);
    const productName = input.productName.trim();
    const productCode = input.productCode.trim();
    if (!productName) throw new OrdersValidationError("El nombre de producto es obligatorio.");
    if (!productCode) throw new OrdersValidationError("El código de producto es obligatorio.");
    const productId =
      input.productId?.trim() || slugifyProductId(productName, productCode);
    const existing = await this.repo.getVigenteTemplate(productId, input.type);
    if (existing) {
      throw new OrdersValidationError(
        "Ya existe una plantilla vigente para este producto. Duplicá o creá una nueva versión."
      );
    }
    const content =
      input.content ??
      (input.type === "OE"
        ? createEmptyOeContent({ productName, code: productCode })
        : createEmptyOaContent({ productName, productCode }));
    const ts = nowIso();
    const reason =
      input.changeReason?.trim() ||
      (input.sourceFile
        ? `Plantilla nueva — origen: ${input.sourceFile}`
        : "Plantilla maestra nueva (sin archivo)");
    const template: OrderTemplateRecord = {
      id: randomUUID(),
      type: input.type,
      productId,
      productName,
      productCode,
      brandClient: input.brandClient?.trim() || null,
      version: 1,
      status: "VIGENTE",
      content: normalizeOrderContent(content),
      changeReason: reason,
      sourceFile: input.sourceFile ?? null,
      previousVersionId: null,
      createdBy: actor.email,
      updatedBy: actor.email,
      createdAt: ts,
      updatedAt: ts,
    };
    const saved = await this.repo.insertTemplate(template);
    await this.repo.appendAudit({
      orderId: null,
      eventType: "TEMPLATE_CREATED",
      actor: actor.email,
      actorSector: actor.sector,
      metadata: {
        templateId: saved.id,
        type: saved.type,
        productId: saved.productId,
        sourceFile: saved.sourceFile ?? null,
      },
    });
    return saved;
  }

  async duplicateTemplate(input: DuplicateTemplateInput, actor: OrdersActor) {
    const source = await this.getTemplate(input.templateId);
    assertCanOrderAction(source.type, "manage_templates", actor);
    const productName = (input.productName ?? `${source.productName} (copia)`).trim();
    const productCode = (input.productCode ?? `${source.productCode}-COPY`).trim();
    const productId = slugifyProductId(productName, productCode);
    return this.createTemplate(
      {
        type: source.type,
        productName,
        productCode,
        productId,
        brandClient: input.brandClient ?? source.brandClient,
        content: cloneContent(source.content),
        changeReason:
          input.changeReason?.trim() ||
          `Duplicada desde ${source.productName} v${source.version}`,
        sourceFile: source.sourceFile ?? null,
      },
      actor
    );
  }

  async createTemplateVersion(
    templateId: string,
    actor: OrdersActor,
    changeReason: string,
    content?: OrderContent
  ) {
    const current = await this.getTemplate(templateId);
    assertCanOrderAction(current.type, "manage_templates", actor);
    if (!changeReason.trim()) {
      throw new OrdersValidationError("Motivo de modificación obligatorio.");
    }
    if (current.status !== "VIGENTE") {
      throw new OrdersValidationError("Solo se puede versionar la plantilla vigente.");
    }
    await this.repo.markTemplateObsolete(current.id);
    const ts = nowIso();
    const next: OrderTemplateRecord = {
      id: randomUUID(),
      type: current.type,
      productId: current.productId,
      productName: current.productName,
      productCode: current.productCode,
      brandClient: current.brandClient,
      version: current.version + 1,
      status: "VIGENTE",
      content: normalizeOrderContent(content ?? current.content),
      changeReason: changeReason.trim(),
      sourceFile: current.sourceFile ?? null,
      previousVersionId: current.id,
      createdBy: actor.email,
      updatedBy: actor.email,
      createdAt: ts,
      updatedAt: ts,
    };
    const saved = await this.repo.insertTemplate(next);
    await this.repo.appendAudit({
      orderId: null,
      eventType: "TEMPLATE_VERSION_CREATED",
      actor: actor.email,
      actorSector: actor.sector,
      metadata: {
        previousTemplateId: current.id,
        newTemplateId: saved.id,
        version: saved.version,
      },
    });
    return saved;
  }

  async markTemplateObsoleteManaged(templateId: string, actor: OrdersActor) {
    const current = await this.getTemplate(templateId);
    assertCanOrderAction(current.type, "manage_templates", actor);
    await this.repo.markTemplateObsolete(templateId);
    await this.repo.appendAudit({
      orderId: null,
      eventType: "TEMPLATE_MARKED_OBSOLETE",
      actor: actor.email,
      actorSector: actor.sector,
      metadata: { templateId, productId: current.productId, version: current.version },
    });
    return { ...current, status: "OBSOLETA" as const };
  }

  async updateTemplate(
    templateId: string,
    actor: OrdersActor,
    patch: {
      content?: OrderContent;
      productName?: string;
      productCode?: string;
      brandClient?: string | null;
      changeReason?: string;
    }
  ) {
    const current = await this.getTemplate(templateId);
    assertCanOrderAction(current.type, "manage_templates", actor);
    if (current.status !== "VIGENTE") {
      throw new OrdersValidationError(
        "No se puede editar una plantilla obsoleta. Creá una nueva versión."
      );
    }
    if (!this.repo.updateTemplateContent) {
      throw new OrdersValidationError("Actualización de plantilla no disponible.");
    }
    const updated = await this.repo.updateTemplateContent(templateId, {
      content: patch.content ? normalizeOrderContent(patch.content) : undefined,
      productName: patch.productName?.trim(),
      productCode: patch.productCode?.trim(),
      brandClient: patch.brandClient,
      changeReason: patch.changeReason?.trim(),
      updatedBy: actor.email,
    });
    if (!updated) throw new OrdersNotFoundError("Plantilla no encontrada.");
    await this.repo.appendAudit({
      orderId: null,
      eventType: "TEMPLATE_EDITED",
      actor: actor.email,
      actorSector: actor.sector,
      metadata: { templateId, version: updated.version },
    });
    return updated;
  }

  async createOrder(input: CreateOrderInput, actor: OrdersActor) {
    assertCanOrderAction(input.type, "create", actor);
    const template = await this.repo.getTemplate(input.templateId);
    if (!template || template.status !== "VIGENTE") {
      throw new OrdersNotFoundError("Plantilla maestra vigente no encontrada.");
    }
    if (template.type !== input.type) {
      throw new OrdersValidationError("El tipo de plantilla no coincide con la orden.");
    }
    if (input.type === "OE" && input.assignedSector !== "ELABORACION") {
      throw new OrdersValidationError("Las OE deben asignarse a ELABORACION.");
    }
    if (
      input.type === "OA" &&
      input.assignedSector !== "ENVASADO_MASIVO" &&
      input.assignedSector !== "ENVASADO_PREMIUM"
    ) {
      throw new OrdersValidationError(
        "Las OA deben asignarse a ENVASADO_MASIVO o ENVASADO_PREMIUM."
      );
    }

    const snapshot = cloneContent(template.content);
    const formData = mergeFormOverrides(snapshot, input.formOverrides);
    if (formData.kind === "OE") {
      if (input.product) formData.header.productName = input.product;
      if (input.client) formData.header.client = input.client;
      if (input.code) formData.header.code = input.code;
      if (input.lot) formData.header.lot = input.lot;
    } else {
      if (input.product) formData.header.productName = input.product;
      if (input.client) formData.header.client = input.client;
      if (input.code) formData.header.productCode = input.code;
      if (input.lot) formData.header.lot = input.lot;
    }
    const normalized = normalizeOrderContent(formData);
    const year = new Date().getFullYear();
    const orderNumber = await this.repo.nextOrderNumber(input.type, year);
    const ts = nowIso();
    const order: OperationalOrderRecord = {
      id: randomUUID(),
      orderNumber,
      type: input.type,
      templateId: template.id,
      templateVersion: template.version,
      templateSnapshot: snapshot,
      product:
        input.product ??
        (normalized.kind === "OE"
          ? normalized.header.productName
          : normalized.header.productName),
      client:
        input.client ??
        (normalized.kind === "OE" ? normalized.header.client : normalized.header.client),
      code:
        input.code ??
        (normalized.kind === "OE"
          ? normalized.header.code
          : normalized.header.productCode),
      lot:
        input.lot ??
        (normalized.kind === "OE" ? normalized.header.lot : normalized.header.lot),
      assignedSector: input.assignedSector,
      status: "PENDIENTE",
      formData: normalized,
      completionPercentage: computeCompletionPercentage(normalized),
      revision: 1,
      version: 1,
      linkedWorkItemId: input.linkedWorkItemId ?? null,
      reviewedAt: null,
      reviewedBy: null,
      completedAt: null,
      completedBy: null,
      createdBy: actor.email,
      updatedBy: actor.email,
      createdAt: ts,
      updatedAt: ts,
    };
    const saved = await this.repo.insertOrder(order);
    await this.repo.insertOrderVersion({
      id: randomUUID(),
      orderId: saved.id,
      version: 1,
      snapshot: saved,
      event: "create",
      reason: null,
      createdBy: actor.email,
      createdAt: ts,
    });
    await this.repo.appendAudit({
      orderId: saved.id,
      eventType: "ORDER_CREATED",
      actor: actor.email,
      actorSector: actor.sector,
      metadata: {
        orderNumber: saved.orderNumber,
        templateId: template.id,
        templateVersion: template.version,
        snapshotTaken: true,
      },
    });
    return saved;
  }

  async listOrders(filters: ListOrdersFilters, actor: OrdersActor) {
    if (!actor.sector) throw new OrdersValidationError("Falta actorSectorId.");
    const type = filters.type;
    if (type) assertCanOrderAction(type, "view", actor);
    const scoped = { ...filters };
    if (actor.sector === "ENVASADO_MASIVO" || actor.sector === "ENVASADO_PREMIUM") {
      scoped.type = "OA";
      scoped.assignedSector = actor.sector;
    }
    if (actor.sector === "ELABORACION") {
      scoped.type = scoped.type ?? "OE";
    }
    return this.repo.listOrders(scoped);
  }

  async getOrder(id: string, actor: OrdersActor) {
    const order = await this.repo.getOrder(id);
    if (!order) throw new OrdersNotFoundError("Orden no encontrada.");
    assertCanAccessAssignedOrder(order.type, order.assignedSector, actor, "view");
    return order;
  }

  async saveProgress(id: string, input: PatchOrderInput, actor: OrdersActor) {
    const current = await this.repo.getOrder(id);
    if (!current) throw new OrdersNotFoundError("Orden no encontrada.");
    if (current.status === "COMPLETA" || current.status === "ARCHIVADA") {
      throw new OrdersForbiddenError(
        "Una orden completa no se edita directamente. Debe devolverse para corrección."
      );
    }
    if (current.status === "ANULADA") {
      throw new OrdersForbiddenError("La orden está anulada.");
    }

    const isCodificadoOnly =
      actor.sector === "CODIFICADO" && current.type === "OA";
    if (isCodificadoOnly) {
      assertCanOrderAction("OA", "edit_codificado", actor);
    } else {
      assertCanAccessAssignedOrder(
        current.type,
        current.assignedSector,
        actor,
        "save_progress"
      );
    }

    assertOrderTypeMatch(current.type, input.formData);
    let nextForm = normalizeOrderContent(input.formData);
    if (isCodificadoOnly && current.formData.kind === "OA" && nextForm.kind === "OA") {
      // Solo permite mutar campos de codificado
      nextForm = {
        ...current.formData,
        etiquetadoCodificado: nextForm.etiquetadoCodificado,
        etiquetadoCodificadoLegalText: current.formData.etiquetadoCodificadoLegalText,
      };
    }

    const updated = await this.repo.updateOrderOptimistic(id, input.expectedVersion, {
      formData: nextForm,
      completionPercentage: computeCompletionPercentage(nextForm),
      status: current.status === "PENDIENTE" ? "EN_PROCESO" : current.status,
      lot: input.lot ?? current.lot,
      client: input.client ?? current.client,
      code: input.code ?? current.code,
      product: input.product ?? current.product,
      updatedBy: actor.email,
    });
    if (!updated) {
      const fresh = await this.repo.getOrder(id);
      if (!fresh) throw new OrdersNotFoundError("Orden no encontrada.");
      throw new OrdersConflictError(
        "Otro usuario modificó esta orden. Actualizá y revisá las diferencias.",
        fresh
      );
    }
    await this.repo.appendAudit({
      orderId: id,
      eventType: "ORDER_SAVE_PROGRESS",
      actor: actor.email,
      actorSector: actor.sector,
      metadata: { version: updated.version },
    });
    return updated;
  }

  async deliver(id: string, actor: OrdersActor, confirm: boolean) {
    if (!confirm) {
      throw new OrdersValidationError(
        "Confirmación requerida: ¿Confirmás que la orden está completa?"
      );
    }
    const current = await this.repo.getOrder(id);
    if (!current) throw new OrdersNotFoundError("Orden no encontrada.");
    assertCanAccessAssignedOrder(
      current.type,
      current.assignedSector,
      actor,
      "deliver"
    );
    if (current.status === "COMPLETA") {
      throw new OrdersValidationError("La orden ya está completa.");
    }
    assertDeliverable(current.formData);
    // Entregar NO modifica la plantilla maestra
    const ts = nowIso();
    const updated = await this.repo.updateOrderOptimistic(id, current.version, {
      status: "COMPLETA",
      completedAt: ts,
      completedBy: actor.email,
      updatedBy: actor.email,
      formData: normalizeOrderContent(current.formData),
      completionPercentage: 100,
    });
    if (!updated) {
      const fresh = await this.repo.getOrder(id);
      throw new OrdersConflictError("Conflicto al entregar.", fresh!);
    }
    await this.repo.insertOrderVersion({
      id: randomUUID(),
      orderId: id,
      version: updated.revision,
      snapshot: updated,
      event: "deliver",
      reason: null,
      createdBy: actor.email,
      createdAt: ts,
    });
    await this.repo.appendAudit({
      orderId: id,
      eventType: "ORDER_DELIVERED",
      actor: actor.email,
      actorSector: actor.sector,
      metadata: {
        orderNumber: updated.orderNumber,
        templateId: updated.templateId,
        templateUnchanged: true,
      },
    });
    await notify(this.repo, {
      kind: current.type === "OE" ? "oe_completada" : "oa_completada",
      title: current.type === "OE" ? "OE completada" : "OA completada",
      message: `${updated.orderNumber} · ${updated.product} · Lote ${updated.lot} · ${actor.sector}`,
      sectors: ["CALIDAD", "PRODUCCION"],
      href: `/os?view=${current.type === "OE" ? "ordenes-elaboracion" : "ordenes-acondicionamiento"}&orderId=${id}`,
      orderId: id,
    });
    return updated;
  }

  async saveAsMaster(
    orderId: string,
    actor: OrdersActor,
    changeReason: string,
    confirm: boolean
  ) {
    if (!confirm) {
      throw new OrdersValidationError(
        "Confirmación requerida: Los cambios se utilizarán en las próximas órdenes."
      );
    }
    if (!changeReason.trim()) {
      throw new OrdersValidationError("Motivo de modificación obligatorio.");
    }
    const order = await this.repo.getOrder(orderId);
    if (!order) throw new OrdersNotFoundError("Orden no encontrada.");

    const canDirect = ["CALIDAD", "PRODUCCION", "DIRECCION"].includes(actor.sector);
    if (!canDirect) {
      assertCanAccessAssignedOrder(
        order.type,
        order.assignedSector,
        actor,
        "propose_master"
      );
      return this.proposeMaster(order, actor, changeReason);
    }

    assertCanOrderAction(order.type, "save_as_master", actor);
    const currentTemplate = await this.repo.getTemplate(order.templateId);
    if (!currentTemplate) throw new OrdersNotFoundError("Plantilla no encontrada.");

    const newContent = normalizeOrderContent(order.formData);
    const diff = summarizeContentDiff(currentTemplate.content, newContent);
    await this.repo.markTemplateObsolete(currentTemplate.id);
    const ts = nowIso();
    const next: OrderTemplateRecord = {
      id: randomUUID(),
      type: currentTemplate.type,
      productId: currentTemplate.productId,
      productName: currentTemplate.productName,
      productCode: currentTemplate.productCode,
      brandClient: currentTemplate.brandClient,
      version: currentTemplate.version + 1,
      status: "VIGENTE",
      content: newContent,
      changeReason: changeReason.trim(),
      previousVersionId: currentTemplate.id,
      createdBy: actor.email,
      updatedBy: actor.email,
      createdAt: ts,
      updatedAt: ts,
    };
    const saved = await this.repo.insertTemplate(next);
    await this.repo.appendAudit({
      orderId,
      eventType: "TEMPLATE_MASTER_UPDATED",
      actor: actor.email,
      actorSector: actor.sector,
      metadata: {
        previousTemplateId: currentTemplate.id,
        newTemplateId: saved.id,
        version: saved.version,
        diff,
        orderUnchanged: true,
      },
    });
    // No modifica la orden actual ni órdenes anteriores
    return { template: saved, diff, proposal: null as TemplateChangeProposalRecord | null };
  }

  private async proposeMaster(
    order: OperationalOrderRecord,
    actor: OrdersActor,
    changeReason: string
  ) {
    const proposal: TemplateChangeProposalRecord = {
      id: randomUUID(),
      templateId: order.templateId,
      orderId: order.id,
      proposedChanges: normalizeOrderContent(order.formData),
      proposedBy: actor.email,
      proposedAt: nowIso(),
      status: "PENDIENTE",
      decidedBy: null,
      decidedAt: null,
      decisionReason: changeReason,
    };
    const saved = await this.repo.insertProposal(proposal);
    await this.repo.appendAudit({
      orderId: order.id,
      eventType: "TEMPLATE_CHANGE_PROPOSED",
      actor: actor.email,
      actorSector: actor.sector,
      metadata: { proposalId: saved.id },
    });
    await notify(this.repo, {
      kind: "template_proposal",
      title: "Propuesta de cambio de plantilla maestra",
      message: `${order.orderNumber} · ${order.product} · propuesta por ${actor.displayName}`,
      sectors: ["CALIDAD", "PRODUCCION"],
      href: `/os?view=ordenes&proposalId=${saved.id}`,
      orderId: order.id,
    });
    return { template: null, diff: summarizeContentDiff(order.templateSnapshot, order.formData), proposal: saved };
  }

  async decideProposal(
    proposalId: string,
    actor: OrdersActor,
    decision: "APROBADA" | "RECHAZADA",
    decisionReason: string
  ) {
    assertCanOrderAction("OE", "approve_master", actor);
    // approve_master is on both OE and OA maps for calidad/prod
    const proposal = await this.repo.getProposal(proposalId);
    if (!proposal) throw new OrdersNotFoundError("Propuesta no encontrada.");
    if (proposal.status !== "PENDIENTE") {
      throw new OrdersValidationError("La propuesta ya fue decidida.");
    }
    const template = await this.repo.getTemplate(proposal.templateId);
    if (!template) throw new OrdersNotFoundError("Plantilla no encontrada.");

    const ts = nowIso();
    if (decision === "RECHAZADA") {
      const updated = await this.repo.updateProposal(proposalId, {
        status: "RECHAZADA",
        decidedBy: actor.email,
        decidedAt: ts,
        decisionReason,
      });
      await notify(this.repo, {
        kind: "template_proposal_rejected",
        title: "Propuesta de plantilla rechazada",
        message: decisionReason || "Sin observaciones",
        sectors: ["CALIDAD", "PRODUCCION", "ELABORACION", "ENVASADO_MASIVO", "ENVASADO_PREMIUM"],
        href: null,
        orderId: proposal.orderId,
      });
      return { proposal: updated!, template: null };
    }

    await this.repo.markTemplateObsolete(template.id);
    const next: OrderTemplateRecord = {
      id: randomUUID(),
      type: template.type,
      productId: template.productId,
      productName: template.productName,
      productCode: template.productCode,
      brandClient: template.brandClient,
      version: template.version + 1,
      status: "VIGENTE",
      content: normalizeOrderContent(proposal.proposedChanges),
      changeReason: decisionReason || proposal.decisionReason || "Aprobación de propuesta",
      previousVersionId: template.id,
      createdBy: actor.email,
      updatedBy: actor.email,
      createdAt: ts,
      updatedAt: ts,
    };
    const savedTemplate = await this.repo.insertTemplate(next);
    const updated = await this.repo.updateProposal(proposalId, {
      status: "APROBADA",
      decidedBy: actor.email,
      decidedAt: ts,
      decisionReason,
    });
    await this.repo.appendAudit({
      orderId: proposal.orderId,
      eventType: "TEMPLATE_PROPOSAL_APPROVED",
      actor: actor.email,
      actorSector: actor.sector,
      metadata: { proposalId, newTemplateId: savedTemplate.id, version: savedTemplate.version },
    });
    await notify(this.repo, {
      kind: "template_proposal_approved",
      title: "Propuesta de plantilla aprobada",
      message: `Nueva versión v${savedTemplate.version} vigente para próximas órdenes.`,
      sectors: ["CALIDAD", "PRODUCCION", "ELABORACION", "ENVASADO_MASIVO", "ENVASADO_PREMIUM"],
      href: null,
      orderId: proposal.orderId,
    });
    return { proposal: updated!, template: savedTemplate };
  }

  async returnForCorrection(id: string, actor: OrdersActor, reason: string) {
    assertCanOrderAction(
      (await this.requireOrder(id)).type,
      "return",
      actor
    );
    if (!reason.trim()) {
      throw new OrdersValidationError("Motivo de devolución obligatorio.");
    }
    const current = await this.requireOrder(id);
    if (current.status !== "COMPLETA") {
      throw new OrdersValidationError("Solo se pueden devolver órdenes completas.");
    }
    // Conserva versión entregada
    await this.repo.insertOrderVersion({
      id: randomUUID(),
      orderId: id,
      version: current.revision,
      snapshot: current,
      event: "return_keep_delivered",
      reason: reason.trim(),
      createdBy: actor.email,
      createdAt: nowIso(),
    });
    const updated = await this.repo.updateOrderOptimistic(id, current.version, {
      status: "DEVUELTA_PARA_CORRECCION",
      revision: current.revision + 1,
      updatedBy: actor.email,
      completedAt: null,
      completedBy: null,
      reviewedAt: null,
      reviewedBy: null,
    });
    if (!updated) {
      const fresh = await this.repo.getOrder(id);
      throw new OrdersConflictError("Conflicto al devolver.", fresh!);
    }
    await this.repo.appendAudit({
      orderId: id,
      eventType: "ORDER_RETURNED",
      actor: actor.email,
      actorSector: actor.sector,
      metadata: { reason, preservedRevision: current.revision },
    });
    await notify(this.repo, {
      kind: "order_returned",
      title: "Orden devuelta para corrección",
      message: `${updated.orderNumber}: ${reason.trim()}`,
      sectors: [updated.assignedSector, "CALIDAD", "PRODUCCION"],
      href: `/os?orderId=${id}`,
      orderId: id,
    });
    return updated;
  }

  async markReviewed(id: string, actor: OrdersActor) {
    const current = await this.requireOrder(id);
    assertCanOrderAction(current.type, "review", actor);
    if (current.status !== "COMPLETA") {
      throw new OrdersValidationError("Solo se revisan órdenes completas.");
    }
    const updated = await this.repo.updateOrderOptimistic(id, current.version, {
      reviewedAt: nowIso(),
      reviewedBy: actor.email,
      updatedBy: actor.email,
    });
    if (!updated) {
      const fresh = await this.repo.getOrder(id);
      throw new OrdersConflictError("Conflicto al revisar.", fresh!);
    }
    await this.repo.appendAudit({
      orderId: id,
      eventType: "ORDER_REVIEWED",
      actor: actor.email,
      actorSector: actor.sector,
      metadata: null,
    });
    return updated;
  }

  async archive(id: string, actor: OrdersActor) {
    const current = await this.requireOrder(id);
    assertCanOrderAction(current.type, "archive", actor);
    const updated = await this.repo.updateOrderOptimistic(id, current.version, {
      status: "ARCHIVADA",
      updatedBy: actor.email,
    });
    if (!updated) {
      const fresh = await this.repo.getOrder(id);
      throw new OrdersConflictError("Conflicto al archivar.", fresh!);
    }
    await this.repo.appendAudit({
      orderId: id,
      eventType: "ORDER_ARCHIVED",
      actor: actor.email,
      actorSector: actor.sector,
      metadata: null,
    });
    return updated;
  }

  async annul(id: string, actor: OrdersActor, reason: string) {
    const current = await this.requireOrder(id);
    assertCanOrderAction(current.type, "annul", actor);
    const updated = await this.repo.updateOrderOptimistic(id, current.version, {
      status: "ANULADA",
      updatedBy: actor.email,
    });
    if (!updated) {
      const fresh = await this.repo.getOrder(id);
      throw new OrdersConflictError("Conflicto al anular.", fresh!);
    }
    await this.repo.appendAudit({
      orderId: id,
      eventType: "ORDER_ANNULLED",
      actor: actor.email,
      actorSector: actor.sector,
      metadata: { reason },
    });
    await notify(this.repo, {
      kind: "order_annulled",
      title: "Orden anulada",
      message: `${updated.orderNumber}: ${reason}`,
      sectors: [updated.assignedSector, "CALIDAD", "PRODUCCION"],
      href: null,
      orderId: id,
    });
    return updated;
  }

  async recordDownload(id: string, actor: OrdersActor, format: string) {
    const order = await this.requireOrder(id);
    assertCanAccessAssignedOrder(order.type, order.assignedSector, actor, "download");
    await this.repo.appendAudit({
      orderId: id,
      eventType: "ORDER_DOWNLOADED",
      actor: actor.email,
      actorSector: actor.sector,
      metadata: { format },
    });
    return order;
  }

  listNotifications(actor: OrdersActor) {
    return this.repo.listNotificationsForSector(actor.sector, actor.email);
  }

  private async requireOrder(id: string) {
    const order = await this.repo.getOrder(id);
    if (!order) throw new OrdersNotFoundError("Orden no encontrada.");
    return order;
  }
}
