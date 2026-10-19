import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { featureAuditEvents, workItems } from "@/lib/db/schema";
import { classifyPendingDefinition, type PendingDefinitionAction } from "@/lib/planning/circuit/pending-definition";
import { recordDeliveryInTx } from "@/lib/planning/circuit/delivery-core";
import { resolveDeliveryTarget } from "@/lib/planning/circuit/delivery-math";
import { emitCircuitNotification } from "@/lib/planning/circuit/circuit-notifications";
import type { CircuitMovement } from "@/lib/planning/circuit/movements";
import { handoffToCodificadoInTx } from "@/lib/planning/codificado-handoff-service";
import { nativeIdFromItemId } from "@/lib/planning/work-item-progress-repository";
import {
  PlanningConflictError,
  PlanningForbiddenError,
  PlanningNotFoundError,
  PlanningValidationError,
  type PlanningActor,
} from "@/lib/planning/types";
import {
  BULK_ACTION_MAX_ITEMS,
  BULK_ACTION_REASON,
  type BulkActionResult,
  type BulkActionVerdict,
  type BulkPendingAction,
} from "@/features/os/operational/lib/bulk-action-verdicts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sentinela: en vista previa se ejecuta el flujo REAL y se revierte todo, así la previa nunca difiere de la acción. */
class DryRunRollback extends Error {}

export interface BulkItemInput {
  id: string;
  /** Solo Codificado: cantidad total a enviar (se propone la del trabajo y se puede ajustar por fila). */
  totalUnits?: number | null;
}

export interface BulkPendingActionInput {
  action: BulkPendingAction;
  items: BulkItemInput[];
  actor: PlanningActor;
  dryRun?: boolean;
  batchKey?: string;
  /** DELIVER: datos comunes de la entrega. */
  delivery?: {
    actualDeliveredAt?: string | null;
    remito?: string | null;
    receivedBy?: string | null;
    observations?: string | null;
  };
  /** SEND_CODIFICADO: observación común. */
  observation?: string | null;
}

const ACTION_FOR: Record<BulkPendingAction, PendingDefinitionAction> = {
  DELIVER: "REGISTRAR_ENTREGA",
  SEND_CODIFICADO: "ENVIAR_A_CODIFICADO",
};

function isBusinessRejection(err: unknown): err is Error {
  return (
    err instanceof PlanningValidationError ||
    err instanceof PlanningForbiddenError ||
    err instanceof PlanningNotFoundError ||
    err instanceof PlanningConflictError
  );
}

/**
 * Acciones masivas de «Pendientes de definir» que REUTILIZAN el flujo individual, función por función:
 *  - DELIVER → recordDeliveryInTx (mismo que «Registrar entrega»: permisos, saldo, estado, línea de entrega,
 *    cierre del pedido, evento WORK_DELIVERED). Entrega TODO el saldo de cada trabajo.
 *  - SEND_CODIFICADO → handoffToCodificadoInTx (mismo cuerpo que «Enviar a Codificado»).
 *
 * Una sola transacción exterior; cada trabajo corre en su propio SAVEPOINT: un rechazo de negocio (estado,
 * cantidad, permiso) deja ESE trabajo intacto y se informa con su motivo, sin afectar a los demás; cualquier error
 * inesperado revierte el lote completo. No toca inventario ni consumos de MP (igual que el flujo individual).
 * Idempotente: batchKey (auditoría del lote) + clave determinística por trabajo.
 */
