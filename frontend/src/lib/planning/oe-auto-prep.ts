/**
 * OE automática: completa la OE que «Asignar trabajo» ya creó o vinculó (ensure-oe-on-assign.ts) con la fórmula,
 * el lote de fabricación, la cantidad y los lotes de MP. NO crea otra OE ni otro número: trabaja sobre la OE
 * vinculada al trabajo.
 *
 * Cuándo corre:
 *  - después de confirmar la asignación (y en cada reintento de la misma asignación: es idempotente);
 *  - después de que Producción corrige el trabajo (producto, cliente, cantidad, lote) ANTES de que empiece la elaboración;
 *  - a pedido, con «Actualizar desde fórmula y lotes» (acción explícita, con vista previa), también después de empezar.
 *
 * Garantías:
 *  - solo lectura de Drive y del banco de fórmulas; nunca escribe en el Control semanal ni mueve stock
 *    (el consumo de MP sigue ocurriendo una sola vez, al entregar la OE: applyOeConsumption);
 *  - fila de la OE bloqueada (FOR UPDATE) y versión +1: dos preparaciones simultáneas no se pisan;
 *  - si la elaboración empezó, no reemplaza nada sin la acción explícita;
 *  - cada cambio queda en order_versions (snapshot) y order_audit_events.
 */
import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  mpWeeklyControlLines,
  mpWeeklyControls,
  operationalOrders,
  orderAuditEvents,
  orderVersions,
  workItems,
} from "@/lib/db/schema";
import { computeCompletionPercentage } from "@/lib/orders/content";
import type { OeAutoPrep, OeContent } from "@/lib/orders/types";
import { normalizeSearchKey } from "@/lib/formulas/types";
import type { WorkFormulaResolution } from "@/lib/formulas/work-formula-rules";
import {
  buildAutoPreparedOe,
  oeProcesoIniciado,
  workQuantityKg,
  type AutoPrepMpLots,
  type AutoPrepWork,
} from "@/lib/orders/oe-auto-prep-rules";

export class OeAutoPrepConflictError extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = "OeAutoPrepConflictError";
  }
}

export type OeAutoPrepActor = { email: string; sector: string };

export type OeAutoPrepOutcome =
  | { status: "applied"; orderId: string; orderNumber: string; version: number; autoPrep: OeAutoPrep }
  | { status: "unchanged"; orderId: string; orderNumber: string; autoPrep: OeAutoPrep | null }
  | { status: "skipped_started"; orderId: string; orderNumber: string; message: string }
  | { status: "skipped"; orderId: string; message: string };

export type PrepareOeOptions = {
  orderId: string;
  actor: OeAutoPrepActor;
  /** Motivo legible para la auditoría («Asignación», «Corrección del trabajo», «Actualización manual»…). */
  reason: string;
  /** Acción explícita del usuario: permite actualizar aunque la elaboración haya empezado y reemplazar MP a mano. */
  explicit?: boolean;
  /** Solo calcula (vista previa): no guarda. */
  dryRun?: boolean;
  /** Versión de la OE que vio el usuario en la vista previa: si cambió, no se aplica (409). */
  expectedVersion?: number;
  /** Para pruebas: inyecta la resolución de fórmula. */
  resolveFormula?: (args: { client: string; product: string }) => Promise<WorkFormulaResolution>;
};

type OrderRow = {
  id: string;
  orderNumber: string;
  type: string;
  status: string;
  formData: unknown;
  linkedWorkItemId: string | null;
  version: number;
};

async function defaultResolveFormula(args: { client: string; product: string }) {
  const { resolveFormulaForWork } = await import("@/lib/formulas/resolve-for-work");
  return resolveFormulaForWork(args);
}

