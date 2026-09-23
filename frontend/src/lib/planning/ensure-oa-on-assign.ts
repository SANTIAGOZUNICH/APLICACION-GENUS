/**
 * Dentro de la transacción de asignación: buscar o crear OA.
 *
 * Identidad (ver order-identity.ts): si el llamador provee
 * pedidoId+productIdentityKey (Asignar trabajo con Pedido vinculado), la OA
 * se busca PRIMERO por PEDIDO + PRODUCTO + LOTE — si ya existe una OA para
 * esa combinación, SIEMPRE se reutiliza (aunque ya tenga otro trabajo
 * vinculado: varios WorkItems del mismo Pedido+Producto+Lote comparten una
 * sola OA real, por diseño). Sin esa identidad (flujo legacy, sin Pedido,
 * u OA/OE referenciada manualmente por número), la regla previa sigue
 * intacta: 1 trabajo = 1 OA, número exacto.
 */
import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
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
import { parseArInteger } from "@/lib/utils/ar-number-parsing";
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
  /** Identidad PEDIDO+PRODUCTO+LOTE — ver order-identity.ts. Omitir/null = comportamiento legacy (solo por número). */
  pedidoId?: string | null;
  productIdentityKey?: string | null;
  loteIdentityKey?: string | null;
};

export type EnsureOaResult = {
  id: string;
  orderNumber: string;
  assignedSector: string;
  linkedWorkItemId: string | null;
  created: boolean;
  linked: boolean;
  filledEmptyFields: string[];
  /** true = se encontró/reusó por PEDIDO+PRODUCTO+LOTE (puede ya tener OTRO trabajo vinculado — es intencional). */
  reusedByIdentity: boolean;
};

type FoundOrderRow = {
  id: string;
  orderNumber: string;
  assignedSector: string;
  linkedWorkItemId: string | null;
  type: string;
  product: string;
  client: string;
  lot: string;
  code: string;
  formData: unknown;
  status: string;
  version: number;
};

const FOUND_ORDER_COLUMNS = {
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
} as const;

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
  const header = fd && typeof fd === "object" && fd.kind === "OA" ? fd.header : null;
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

/** Busca una OA por identidad PEDIDO+PRODUCTO+LOTE (o SIN_LOTE si loteIdentityKey es null). */
async function findByIdentity(
  tx: Tx,
  pedidoId: string,
  productIdentityKey: string,
  loteIdentityKey: string | null
): Promise<FoundOrderRow | undefined> {
  const [row] = await tx
    .select(FOUND_ORDER_COLUMNS)
    .from(operationalOrders)
    .where(
      and(
        eq(operationalOrders.type, "OA"),
        eq(operationalOrders.pedidoId, pedidoId),
        eq(operationalOrders.productIdentityKey, productIdentityKey),
        loteIdentityKey
          ? eq(operationalOrders.loteIdentityKey, loteIdentityKey)
          : isNull(operationalOrders.loteIdentityKey),
        isNull(operationalOrders.deletedAt)
      )
    )
    .limit(1);
  return row;
}

