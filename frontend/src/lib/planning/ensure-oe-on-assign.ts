/**
 * Dentro de la transacción de asignación: buscar o crear OE con número exacto.
 * Mismo patrón y mismas reglas de seguridad que ensure-oa-on-assign.ts (1
 * trabajo = 1 OE; no reutilizar OE ya vinculada; conflicto de datos exige
 * forceLink explícito) — Elaboración pasa a tener el mismo auto-crear/
 * vincular que ya tenían Envasado/Codificado/Masivo con OA, en vez del
 * "lookup obligatorio, sin auto-crear" que hacía fallar la asignación
 * cuando el OE autogenerado desde el N° de Pedido todavía no existía.
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
  createEmptyOeContent,
  computeCompletionPercentage,
  normalizeOrderContent,
} from "@/lib/orders/content";
import type { OeContent } from "@/lib/orders/types";
import { parseArDecimal } from "@/lib/utils/ar-number-parsing";
import {
  PlanningConflictError,
  PlanningOaCompatibilityError,
  PlanningValidationError,
  type PlanningWorkItemRecord,
} from "@/lib/planning/types";
import {
  evaluateOaCompatibility,
  formatOaCompatibilityMessage,
  type OaCompatSnapshot,
} from "@/lib/planning/oa-assign-helpers";
import { isValidOeOrderNumber, normalizeOeOrderNumber, parseOeOrderNumber } from "@/lib/planning/oe-assign-helpers";

/** Transacción Drizzle del assign (tipado flexible para Neon/pg). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

export type EnsureOeInput = {
  orderNumberRaw: string;
  sector: "ELABORACION";
  product: string;
  client: string;
  lot: string;
  code: string;
  /** Cantidad en kg — Elaboración siempre trabaja en kg, nunca unidades. */
  quantity: string;
  notes: string | null;
  assignmentDate: string;
  forceLink: boolean;
  actorEmail: string;
  actorSector: string;
};

export type EnsureOeResult = {
  id: string;
  orderNumber: string;
  assignedSector: string;
  linkedWorkItemId: string | null;
  created: boolean;
  linked: boolean;
  filledEmptyFields: string[];
};

function stubConflictItem(
  input: EnsureOeInput,
  originRef: string
): PlanningWorkItemRecord {
  const now = new Date().toISOString();
  return {
    id: "oe-conflict",
    planningWeekId: "",
    plannedDate: input.assignmentDate,
    client: input.client,
    product: input.product,
    plannedQuantity: input.quantity,
    unit: "kg",
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
}): OaCompatSnapshot {
  // OE no tiene VTO (Elaboración no maneja packagingVto) — siempre "", así
  // que evaluateOaCompatibility nunca lo marca como mismatch ni fill.
  return {
    product: row.product ?? "",
    client: row.client ?? "",
    lot: row.lot ?? "",
    vto: "",
    code: row.code ?? "",
  };
}

async function bumpSequenceIfNeeded(tx: Tx, year: number, seq: number) {
  await tx
    .insert(orderNumberSequences)
    .values({ type: "OE", year, lastValue: seq })
    .onConflictDoNothing({
      target: [orderNumberSequences.type, orderNumberSequences.year],
    });
  await tx
    .update(orderNumberSequences)
    .set({
      lastValue: sql`GREATEST(${orderNumberSequences.lastValue}, ${seq})`,
    })
    .where(
      and(eq(orderNumberSequences.type, "OE"), eq(orderNumberSequences.year, year))
    );
}

/**
 * Resuelve OE por número exacto: crea BORRADOR si no existe; si existe valida
 * compatibilidad y opcionalmente rellena vacíos (forceLink). No vincula al
 * work item todavía (linkedWorkItemId se setea después del insert, mismo
 * orden que ensureOaForAssignment).
 */