async function loadWork(orderId: string, linkedWorkItemId: string | null): Promise<AutoPrepWork & { sector: string; status: string } | null> {
  const db = getDb();
  const cols = {
    id: workItems.id,
    version: workItems.version,
    product: workItems.product,
    client: workItems.client,
    plannedQuantity: workItems.plannedQuantity,
    unit: workItems.unit,
    packagingLote: workItems.packagingLote,
    sector: workItems.sector,
    status: workItems.status,
  };
  if (linkedWorkItemId?.trim()) {
    const [row] = await db.select(cols).from(workItems).where(eq(workItems.id, linkedWorkItemId.trim())).limit(1);
    if (row) return { ...row, sector: String(row.sector), status: String(row.status) };
  }
  // Sin vínculo principal: un solo trabajo apuntando a la OE. Con varios (reuso por Pedido+Producto+Lote) no se elige.
  const rows = await db.select(cols).from(workItems).where(eq(workItems.orderId, orderId)).limit(2);
  if (rows.length !== 1) return null;
  return { ...rows[0], sector: String(rows[0].sector), status: String(rows[0].status) };
}

/**
 * Lotes de MP asignados por Materias Primas para ESTA producción (solo lectura):
 *  1. Control semanal vinculado explícitamente a la OE (linked_oe_id);
 *  2. si no hay: el ÚNICO control activo y sin vincular del mismo cliente + producto (exactos) y la misma cantidad,
 *     que ninguna otra OE haya tomado. Con más de uno → ambiguo: no se elige.
 * Nunca se eligen lotes por disponibilidad de stock.
 */
export async function resolveMpLotsForOe(args: {
  orderId: string;
  client: string;
  product: string;
  quantityKg: number | null;
  /** Control que esta misma OE ya tomó en una preparación anterior (queda asociado aunque cambie la cantidad). */
  previousControlId?: string | null;
}): Promise<AutoPrepMpLots> {
  const db = getDb();
  const ACTIVE = sql`${mpWeeklyControls.status} in ('BORRADOR','COMPLETADO')`;
  const cols = { id: mpWeeklyControls.id, client: mpWeeklyControls.client, product: mpWeeklyControls.product, quantityKg: mpWeeklyControls.quantityKg };
  let controls: Array<{ id: string; client: string; product: string; quantityKg: number | null }>;
  try {
    controls = await db.select(cols).from(mpWeeklyControls).where(and(eq(mpWeeklyControls.linkedOeId, args.orderId), ACTIVE));
  } catch {
    return { status: "none", message: "No se pudo leer el Control semanal: los lotes de MP quedan pendientes." };
  }
  if (controls.length === 0 && args.previousControlId) {
    // Mismo control que ya usó esta OE, si sigue activo y es del mismo cliente + producto.
    const c = normalizeSearchKey(args.client);
    const p = normalizeSearchKey(args.product);
    const prev = await db.select(cols).from(mpWeeklyControls).where(and(eq(mpWeeklyControls.id, args.previousControlId), isNull(mpWeeklyControls.linkedOeId), ACTIVE));
    controls = prev.filter((r) => normalizeSearchKey(r.client) === c && normalizeSearchKey(r.product) === p);
  }
  if (controls.length > 1) {
    return { status: "ambiguous", message: `Hay ${controls.length} controles semanales vinculados a esta OE: los lotes de MP quedan pendientes hasta que Materias Primas deje uno.` };
  }
  if (controls.length === 0) {
    const c = normalizeSearchKey(args.client);
    const p = normalizeSearchKey(args.product);
    const unlinked = await db
      .select({ id: mpWeeklyControls.id, client: mpWeeklyControls.client, product: mpWeeklyControls.product, quantityKg: mpWeeklyControls.quantityKg })
      .from(mpWeeklyControls)
      .where(and(isNull(mpWeeklyControls.linkedOeId), ACTIVE));
    const same = unlinked.filter(
      (r) =>
        normalizeSearchKey(r.client) === c &&
        normalizeSearchKey(r.product) === p &&
        args.quantityKg != null &&
        r.quantityKg != null &&
        Math.abs(r.quantityKg - args.quantityKg) < 0.0005
    );
    if (same.length === 0) {
      return { status: "none", message: "No hay un Control semanal de Materias Primas para este producto y cantidad: los lotes de MP quedan pendientes." };
    }
    if (same.length > 1) {
      return { status: "ambiguous", message: `Hay ${same.length} controles semanales para este producto y cantidad: los lotes de MP quedan pendientes (vinculá el control a la OE).` };
    }
    const [taken] = await db
      .select({ orderNumber: operationalOrders.orderNumber })
      .from(operationalOrders)
      .where(
        and(
          ne(operationalOrders.id, args.orderId),
          isNull(operationalOrders.deletedAt),
          ne(operationalOrders.status, "ANULADA"),
          sql`${operationalOrders.formData}->'autoPrep'->'mpLots'->>'controlId' = ${same[0].id}`
        )
      )
      .limit(1);
    if (taken) {
      return { status: "none", message: `El Control semanal de este producto ya se usó para la ${taken.orderNumber}: los lotes de MP quedan pendientes.` };
    }
    controls = same;
  }
  const lines = await db
    .select({ codigo: mpWeeklyControlLines.codigo, materiaPrima: mpWeeklyControlLines.materiaPrima, lote: mpWeeklyControlLines.lote })
    .from(mpWeeklyControlLines)
    .where(eq(mpWeeklyControlLines.controlId, controls[0].id))
    .orderBy(mpWeeklyControlLines.sortOrder);
  const controlKg = controls[0].quantityKg;
  const mismatch =
    controlKg == null || args.quantityKg == null ? controlKg !== args.quantityKg : Math.abs(controlKg - args.quantityKg) >= 0.0005;
  return {
    status: "found",
    controlId: controls[0].id,
    lines,
    ...(mismatch ? { quantityMismatch: { controlKg, oeKg: args.quantityKg } } : {}),
  };
}