/** Vincula/rellena una OA ya existente (por identidad o por número) — lógica compartida. */
async function linkExisting(
  tx: Tx,
  input: EnsureOaInput,
  orderNumber: string,
  found: FoundOrderRow,
  reusedByIdentity: boolean
): Promise<EnsureOaResult> {
  if (found.type !== "OA") {
    throw new PlanningValidationError(
      `La referencia ${orderNumber} no es una Orden de Acondicionamiento (OA).`
    );
  }
  // 1 trabajo = 1 OA — salvo reuso legítimo por identidad (mismo Pedido +
  // Producto + Lote): ahí varios WorkItems comparten intencionalmente la
  // misma OA, así que un `linkedWorkItemId` ya presente no es conflicto.
  if (
    !reusedByIdentity &&
    found.linkedWorkItemId &&
    found.linkedWorkItemId.trim() !== ""
  ) {
    throw new PlanningConflictError(
      "Esta OA ya tiene un trabajo asignado. Cada trabajo requiere su propia OA.",
      stubConflictItem(input, found.linkedWorkItemId)
    );
  }

  const incoming: OaCompatSnapshot = {
    product: input.product.trim(),
    client: input.client.trim(),
    lot: input.lot.trim(),
    vto: input.vto.trim(),
    code: input.code.trim(),
  };

  const existing = existingSnapshot(found);
  const compat = evaluateOaCompatibility(existing, incoming);
  if (compat.mismatches.length > 0 && !input.forceLink && !reusedByIdentity) {
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
  if (nextForm && typeof nextForm === "object" && nextForm.kind === "OA" && nextForm.header) {
    nextForm = {
      ...nextForm,
      header: {
        ...nextForm.header,
        productName:
          nextForm.header.productName || fills.product || nextForm.header.productName,
        client: nextForm.header.client || fills.client || nextForm.header.client,
        lot: nextForm.header.lot || fills.lot || nextForm.header.lot,
        productCode:
          nextForm.header.productCode || fills.code || nextForm.header.productCode,
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
      reusedByIdentity,
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
    reusedByIdentity,
  };
}

/**
 * Resuelve OA: primero por identidad PEDIDO+PRODUCTO+LOTE si el llamador la
 * provee (reutiliza SIEMPRE, incluso si ya tiene otro trabajo vinculado);
 * si no, por número exacto (comportamiento legacy, 1 trabajo = 1 OA). Crea
 * BORRADOR si no existe por ninguna de las dos vías. No vincula al work
 * item todavía (linkedWorkItemId se setea después del insert).
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

  const pedidoId = input.pedidoId?.trim() || null;
  const productIdentityKey = input.productIdentityKey?.trim() || null;
  const loteIdentityKey = input.loteIdentityKey?.trim() || null;
  const hasIdentity = Boolean(pedidoId && productIdentityKey);

  if (hasIdentity) {
    const byIdentity = await findByIdentity(tx, pedidoId!, productIdentityKey!, loteIdentityKey);
    if (byIdentity) {
      return linkExisting(tx, input, orderNumber, byIdentity, true);
    }
  }

  const [byNumber] = await tx
    .select(FOUND_ORDER_COLUMNS)
    .from(operationalOrders)
    .where(eq(operationalOrders.orderNumber, orderNumber))
    .limit(1);

  if (byNumber) {
    return linkExisting(tx, input, orderNumber, byNumber, false);
  }

  // Crear OA con el número exacto indicado (y la identidad, si la hay).
  const parsed = parseOaOrderNumber(orderNumber);
  if (!parsed) {
    throw new PlanningValidationError("Número de OA inválido.");
  }

  const incoming: OaCompatSnapshot = {
    product: input.product.trim(),
    client: input.client.trim(),
    lot: input.lot.trim(),
    vto: input.vto.trim(),
    code: input.code.trim(),
  };

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

  // Observación de trazabilidad en observaciones iniciales de la OA.
  if (input.notes?.trim()) {
    content.observaciones = input.notes.trim();
  }
  if (input.quantity.trim()) {
    content.rendimientos = {
      ...content.rendimientos,
      // OA solo aplica a sectores de envasado/codificado — cantidad siempre
      // en unidades (enteras), nunca kg. "1.500" = mil quinientas unidades.
      produccionTeoricaUnidades: (() => {
        const parsed = parseArInteger(input.quantity);
        return parsed.ok ? parsed.value : null;
      })(),
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
      pedidoId,
      productIdentityKey,
      loteIdentityKey,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isUniqueViolation = /unique|duplicate|operational_orders/i.test(msg);
    if (isUniqueViolation && hasIdentity) {
      // Carrera: otra transacción concurrente ya insertó la misma
      // identidad (o el mismo número) primero — nunca se pierde el
      // trabajo por esto, se relee y se reusa como si se hubiera
      // encontrado desde el principio.
      const race = await findByIdentity(tx, pedidoId!, productIdentityKey!, loteIdentityKey);
      if (race) {
        return linkExisting(tx, input, orderNumber, race, true);
      }
    }
    if (isUniqueViolation) {
      throw new PlanningConflictError(
        `La ${orderNumber} ya fue creada por otra operación. Cada trabajo requiere su propia OA. Reintentá.`,
        stubConflictItem(input, orderNumber)
      );
    }
    throw err;
  }

  await bumpSequenceIfNeeded(tx, parsed.year, parsed.seq);

  const orderSnapshot = {
    id: orderId,
    orderNumber,
    type: "OA" as const,
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
      pedidoId,
      productIdentityKey,
      loteIdentityKey,
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
    reusedByIdentity: false,
  };
}