export async function runBulkPendingAction(input: BulkPendingActionInput): Promise<BulkActionResult> {
  const sector = String(input.actor.sector ?? "").toUpperCase();
  if (sector !== "PRODUCCION" && sector !== "DIRECCION") {
    throw new PlanningForbiddenError("Solo Producción o Dirección pueden operar los pendientes de definir.");
  }
  const dryRun = Boolean(input.dryRun);
  const items = [...new Map(input.items.map((i) => [i.id, i])).values()];
  if (items.length === 0) throw new PlanningValidationError("No hay trabajos seleccionados.");
  if (items.length > BULK_ACTION_MAX_ITEMS) {
    throw new PlanningValidationError(`Se pueden procesar hasta ${BULK_ACTION_MAX_ITEMS} trabajos por operación.`);
  }
  const batchKey = input.batchKey?.trim() || null;
  if (!dryRun && !batchKey) throw new PlanningValidationError("Falta la clave de la operación (batchKey).");
  if (batchKey && (batchKey.length < 8 || batchKey.length > 80)) {
    throw new PlanningValidationError("batchKey inválida (8–80).");
  }
  const auditAction = input.action === "DELIVER" ? "BULK_DELIVER" : "BULK_SEND_CODIFICADO";
  const movements: CircuitMovement[] = [];
  const db = getDb();

  let result: BulkActionResult;
  try {
    result = await db.transaction(async (tx): Promise<BulkActionResult> => {
      if (!dryRun && batchKey) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`genus-bulk-pending:${auditAction}:${batchKey}`}))`);
        const [prior] = await tx
          .select({ payload: featureAuditEvents.payload })
          .from(featureAuditEvents)
          .where(
            and(
              eq(featureAuditEvents.domain, "work_items"),
              eq(featureAuditEvents.action, auditAction),
              eq(featureAuditEvents.idempotencyKey, batchKey)
            )
          )
          .limit(1);
        const stored = (prior?.payload as { result?: BulkActionResult } | undefined)?.result;
        if (stored) return { ...stored, replayed: true };
      }

      const verdicts: BulkActionVerdict[] = [];
      const succeeded: string[] = [];

      for (const entry of items) {
        const native = nativeIdFromItemId(entry.id);
        if (!native || !UUID_RE.test(native)) {
          verdicts.push({ id: entry.id, code: "INVALID_ID", reason: BULK_ACTION_REASON.INVALID_ID });
          continue;
        }
        try {
          const v = await tx.transaction(async (sp) => {
            const [row] = await sp.select().from(workItems).where(eq(workItems.id, native)).for("update").limit(1);
            if (!row) return { code: "NOT_FOUND" as const, reason: BULK_ACTION_REASON.NOT_FOUND };
            const base = { product: row.product, client: row.client };
            const info = classifyPendingDefinition({
              sector: row.sector,
              operationalStatus: row.operationalStatus,
              completedAt: row.completedAt ? row.completedAt.toISOString() : null,
              qualityStatus: row.qualityStatus,
              deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
              viaCodificado: row.viaCodificado,
              codificadoCancelledAt: row.codificadoCancelledAt ? row.codificadoCancelledAt.toISOString() : null,
            });
            if (!info.pending) return { code: "NOT_PENDING" as const, reason: BULK_ACTION_REASON.NOT_PENDING, ...base };
            if (!info.actions.includes(ACTION_FOR[input.action])) {
              return { code: "ACTION_NOT_ALLOWED" as const, reason: BULK_ACTION_REASON.ACTION_NOT_ALLOWED, ...base };
            }
            const itemKey = `${batchKey ?? "preview"}:${native}`;

            if (input.action === "DELIVER") {
              const r = await recordDeliveryInTx(sp, {
                workItemId: native,
                actor: {
                  email: input.actor.email,
                  sector,
                  displayName: input.actor.displayName || input.actor.email,
                },
                idempotencyKey: itemKey,
                quantity: null, // todo el saldo, como el botón individual con la cantidad por defecto
                plannedDeliveryDate: row.deliveryDate ?? null,
                actualDeliveredAt: input.delivery?.actualDeliveredAt ?? new Date().toISOString(),
                remito: input.delivery?.remito ?? null,
                receivedBy: input.delivery?.receivedBy ?? null,
                observations: input.delivery?.observations ?? null,
              });
              if (r.movement) movements.push(r.movement);
              return {
                code: "ELIGIBLE" as const,
                reason: "",
                ...base,
                replayed: r.replayed,
                outcome: r.complete
                  ? `Entrega completa${r.delivered != null ? `: ${r.delivered} ${row.unit ?? ""}`.trimEnd() : ""}`
                  : `Entrega parcial (saldo ${r.pending ?? "—"})`,
              };
            }

            // SEND_CODIFICADO
            const total =
              entry.totalUnits ??
              resolveDeliveryTarget({
                unit: row.unit,
                deliverableUnits: row.deliverableUnits,
                packagingTotalUnits: row.packagingTotalUnits,
                finishedQty: row.finishedQty,
                plannedQuantity: row.plannedQuantity,
              });
            if (total == null || !Number.isFinite(total) || total <= 0) {
              throw new PlanningValidationError(
                "No hay una cantidad total determinable: indicá la cantidad o usá el botón individual."
              );
            }
            const r = await handoffToCodificadoInTx(
              sp as never,
              {
                workItemId: native,
                totalUnits: total,
                observation: input.observation ?? null,
                expectedVersion: null,
                idempotencyKey: `bulk-${itemKey}`.slice(0, 128),
              },
              input.actor,
              batchKey ?? "preview"
            );
            if (!r.replayed) {
              movements.push({
                type: "ENVASADO_A_CODIFICADO",
                workItemId: native,
                eventKey: `bulk-${itemKey}`.slice(0, 128),
                fromSector: r.item.codificadoOriginSector ?? row.sector,
                toSector: "CODIFICADO",
                client: r.item.client,
                product: r.item.product,
                quantity: total,
                unit: r.item.unit,
                lote: r.item.packagingLote ?? null,
                at: new Date(),
                actorName: input.actor.displayName || input.actor.email,
                actorEmail: input.actor.email,
              });
            }
            return {
              code: "ELIGIBLE" as const,
              reason: "",
              ...base,
              replayed: r.replayed,
              outcome: `Queda disponible en Codificado (${total} ${row.unit ?? ""})`.replace(" )", ")"),
            };
          });
          verdicts.push({ id: entry.id, ...v });
          if (v.code === "ELIGIBLE") succeeded.push(entry.id);
        } catch (err) {
          if (!isBusinessRejection(err)) throw err; // inesperado → revierte TODO el lote
          verdicts.push({ id: entry.id, code: "REJECTED", reason: err.message });
        }
      }

      const out: BulkActionResult = {
        action: input.action,
        dryRun,
        batchKey,
        requested: items.length,
        succeeded,
        verdicts,
      };
      if (dryRun) throw Object.assign(new DryRunRollback(), { out });
      await tx.insert(featureAuditEvents).values({
        domain: "work_items",
        action: auditAction,
        actorEmail: input.actor.email,
        actorSector: sector,
        entityId: null,
        idempotencyKey: batchKey,
        payload: {
          requested: items.length,
          succeededCount: succeeded.length,
          succeeded,
          delivery: input.action === "DELIVER" ? input.delivery ?? null : undefined,
          observation: input.action === "SEND_CODIFICADO" ? input.observation ?? null : undefined,
          result: out,
        },
      });
      return out;
    });
  } catch (err) {
    if (err instanceof DryRunRollback) return (err as unknown as { out: BulkActionResult }).out;
    throw err;
  }

  // Avisos FUERA de la transacción: un fallo de la notificación nunca bloquea la operación (ids determinísticos).
  if (!result.replayed) {
    for (const m of movements) {
      try {
        await emitCircuitNotification(m);
      } catch (e) {
        console.error("[bulk] aviso de circuito falló", e);
      }
    }
  }
  return result;
}