/** Prepara (o vuelve a preparar) la OE vinculada desde su trabajo. Idempotente. */
export async function prepareOeFromWork(opts: PrepareOeOptions): Promise<OeAutoPrepOutcome & { preview?: OeContent }> {
  const db = getDb();
  const [order] = (await db
    .select({
      id: operationalOrders.id,
      orderNumber: operationalOrders.orderNumber,
      type: operationalOrders.type,
      status: operationalOrders.status,
      formData: operationalOrders.formData,
      linkedWorkItemId: operationalOrders.linkedWorkItemId,
      version: operationalOrders.version,
    })
    .from(operationalOrders)
    .where(and(eq(operationalOrders.id, opts.orderId), isNull(operationalOrders.deletedAt)))
    .limit(1)) as OrderRow[];
  if (!order) return { status: "skipped", orderId: opts.orderId, message: "OE no encontrada." };
  if (order.type !== "OE") return { status: "skipped", orderId: order.id, message: "La orden no es una OE." };
  if (order.status === "ANULADA" || order.status === "ARCHIVADA") {
    return { status: "skipped", orderId: order.id, message: "La OE está anulada o archivada." };
  }

  const work = await loadWork(order.id, order.linkedWorkItemId);
  if (!work) return { status: "skipped", orderId: order.id, message: "La OE no tiene un único trabajo vinculado." };
  if (work.sector !== "ELABORACION") return { status: "skipped", orderId: order.id, message: "El trabajo no es de Elaboración." };
  if (work.status === "CANCELADO") return { status: "skipped", orderId: order.id, message: "El trabajo está cancelado." };

  const started = oeProcesoIniciado(order.status, order.formData as OeContent);
  if (started.started && !opts.explicit) {
    if (!opts.dryRun) {
      await db.insert(orderAuditEvents).values({
        orderId: order.id,
        eventType: "OE_AUTOPREP_SKIPPED_STARTED",
        actor: opts.actor.email,
        actorSector: opts.actor.sector,
        metadata: { reason: opts.reason, why: started.reason, workItemId: work.id, workItemVersion: work.version },
      });
    }
    return {
      status: "skipped_started",
      orderId: order.id,
      orderNumber: order.orderNumber,
      message: `${started.reason} No se actualizó automáticamente: usá «Actualizar desde fórmula y lotes» para revisarlo.`,
    };
  }

  // Lecturas externas FUERA de la transacción (Drive puede tardar): fórmula y lotes de MP.
  const formula = await (opts.resolveFormula ?? defaultResolveFormula)({ client: work.client, product: work.product });
  const qty = workQuantityKg(work.plannedQuantity, work.unit);
  const mpLots = await resolveMpLotsForOe({
    orderId: order.id,
    client: work.client,
    product: work.product,
    quantityKg: qty.kg,
    previousControlId: (order.formData as OeContent | null)?.autoPrep?.mpLots.controlId ?? null,
  });

  return db.transaction(async (tx) => {
    const [locked] = (await tx
      .select({
        id: operationalOrders.id,
        orderNumber: operationalOrders.orderNumber,
        type: operationalOrders.type,
        status: operationalOrders.status,
        formData: operationalOrders.formData,
        linkedWorkItemId: operationalOrders.linkedWorkItemId,
        version: operationalOrders.version,
      })
      .from(operationalOrders)
      .where(eq(operationalOrders.id, order.id))
      .for("update")) as OrderRow[];
    if (opts.expectedVersion != null && locked.version !== opts.expectedVersion) {
      throw new OeAutoPrepConflictError("Otra persona modificó la OE mientras revisabas los cambios. Volvé a abrir la vista previa.");
    }
    const content = locked.formData as OeContent;
    if (!content || content.kind !== "OE") {
      return { status: "skipped" as const, orderId: order.id, message: "La OE no tiene contenido válido." };
    }
    // Revalidar con la fila bloqueada: entre la lectura y el bloqueo pudo empezar la elaboración.
    const startedNow = oeProcesoIniciado(locked.status, content);
    if (startedNow.started && !opts.explicit) {
      return {
        status: "skipped_started" as const,
        orderId: order.id,
        orderNumber: locked.orderNumber,
        message: `${startedNow.reason} No se actualizó automáticamente.`,
      };
    }

    const built = buildAutoPreparedOe({
      content,
      work,
      formula,
      mpLots,
      actorEmail: opts.actor.email,
      reason: opts.reason,
      now: new Date().toISOString(),
      replaceManual: Boolean(opts.explicit),
    });
    if (built.lostRecords.length > 0) {
      return {
        status: "skipped" as const,
        orderId: order.id,
        message: `La fórmula actual no incluye materias primas con ajustes ya registrados (${built.lostRecords.join(", ")}): no se actualizó para no perder esos registros. Revisalo a mano.`,
      };
    }
    if (opts.dryRun) {
      return {
        status: built.changed ? ("applied" as const) : ("unchanged" as const),
        orderId: order.id,
        orderNumber: locked.orderNumber,
        version: locked.version,
        autoPrep: built.content.autoPrep!,
        preview: built.content,
      };
    }
    if (!built.changed) {
      return { status: "unchanged" as const, orderId: order.id, orderNumber: locked.orderNumber, autoPrep: content.autoPrep ?? null };
    }

    const nextVersion = locked.version + 1;
    const now = new Date();
    const fc = built.formulaColumns;
    const uuidOrNull = (v: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null;
    await tx
      .update(operationalOrders)
      .set({
        formData: built.content,
        product: built.content.header.productName,
        client: built.content.header.client,
        lot: built.content.header.lot,
        code: built.content.header.code,
        completionPercentage: computeCompletionPercentage(built.content),
        ...(fc.kind === "set"
          ? {
              // Columnas uuid: solo ids del banco. Drive queda referenciado por el hash y en autoPrep.formula.
              formulaProductId: uuidOrNull(fc.formulaProductId),
              formulaVersionId: uuidOrNull(fc.formulaVersionId),
              formulaVersionHash: fc.versionHash,
            }
          : fc.kind === "clear"
            ? { formulaProductId: null, formulaVersionId: null, formulaVersionHash: null }
            : {}),
        updatedBy: opts.actor.email,
        updatedAt: now,
        version: nextVersion,
      })
      .where(and(eq(operationalOrders.id, order.id), eq(operationalOrders.version, locked.version)));

    const ap = built.content.autoPrep!;
    await tx.insert(orderVersions).values({
      id: randomUUID(),
      orderId: order.id,
      version: nextVersion,
      snapshot: { formData: built.content, status: locked.status },
      event: opts.explicit ? "autoprep_manual" : "autoprep",
      reason: opts.reason,
      createdBy: opts.actor.email,
      createdAt: now,
    });
    await tx.insert(orderAuditEvents).values({
      orderId: order.id,
      eventType: opts.explicit ? "OE_AUTOPREP_MANUAL_REFRESH" : "OE_AUTOPREP_APPLIED",
      actor: opts.actor.email,
      actorSector: opts.actor.sector,
      metadata: {
        reason: opts.reason,
        orderNumber: locked.orderNumber,
        workItemId: work.id,
        workItemVersion: work.version,
        startedBefore: startedNow.started,
        // Referencias, no el contenido de la fórmula.
        formula: {
          status: ap.formula.status,
          source: ap.formula.source ?? null,
          formulaVersionId: ap.formula.formulaVersionId ?? null,
          versionHash: ap.formula.versionHash ?? null,
          driveFileId: ap.formula.driveFileId ?? null,
        },
        lotFabricacion: ap.lotFabricacion,
        quantity: ap.quantity,
        mpLots: { status: ap.mpLots.status, controlId: ap.mpLots.controlId ?? null, lines: ap.mpLots.lines },
        previousMpLots: content.materials.map((m) => ({ codigo: m.codigo, lote: m.lote })),
        pendientes: ap.pendientes,
      },
    });

    return { status: "applied" as const, orderId: order.id, orderNumber: locked.orderNumber, version: nextVersion, autoPrep: ap };
  });
}

/**
 * Después de una asignación o una corrección del trabajo: prepara la OE sin hacer fallar la operación que ya se
 * guardó. Un error queda informado (la OE sigue como estaba y se puede reintentar con la acción manual).
 */
export async function prepareOeAfterWorkChange(
  orderId: string | null | undefined,
  actor: OeAutoPrepActor,
  reason: string
): Promise<OeAutoPrepOutcome | { status: "error"; orderId: string; message: string } | null> {
  if (!orderId) return null;
  try {
    return await prepareOeFromWork({ orderId, actor, reason });
  } catch (err) {
    console.error("[oe-auto-prep] no se pudo preparar la OE", { orderId, error: err instanceof Error ? err.message : String(err) });
    return { status: "error", orderId, message: "No se pudo completar la OE automáticamente. Reintentá con «Actualizar desde fórmula y lotes»." };
  }
}

/** Resumen para la respuesta HTTP (sin contenido de la fórmula). */
export function summarizeOePrep(
  outcome: OeAutoPrepOutcome | { status: "error"; orderId: string; message: string }
): { status: string; message: string | null; pendientes: string[]; formula: string | null } {
  if (outcome.status === "applied" || outcome.status === "unchanged") {
    const ap = outcome.autoPrep;
    return {
      status: outcome.status,
      message: ap ? (ap.pendientes.length ? "OE preparada con datos pendientes." : "OE preparada completa.") : null,
      pendientes: ap?.pendientes ?? [],
      formula: ap?.formula.status ?? null,
    };
  }
  return { status: outcome.status, message: outcome.message, pendientes: [], formula: null };
}