export async function ensureOeForAssignment(
  tx: Tx,
  input: EnsureOeInput
): Promise<EnsureOeResult> {
  const orderNumber = normalizeOeOrderNumber(input.orderNumberRaw);
  if (!orderNumber) {
    throw new PlanningValidationError("Indicá el número de OE.");
  }
  if (!isValidOeOrderNumber(orderNumber)) {
    throw new PlanningValidationError(
      "Número de OE inválido. Usá el formato OE-YYYY-###### (ej. OE-2026-000145)."
    );
  }

  const incoming: OaCompatSnapshot = {
    product: input.product.trim(),
    client: input.client.trim(),
    lot: input.lot.trim(),
    vto: "",
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
    if (found.type !== "OE") {
      throw new PlanningValidationError(
        `La referencia ${orderNumber} no es una Orden de Elaboración (OE).`
      );
    }
    // 1 OE = 1 trabajo: no reutilizar si ya está vinculada a otro trabajo.
    if (found.linkedWorkItemId && found.linkedWorkItemId.trim() !== "") {
      throw new PlanningConflictError(
        "Esta OE ya tiene un trabajo asignado. Cada trabajo requiere su propia OE.",
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

    let nextForm = found.formData as OeContent;
    if (nextForm && typeof nextForm === "object" && nextForm.kind === "OE" && nextForm.header) {
      nextForm = {
        ...nextForm,
        header: {
          ...nextForm.header,
          productName:
            nextForm.header.productName || fills.product || nextForm.header.productName,
          client: nextForm.header.client || fills.client || nextForm.header.client,
          lot: nextForm.header.lot || fills.lot || nextForm.header.lot,
          code: nextForm.header.code || fills.code || nextForm.header.code,
        },
      };
    }

    if (filledEmptyFields.length > 0) {
      let completion: number | undefined;
      try {
        if (nextForm && typeof nextForm === "object" && nextForm.kind === "OE") {
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
      eventType: "OE_LINKED_FROM_ASSIGN",
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

  // Crear OE con el número exacto indicado.
  const parsed = parseOeOrderNumber(orderNumber);
  if (!parsed) {
    throw new PlanningValidationError("Número de OE inválido.");
  }

  const now = new Date();
  const ts = now.toISOString();
  const quantityKg = (() => {
    if (!input.quantity.trim()) return null;
    const p = parseArDecimal(input.quantity);
    return p.ok ? p.value : null;
  })();
  const content = normalizeOrderContent(
    createEmptyOeContent({
      productName: incoming.product,
      client: incoming.client,
      lot: incoming.lot,
      code: incoming.code,
      date: input.assignmentDate,
      quantityKg,
    })
  ) as OeContent;

  const templateId = randomUUID();
  await tx.insert(orderTemplates).values({
    id: templateId,
    type: "OE",
    productId: `assign-blank-oe-${templateId}`,
    productName: incoming.product || "",
    productCode: incoming.code || "",
    brandClient: incoming.client || null,
    version: 1,
    status: "OBSOLETA",
    content,
    changeReason: "Plantilla técnica auto-OE desde Asignar trabajo (no maestra)",
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
      type: "OE",
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
    // Carrera: otro proceso insertó el mismo número.
    const msg = err instanceof Error ? err.message : String(err);
    if (/unique|duplicate|operational_orders_number/i.test(msg)) {
      throw new PlanningConflictError(
        `La ${orderNumber} ya fue creada por otra operación. Cada trabajo requiere su propia OE. Reintentá.`,
        stubConflictItem(input, orderNumber)
      );
    }
    throw err;
  }

  await bumpSequenceIfNeeded(tx, parsed.year, parsed.seq);

  const orderSnapshot = {
    id: orderId,
    orderNumber,
    type: "OE" as const,
    status: "BORRADOR",
    product: incoming.product,
    client: incoming.client,
    code: incoming.code,
    lot: incoming.lot,
    assignedSector: input.sector,
    createdAt: ts,
  };

  await tx.insert(orderVersions).values({
    id: randomUUID(),
    orderId,
    version: 1,
    snapshot: orderSnapshot,
    event: "create",
    reason: "Creada automáticamente desde Asignar trabajo",
    createdBy: input.actorEmail,
    createdAt: now,
  });

  await tx.insert(orderAuditEvents).values({
    orderId,
    eventType: "OE_CREATED_FROM_ASSIGN",
    actor: input.actorEmail,
    actorSector: input.actorSector,
    metadata: {
      orderNumber,
      createdAutomatically: true,
      targetSector: input.sector,
      product: incoming.product,
      client: incoming.client,
      lot: incoming.lot,
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
