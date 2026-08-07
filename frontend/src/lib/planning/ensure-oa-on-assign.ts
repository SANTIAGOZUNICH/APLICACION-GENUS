/**
 * Dentro de la transacción de asignación: buscar o crear OA con número exacto.
 * Regla: 1 trabajo = 1 OA (no reutilizar OA ya vinculada).
 */
import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  orderAuditEvents,
  orderNumberSequences,
  orderTemplates,
  orderVersions,
  operationalOrders,
} from "@/lib/db/schema";
import {
  createEmptyOaContent,
  computeCompletionPercentage,
  normalizeOrderContent,
} from "@/lib/orders/content";
import type { OaContent } from "@/lib/orders/types";
import {
  PlanningConflictError,
  PlanningOaCompatibilityError,
  PlanningValidationError,
  type PlanningWorkItemRecord,
} from "@/lib/planning/types";
import {
  evaluateOaCompatibility,
  formatOaCompatibilityMessage,
  isValidOaOrderNumber,
  normalizeOaOrderNumber,
  parseOaOrderNumber,
  type OaCompatSnapshot,
} from "@/lib/planning/oa-assign-helpers";

/** Transacción Drizzle del assign (tipado flexible para Neon/pg). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

export type EnsureOaInput = {
  orderNumberRaw: string;
  sector: "ENVASADO_MASIVO" | "ENVASADO_PREMIUM" | "CODIFICADO";
  product: string;
  client: string;
  lot: string;
  vto: string;
  code: string;
  quantity: string;
  notes: string | null;
  assignmentDate: string;
  forceLink: boolean;
  actorEmail: string;
  actorSector: string;
};

export type EnsureOaResult = {
  id: string;
  orderNumber: string;
  assignedSector: string;
  linkedWorkItemId: string | null;
  created: boolean;
  linked: boolean;
  filledEmptyFields: string[];
};

function stubConflictItem(
  input: EnsureOaInput,
  originRef: string
): PlanningWorkItemRecord {
  const now = new Date().toISOString();
  return {
    id: "oa-conflict",
    planningWeekId: "",
    plannedDate: input.assignmentDate,
    client: input.client,
    product: input.product,
    plannedQuantity: input.quantity,
    unit: "un.",
    sector: input.sector,
    line: null,
    branchOwner: null,
    priority: "NORMAL",
    notes: null,
    status: "PUBLICADO",
    publishedAt: null,
    createdBy: input.actorEmail,
    source: "native",
    originRef,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function existingSnapshot(row: {
  product: string;
  client: string;
  lot: string;
  code: string;
  formData: unknown;
}): OaCompatSnapshot {
  const fd = row.formData as OaContent | null;
  const header =
    fd && typeof fd === "object" && fd.kind === "OA" ? fd.header : null;
  return {
    product: row.product ?? "",
    client: row.client ?? "",
    lot: row.lot || header?.lot || "",
    vto: header?.vto ?? "",
    code: row.code || header?.productCode || "",
  };
}

async function bumpSequenceIfNeeded(tx: Tx, year: number, seq: number) {
  await tx
    .insert(orderNumberSequences)
    .values({ type: "OA", year, lastValue: seq })
    .onConflictDoNothing({
      target: [orderNumberSequences.type, orderNumberSequences.year],
    });
  await tx
    .update(orderNumberSequences)
    .set({
      lastValue: sql`GREATEST(${orderNumberSequences.lastValue}, ${seq})`,
    })
    .where(
      and(eq(orderNumberSequences.type, "OA"), eq(orderNumberSequences.year, year))
    );
}

/**
 * Resuelve OA por número exacto: crea BORRADOR si no existe; si existe valida
 * compatibilidad. No vincula al work item todavía (se setea después del insert).
 */
