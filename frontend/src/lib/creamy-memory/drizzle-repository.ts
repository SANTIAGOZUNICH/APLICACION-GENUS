import "server-only";

import { and, desc, eq, ilike, isNull, ne, or } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  creamyMemoryAuditEvents,
  creamyMemoryEvidence,
  creamyOperationalMemories,
  creamyUserMemories,
} from "@/lib/creamy-memory/schema";
import type { CreamyMemoryRepository } from "@/lib/creamy-memory/repository";
import { normalizeMemoryKey } from "@/lib/creamy-memory/sanitize";
import type {
  CreamyMemoryAuditEvent, CreamyMemoryEvidence, CreamyOperationalMemory, CreamyUserMemory,
} from "@/lib/creamy-memory/types";

const iso = (value: Date | null) => value?.toISOString() ?? null;
const asDate = (value: string | null | undefined) => (value ? new Date(value) : null);

function operationalKey(row: Pick<typeof creamyOperationalMemories.$inferSelect, "client" | "product" | "materiaPrimaOriginal" | "materiaPrimaUtilizada">): string {
  return normalizeMemoryKey(`${row.client}|${row.product}|${row.materiaPrimaOriginal}|${row.materiaPrimaUtilizada}`);
}

function user(row: typeof creamyUserMemories.$inferSelect): CreamyUserMemory {
  return { ...row, userId: row.userId, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), lastUsedAt: iso(row.lastUsedAt), sourceConversationId: row.sourceConversationId };
}
function operational(row: typeof creamyOperationalMemories.$inferSelect): CreamyOperationalMemory {
  return {
    ...row,
    fecha: row.fecha,
    productCode: row.productCode,
    codigoMpOriginal: row.codigoMpOriginal,
    codigoMpUtilizado: row.codigoMpUtilizado,
    observacion: row.observacion,
    cantidadOProporcion: row.cantidadOProporcion,
    relatedOrderRef: row.relatedOrderRef,
    relatedOrderId: row.relatedOrderId,
    validadoPor: row.validadoPor,
    evidenceId: row.evidenceId,
    normalizedKey: operationalKey(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  } as CreamyOperationalMemory;
}
function evidence(row: typeof creamyMemoryEvidence.$inferSelect): CreamyMemoryEvidence {
  return { ...row, payload: row.payload as Record<string, unknown>, createdAt: row.createdAt.toISOString() };
}
function audit(row: typeof creamyMemoryAuditEvents.$inferSelect): CreamyMemoryAuditEvent {
  return { ...row, actorSector: row.actorSector ?? "", detail: row.detail as Record<string, unknown>, createdAt: row.createdAt.toISOString() } as CreamyMemoryAuditEvent;
}

/** Durable 0015/0017 storage. First database error intentionally bubbles so callers can fall back. */
export class DrizzleCreamyMemoryRepository implements CreamyMemoryRepository {
  private db() { return getDb(); }
  private owner(owner: { userEmail: string; userId?: string }) {
    const email = owner.userEmail.trim().toLowerCase();
    // Prefer userId when present on both sides; still allow 0015 rows that only have email.
    if (owner.userId) {
      return or(
        eq(creamyUserMemories.userId, owner.userId),
        and(isNull(creamyUserMemories.userId), eq(creamyUserMemories.userEmail, email))
      )!;
    }
    return eq(creamyUserMemories.userEmail, email);
  }
  async findUserMemoryByKey(ownerKey: { userEmail: string; userId?: string }, normalizedKey: string) {
    const [row] = await this.db().select().from(creamyUserMemories).where(and(this.owner(ownerKey), eq(creamyUserMemories.normalizedKey, normalizedKey), eq(creamyUserMemories.status, "active"))).limit(1);
    return row ? user(row) : null;
  }
  async getUserMemory(id: string) { const [row] = await this.db().select().from(creamyUserMemories).where(eq(creamyUserMemories.id, id)).limit(1); return row ? user(row) : null; }
  async insertUserMemory(record: CreamyUserMemory) {
    const [row] = await this.db().insert(creamyUserMemories).values({ ...record, userEmail: record.userEmail.trim().toLowerCase(), createdAt: new Date(record.createdAt), updatedAt: new Date(record.updatedAt), lastUsedAt: asDate(record.lastUsedAt), sourceConversationId: record.sourceConversationId }).returning();
    return user(row);
  }
  async updateUserMemory(id: string, patch: Partial<CreamyUserMemory>) {
    const [row] = await this.db().update(creamyUserMemories).set({ ...patch, createdAt: patch.createdAt ? new Date(patch.createdAt) : undefined, updatedAt: patch.updatedAt ? new Date(patch.updatedAt) : undefined, lastUsedAt: patch.lastUsedAt === undefined ? undefined : asDate(patch.lastUsedAt) }).where(eq(creamyUserMemories.id, id)).returning();
    return row ? user(row) : null;
  }
  async listUserMemories(ownerKey: { userEmail: string; userId?: string }) {
    return (await this.db().select().from(creamyUserMemories).where(and(this.owner(ownerKey), eq(creamyUserMemories.status, "active"))).orderBy(desc(creamyUserMemories.updatedAt))).map(user);
  }
  async findOperationalMemoryByKey(normalizedKey: string) {
    // 0015 has no normalized_key column on operational memories; dedupe in-app.
    const rows = await this.db()
      .select()
      .from(creamyOperationalMemories)
      .where(and(eq(creamyOperationalMemories.status, "active"), ne(creamyOperationalMemories.estado, "REVOCADA")))
      .orderBy(desc(creamyOperationalMemories.updatedAt))
      .limit(500);
    const row = rows.find((item) => operationalKey(item) === normalizedKey);
    return row ? operational(row) : null;
  }
  async getOperationalMemory(id: string) { const [row] = await this.db().select().from(creamyOperationalMemories).where(eq(creamyOperationalMemories.id, id)).limit(1); return row ? operational(row) : null; }
  async insertOperationalMemory(record: CreamyOperationalMemory) {
    const { normalizedKey: _ignored, ...values } = record;
    const [row] = await this.db().insert(creamyOperationalMemories).values({
      ...values,
      fecha: record.fecha,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt),
    }).returning();
    return operational(row);
  }
  async updateOperationalMemory(id: string, patch: Partial<CreamyOperationalMemory>) {
    const { normalizedKey: _ignored, ...rest } = patch;
    const [row] = await this.db().update(creamyOperationalMemories).set({
      ...rest,
      createdAt: patch.createdAt ? new Date(patch.createdAt) : undefined,
      updatedAt: patch.updatedAt ? new Date(patch.updatedAt) : undefined,
    }).where(eq(creamyOperationalMemories.id, id)).returning();
    return row ? operational(row) : null;
  }
  async listOperationalMemories(filter: { client?: string; product?: string; productCode?: string }) {
    const conditions = [eq(creamyOperationalMemories.status, "active")];
    if (filter.client) conditions.push(ilike(creamyOperationalMemories.client, `%${filter.client.trim()}%`));
    if (filter.product) conditions.push(ilike(creamyOperationalMemories.product, `%${filter.product.trim()}%`));
    if (filter.productCode) conditions.push(ilike(creamyOperationalMemories.productCode, `%${filter.productCode.trim()}%`));
    return (await this.db().select().from(creamyOperationalMemories).where(and(...conditions)).orderBy(desc(creamyOperationalMemories.updatedAt))).map(operational);
  }
  async insertEvidence(record: CreamyMemoryEvidence) { const [row] = await this.db().insert(creamyMemoryEvidence).values({ ...record, payload: record.payload, createdAt: new Date(record.createdAt) }).returning(); return evidence(row); }
  async listEvidence(operationalMemoryId: string) { return (await this.db().select().from(creamyMemoryEvidence).where(eq(creamyMemoryEvidence.operationalMemoryId, operationalMemoryId))).map(evidence); }
  async insertAuditEvent(record: CreamyMemoryAuditEvent) { const [row] = await this.db().insert(creamyMemoryAuditEvents).values({ ...record, detail: record.detail, createdAt: new Date(record.createdAt) }).returning(); return audit(row); }
  async listAuditEvents(entityType: string, entityId: string) { return (await this.db().select().from(creamyMemoryAuditEvents).where(and(eq(creamyMemoryAuditEvents.entityType, entityType), eq(creamyMemoryAuditEvents.entityId, entityId)))).map(audit); }
}
