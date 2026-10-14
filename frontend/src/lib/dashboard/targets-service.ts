import "server-only";

/**
 * Objetivos del semáforo (tabla dashboard_kpi_targets, migración 0046).
 * Lectura: la ven todos los sectores (solo el número y el sentido). Escritura: SOLO Producción/Dirección.
 * Cada cambio queda en feature_audit_events (dominio 'dashboard'). No hay objetivos por defecto.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { isFeatureMemoryAllowed } from "@/lib/db/feature-schema";
import { isMissingSchemaError } from "@/lib/db/missing-schema";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";
import { TARGETABLE_INDICATORS, isTargetableKey } from "./kpi-definitions";
import { resolveDashboardPermissions } from "./permissions";
import { validateTargetInput } from "./semaforo";
import type { DashboardTarget } from "./types";

export class DashboardSchemaPendingError extends Error {
  readonly code = "DASHBOARD_SCHEMA_PENDING" as const;
  constructor() {
    super("Los objetivos del Dashboard no se pueden guardar todavía: falta aplicar la migración 0046 en la base.");
    this.name = "DashboardSchemaPendingError";
  }
}

export type DashboardActor = { email: string; sector: string };

type AuditEntry = { action: string; actorEmail: string; actorSector: string; key: string; payload: Record<string, unknown> };
type Mem = { targets: Map<string, DashboardTarget>; audit: AuditEntry[] };
const g = globalThis as unknown as { __genusDashboardTargetsMem?: Mem };
function mem(): Mem {
  if (!g.__genusDashboardTargetsMem) g.__genusDashboardTargetsMem = { targets: new Map(), audit: [] };
  return g.__genusDashboardTargetsMem;
}
export function resetDashboardTargetsMemoryForTests(): void {
  g.__genusDashboardTargetsMem = undefined;
}
/** Auditoría en memoria (solo para pruebas). */
export function dashboardMemoryAuditForTests(): AuditEntry[] {
  return mem().audit;
}

function mapRow(r: Record<string, unknown>): DashboardTarget {
  const key = String(r.key);
  const unit = isTargetableKey(key) ? TARGETABLE_INDICATORS[key].unit : "count";
  return {
    key,
    targetValue: Number(r.target_value),
    direction: String(r.direction) === "max" ? "max" : "min",
    unit,
    updatedBy: String(r.updated_by ?? ""),
    updatedAt: new Date(String(r.updated_at)).toISOString(),
  };
}

function assertCanEdit(actor: DashboardActor): void {
  if (!resolveDashboardPermissions(actor.sector).canEditTargets) {
    throw new OrdersForbiddenError("Solo Producción y Dirección pueden definir los objetivos del Dashboard.");
  }
}

export async function listDashboardTargets(): Promise<{ targets: DashboardTarget[]; schemaPending: boolean }> {
  if (isDatabaseConfigured()) {
    try {
      const res = await getDb().execute(
        sql`select key, target_value, direction, updated_by, updated_at from dashboard_kpi_targets order by key`
      );
      return { targets: (res.rows as Record<string, unknown>[]).map(mapRow), schemaPending: false };
    } catch (err) {
      if (isMissingSchemaError(err)) return { targets: [], schemaPending: true };
      throw err;
    }
  }
  if (isFeatureMemoryAllowed()) return { targets: [...mem().targets.values()], schemaPending: false };
  return { targets: [], schemaPending: false };
}

