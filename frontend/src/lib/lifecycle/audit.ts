import { randomUUID } from "node:crypto";
import type { LifecycleAction, LifecycleActor, LifecycleEntityKind } from "./policy";
import { normalizeOptionalReason } from "./reason";

export type LifecycleAuditEvent = {
  id: string;
  entityKind: LifecycleEntityKind;
  entityId: string;
  action: LifecycleAction | string;
  actorEmail: string;
  actorSector: string;
  reason: string;
  impactJson: unknown;
  createdAt: string;
};

type Mem = { events: LifecycleAuditEvent[] };
const g = globalThis as unknown as { __genusLifecycleAudit?: Mem };

function store(): Mem {
  if (!g.__genusLifecycleAudit) g.__genusLifecycleAudit = { events: [] };
  return g.__genusLifecycleAudit;
}

/** Auditoría en memoria (+ futura tabla lifecycle_audit_events vía migración 0010). */
export function recordLifecycleEvent(params: {
  entityKind: LifecycleEntityKind;
  entityId: string;
  action: LifecycleAction | string;
  actor: LifecycleActor;
  reason?: string | null;
  impact?: unknown;
}): LifecycleAuditEvent {
  const event: LifecycleAuditEvent = {
    id: randomUUID(),
    entityKind: params.entityKind,
    entityId: params.entityId,
    action: params.action,
    actorEmail: params.actor.email,
    actorSector: params.actor.sector,
    reason: normalizeOptionalReason(params.reason),
    impactJson: params.impact ?? null,
    createdAt: new Date().toISOString(),
  };
  store().events.push(event);
  return event;
}

export function listLifecycleAudit(entityId?: string): LifecycleAuditEvent[] {
  const all = store().events;
  if (!entityId) return [...all];
  return all.filter((e) => e.entityId === entityId);
}

export function clearLifecycleAuditForTests(): void {
  store().events = [];
}