export async function ensureOaForAssignment(
  tx: Tx,
  input: EnsureOaInput
): Promise<EnsureOaResult> {
  const orderNumber = normalizeOaOrderNumber(input.orderNumberRaw);
  if (!orderNumber) {
    throw new PlanningValidationError("Indicá el número de OA.");
  }
  if (!isValidOaOrderNumber(orderNumber)) {
    throw new PlanningValidationError(
      "Número de OA inválido. Usá el formato OA-YYYY-###### (ej. OA-2026-000145)."
    );
  }

  const incoming: OaCompatSnapshot = {
    product: input.product.trim(),
    client: input.client.trim(),
    lot: input.lot.trim(),
    vto: input.vto.trim(),
    code: input.code.trim(),
  };

  const [found] = await tx
    .select({
      id: operationalOrders.id,
      orderNumber: operationalOrders.orderNumber,
      assignedSector: operationalOrders.assignedSector,
      linkedWorkItemId: operationalOrders.linkedWorkItemId,
      type: operationalOrders.type,
      product: operationalOrders.product,
      client: operationalOrders.client,
      lot: operationalOrders.lot,
      code: operationalOrders.code,
      formData: operationalOrders.formData,
      status: operationalOrders.status,
      version: operationalOrders.version,
    })
    .from(operationalOrders)
    .where(eq(operationalOrders.orderNumber, orderNumber))
    .limit(1);

  if (found) {
    if (found.type !== "OA") {
      throw new PlanningValidationError(
        `La referencia ${orderNumber} no es una Orden de Acondicionamiento (OA).`
      );
    }
    // 1 OA = 1 trabajo: no reutilizar si ya está vinculada.
    if (found.linkedWorkItemId && found.linkedWorkItemId.trim() !== "") {
      throw new PlanningConflictError(
        "Esta OA ya tiene un trabajo asignado. Cada trabajo requiere su propia OA.",
        stubConflictItem(input, found.linkedWorkItemId)
      );
    }

    const existing = existingSnapshot(found);
    const compat = evaluateOaCompatibility(existing, incoming);
    if (compat.mismatches.length > 0 && !input.forceLink) {
      throw new PlanningOaCompatibilityError(
        formatOaCompatibilityMessage(orderNumber, compat.mismatches),
        {
          orderNumber,
          orderId: found.id,
          mismatches: compat.mismatches,
          canForce: true,
        }
      );
    }

    const fills = compat.fills;
    const filledEmptyFields = Object.keys(fills);
    const nextProduct = fills.product ?? found.product;
    const nextClient = fills.client ?? found.client;
    const nextLot = fills.lot ?? found.lot;
    const nextCode = fills.code ?? found.code;

    let nextForm = found.formData as OaContent;
    if (
      nextForm &&
      typeof nextForm === "object" &&
      nextForm.kind === "OA" &&
      nextForm.header
    ) {
      nextForm = {
        ...nextForm,
        header: {
          ...nextForm.header,
          productName:
            nextForm.header.productName ||
            fills.product ||
            nextForm.header.productName,
          client:
            nextForm.header.client || fills.client || nextForm.header.client,
          lot: nextForm.header.lot || fills.lot || nextForm.header.lot,
          productCode:
            nextForm.header.productCode ||
            fills.code ||
            nextForm.header.productCode,
          vto: nextForm.header.vto || fills.vto || nextForm.header.vto,
        },
      };
    }

    if (filledEmptyFields.length > 0) {
      let completion: number | undefined;
      try {
        if (nextForm && typeof nextForm === "object" && nextForm.kind === "OA") {
          completion = computeCompletionPercentage(nextForm);
        }
      } catch {
        completion = undefined;
      }
      await tx
        .update(operationalOrders)
        .set({
          product: nextProduct,
          client: nextClient,
          lot: nextLot,
          code: nextCode,
          formData: nextForm,
          ...(completion != null ? { completionPercentage: completion } : {}),
          updatedBy: input.actorEmail,
          updatedAt: new Date(),
          version: sql`${operationalOrders.version} + 1`,
        })
        .where(eq(operationalOrders.id, found.id));
    }

    await tx.insert(orderAuditEvents).values({
      orderId: found.id,
      eventType: "OA_LINKED_FROM_ASSIGN",
      actor: input.actorEmail,
      actorSector: input.actorSector,
      metadata: {
        orderNumber,
        createdAutomatically: false,
        forceLink: input.forceLink,
        filledEmptyFields,
        targetSector: input.sector,
      },
    });

    return {
      id: found.id,
      orderNumber: found.orderNumber,
      assignedSector: found.assignedSector,
      linkedWorkItemId: found.linkedWorkItemId,
      created: false,
      linked: true,
      filledEmptyFields,
    };
  }

  const parsed = parseOaOrderNumber(orderNumber);
  if (!parsed) {
    throw new PlanningValidationError("Número de OA inválido.");
  }

  const now = new Date();
  const ts = now.toISOString();
  const content = normalizeOrderContent(
    createEmptyOaContent({
      productName: incoming.product,
      client: incoming.client,
      lot: incoming.lot,
      productCode: incoming.code,
      vto: incoming.vto,
      fechaEmision: input.assignmentDate,
    })
  ) as OaContent;

  if (input.notes?.trim()) {
    content.observaciones = input.notes.trim();
  }
  if (input.quantity.trim()) {
    const n = Number.parseFloat(
      input.quantity.replace(/\s/g, "").replace(",", ".")
    );
    content.rendimientos = {
      ...content.rendimientos,
      produccionTeoricaUnidades: Number.isFinite(n) ? n : null,
    };
  }

  const templateId = randomUUID();
  await tx.insert(orderTemplates).values({
    id: templateId,
    type: "OA",
    productId: `assign-blank-oa-${templateId}`,
    productName: incoming.product || "",
    productCode: incoming.code || "",
    brandClient: incoming.client || null,
    version: 1,
    status: "OBSOLETA",
    content,
    changeReason: "Plantilla técnica auto-OA desde Asignar trabajo (no maestra)",
    previousVersionId: null,
    createdBy: input.actorEmail,
    updatedBy: input.actorEmail,
    createdAt: now,
    updatedAt: now,
  });

  const orderId = randomUUID();
  try {
    await tx.insert(operationalOrders).values({
      id: orderId,
      orderNumber,
      type: "OA",
      templateId,
      templateVersion: 1,
      templateSnapshot: content,
      product: incoming.product,
      client: incoming.client,
      code: incoming.code,
      lot: incoming.lot,
      assignedSector: input.sector,
      formulaProductId: null,
      formulaVersionId: null,
      formulaVersionHash: null,
      status: "BORRADOR",
      formData: content,
      completionPercentage: computeCompletionPercentage(content),
      revision: 1,
      version: 1,
      linkedWorkItemId: null,
      reviewedAt: null,
      reviewedBy: null,
      completedAt: null,
      completedBy: null,
      createdBy: input.actorEmail,
      updatedBy: input.actorEmail,
      createdAt: now,
      updatedAt: now,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/unique|duplicate|operational_orders_number/i.test(msg)) {
      throw new PlanningConflictError(
        `La ${orderNumber} ya fue creada por otra operación. Cada trabajo requiere su propia OA. Reintentá.`,
        stubConflictItem(input, orderNumber)
      );
    }
    throw err;
  }

  await bumpSequenceIfNeeded(tx, parsed.year, parsed.seq);

  await tx.insert(orderVersions).values({
    id: randomUUID(),
    orderId,
    version: 1,
    snapshot: {
      id: orderId,
      orderNumber,
      type: "OA",
      status: "BORRADOR",
      product: incoming.product,
      client: incoming.client,
      code: incoming.code,
      lot: incoming.lot,
      assignedSector: input.sector,
      createdAt: ts,
    },
    event: "create",
    reason: "Creada automáticamente desde Asignar trabajo",
    createdBy: input.actorEmail,
    createdAt: now,
  });

  await tx.insert(orderAuditEvents).values({
    orderId,
    eventType: "OA_CREATED_FROM_ASSIGN",
    actor: input.actorEmail,
    actorSector: input.actorSector,
    metadata: {
      orderNumber,
      createdAutomatically: true,
      targetSector: input.sector,
      product: incoming.product,
      client: incoming.client,
      lot: incoming.lot,
      vto: incoming.vto,
      quantity: input.quantity,
      assignmentDate: input.assignmentDate,
    },
  });

  return {
    id: orderId,
    orderNumber,
    assignedSector: input.sector,
    linkedWorkItemId: null,
    created: true,
    linked: false,
    filledEmptyFields: [],
  };
}