export async function setDashboardTarget(
  actor: DashboardActor,
  input: { key: string; value: unknown; direction: unknown }
): Promise<DashboardTarget> {
  assertCanEdit(actor);
  if (!isTargetableKey(input.key)) throw new OrdersValidationError("Indicador desconocido para objetivo.");
  const meta = TARGETABLE_INDICATORS[input.key];
  const problem = validateTargetInput({ value: input.value, direction: input.direction, unit: meta.unit });
  if (problem) throw new OrdersValidationError(problem);
  const value = input.value as number;
  const direction = input.direction as "min" | "max";

  if (isDatabaseConfigured()) {
    try {
      const db = getDb();
      return await db.transaction(async (tx) => {
        const prev = await tx.execute(sql`select target_value, direction from dashboard_kpi_targets where key = ${input.key}`);
        const prevRow = (prev.rows as Record<string, unknown>[])[0];
        const res = await tx.execute(sql`
          insert into dashboard_kpi_targets (key, target_value, direction, unit, updated_by, updated_at)
          values (${input.key}, ${value}, ${direction}, ${meta.unit}, ${actor.email}, now())
          on conflict (key) do update set
            target_value = excluded.target_value, direction = excluded.direction, unit = excluded.unit,
            updated_by = excluded.updated_by, updated_at = now()
          returning key, target_value, direction, updated_by, updated_at
        `);
        await tx.execute(sql`
          insert into feature_audit_events (id, domain, action, actor_email, actor_sector, entity_id, idempotency_key, payload, created_at)
          values (${randomUUID()}::uuid, 'dashboard', 'target_set', ${actor.email}, ${actor.sector}, ${input.key}, null,
            ${JSON.stringify({
              key: input.key,
              previous: prevRow ? { targetValue: Number(prevRow.target_value), direction: String(prevRow.direction) } : null,
              next: { targetValue: value, direction },
            })}::jsonb, now())
        `);
        return mapRow((res.rows as Record<string, unknown>[])[0]);
      });
    } catch (err) {
      if (isMissingSchemaError(err)) throw new DashboardSchemaPendingError();
      throw err;
    }
  }
  if (!isFeatureMemoryAllowed()) throw new DashboardSchemaPendingError();
  const m = mem();
  const prev = m.targets.get(input.key);
  const next: DashboardTarget = {
    key: input.key,
    targetValue: value,
    direction,
    unit: meta.unit,
    updatedBy: actor.email,
    updatedAt: new Date().toISOString(),
  };
  m.targets.set(input.key, next);
  m.audit.push({
    action: "target_set",
    actorEmail: actor.email,
    actorSector: actor.sector,
    key: input.key,
    payload: { key: input.key, previous: prev ? { targetValue: prev.targetValue, direction: prev.direction } : null, next: { targetValue: value, direction } },
  });
  return next;
}

/** Quita el objetivo (el indicador vuelve a «Sin objetivo definido»). */
export async function clearDashboardTarget(actor: DashboardActor, key: string): Promise<void> {
  assertCanEdit(actor);
  if (!isTargetableKey(key)) throw new OrdersValidationError("Indicador desconocido para objetivo.");
  if (isDatabaseConfigured()) {
    try {
      const db = getDb();
      await db.transaction(async (tx) => {
        const prev = await tx.execute(sql`delete from dashboard_kpi_targets where key = ${key} returning target_value, direction`);
        const prevRow = (prev.rows as Record<string, unknown>[])[0];
        if (!prevRow) return;
        await tx.execute(sql`
          insert into feature_audit_events (id, domain, action, actor_email, actor_sector, entity_id, idempotency_key, payload, created_at)
          values (${randomUUID()}::uuid, 'dashboard', 'target_cleared', ${actor.email}, ${actor.sector}, ${key}, null,
            ${JSON.stringify({ key, previous: { targetValue: Number(prevRow.target_value), direction: String(prevRow.direction) } })}::jsonb, now())
        `);
      });
      return;
    } catch (err) {
      if (isMissingSchemaError(err)) throw new DashboardSchemaPendingError();
      throw err;
    }
  }
  if (!isFeatureMemoryAllowed()) throw new DashboardSchemaPendingError();
  const m = mem();
  const prev = m.targets.get(key);
  if (!prev) return;
  m.targets.delete(key);
  m.audit.push({
    action: "target_cleared",
    actorEmail: actor.email,
    actorSector: actor.sector,
    key,
    payload: { key, previous: { targetValue: prev.targetValue, direction: prev.direction } },
  });
}
