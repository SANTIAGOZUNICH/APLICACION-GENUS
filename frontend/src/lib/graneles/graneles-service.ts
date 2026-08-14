/**
 * Depósito Graneles — Neon (Production) o memoria de proceso (vitest / sin DATABASE_URL).
 * Migración 0014: tablas `deposito_graneles` + `deposito_graneles_audit`.
 */
import "server-only";

import { and, desc, eq, notInArray } from "drizzle-orm";
import { canAccessGraneles, canMutateGraneles, canUpsertGranelFromEnvasado } from "@/lib/graneles/graneles-rbac";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { depositoGraneles, depositoGranelesAudit } from "@/lib/db/schema";
import { normalizeOptionalReason } from "@/lib/lifecycle/reason";
import { OrdersForbiddenError, OrdersNotFoundError, OrdersValidationError } from "@/lib/orders/types";
import type { SectorId } from "@/types/operational/sector";
import type {
  CreateManualGranelInput,
  DeleteOrAnnulResult,
  GranelAuditEntry,
  GranelRemainderRecord,
  GranelesActor,
  ListGranelesFilters,
  UpdateGranelInput,
  UpsertGranelFromEnvasadoInput,
  UpsertGranelResult,
} from "@/lib/graneles/types";
import { GRANEL_STATUSES, type GranelStatus } from "@/lib/graneles/types";

const ARCHIVED_STATUSES: GranelStatus[] = ["ANULADO", "ARCHIVADO"];

type Mem = { items: GranelRemainderRecord[]; audit: GranelAuditEntry[] };
const g = globalThis as unknown as { __genusGranelesMem?: Mem };

function mem(): Mem {
  if (!g.__genusGranelesMem) {
    g.__genusGranelesMem = { items: [], audit: [] };
  }
  return g.__genusGranelesMem;
}

export function resetGranelesMemoryForTests(): void {
  g.__genusGranelesMem = { items: [], audit: [] };
}

function isNeonBacked(): boolean {
  return isDatabaseConfigured();
}

function makeMemId(): string {
  return `gr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isSectorId(value: string | null): value is SectorId {
  return Boolean(value);
}

function asNumber(value: unknown): number {
  const n = typeof value === "string" ? Number.parseFloat(value) : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isValidStatus(value: string): value is GranelStatus {
  return (GRANEL_STATUSES as readonly string[]).includes(value);
}

function rowToDomain(row: typeof depositoGraneles.$inferSelect): GranelRemainderRecord {
  const status = isValidStatus(row.status) ? row.status : "DISPONIBLE";
  return {
    id: row.id,
    workItemId: row.workItemId,
    originSector: isSectorId(row.originSector) ? (row.originSector as SectorId) : null,
    product: row.product,
    client: row.client,
    bulkLot: row.bulkLot,
    kgAvailable: asNumber(row.kgAvailable),
    intakeDate: row.intakeDate,
    reportedBy: row.reportedBy,
    observation: row.observation,
    location: row.location,
    status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    annulledAt: row.annulledAt ? row.annulledAt.toISOString() : null,
    annulledBy: row.annulledBy,
    annulReason: row.annulReason,
  };
}

function domainToInsert(record: GranelRemainderRecord): typeof depositoGraneles.$inferInsert {
  return {
    id: record.id,
    workItemId: record.workItemId,
    originSector: record.originSector,
    product: record.product,
    client: record.client,
    bulkLot: record.bulkLot,
    kgAvailable: String(record.kgAvailable),
    intakeDate: record.intakeDate,
    reportedBy: record.reportedBy,
    observation: record.observation,
    location: record.location,
    status: record.status,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    annulledAt: record.annulledAt ? new Date(record.annulledAt) : null,
    annulledBy: record.annulledBy,
    annulReason: record.annulReason,
  };
}

function assertAccess(actor: GranelesActor): void {
  if (!canAccessGraneles(actor.sector)) {
    throw new OrdersForbiddenError(
      "Este módulo está habilitado solo para Depósito y sectores relacionados."
    );
  }
}

function assertMutate(actor: GranelesActor): void {
  if (!canMutateGraneles(actor.sector)) {
    throw new OrdersForbiddenError("Solo Depósito puede modificar sobrantes de granel.");
  }
}

function assertUpsertFromEnvasado(actor: GranelesActor): void {
  if (!canUpsertGranelFromEnvasado(actor.sector)) {
    throw new OrdersForbiddenError("Solo Envasado o Depósito pueden reportar sobrantes de granel.");
  }
}

function applyFilters(items: GranelRemainderRecord[], filters: ListGranelesFilters): GranelRemainderRecord[] {
  if (filters.status) {
    return items.filter((item) => item.status === filters.status);
  }
  if (filters.includeAnnulled) return items;
  return items.filter((item) => !ARCHIVED_STATUSES.includes(item.status));
}

function sortItems(items: GranelRemainderRecord[]): GranelRemainderRecord[] {
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function findActiveByWorkItemNeon(workItemId: string): Promise<GranelRemainderRecord | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(depositoGraneles)
    .where(
      and(eq(depositoGraneles.workItemId, workItemId), notInArray(depositoGraneles.status, ARCHIVED_STATUSES))
    );
  return rows[0] ? rowToDomain(rows[0]) : null;
}

function findActiveByWorkItemMem(workItemId: string): GranelRemainderRecord | null {
  return (
    mem().items.find(
      (item) => item.workItemId === workItemId && !ARCHIVED_STATUSES.includes(item.status)
    ) ?? null
  );
}

async function writeAudit(entry: Omit<GranelAuditEntry, "id" | "createdAt">): Promise<void> {
  const now = new Date();
  if (isNeonBacked()) {
    const db = getDb();
    await db.insert(depositoGranelesAudit).values({
      granelId: entry.granelId,
      action: entry.action,
      actorSector: entry.actorSector,
      actorName: entry.actorName,
      reason: entry.reason,
      beforeKg: entry.beforeKg != null ? String(entry.beforeKg) : null,
      afterKg: entry.afterKg != null ? String(entry.afterKg) : null,
      createdAt: now,
    });
    return;
  }
  mem().audit.unshift({
    ...entry,
    id: makeMemId(),
    createdAt: now.toISOString(),
  });
}

export class GranelesService {
  async list(actor: GranelesActor, filters: ListGranelesFilters = {}): Promise<GranelRemainderRecord[]> {
    assertAccess(actor);
    if (isNeonBacked()) {
      const db = getDb();
      const rows = await db.select().from(depositoGraneles).orderBy(desc(depositoGraneles.createdAt));
      return applyFilters(rows.map(rowToDomain), filters);
    }
    return sortItems(applyFilters(mem().items, filters));
  }

  async get(actor: GranelesActor, id: string): Promise<GranelRemainderRecord | null> {
    assertAccess(actor);
    if (isNeonBacked()) {
      const db = getDb();
      const [row] = await db.select().from(depositoGraneles).where(eq(depositoGraneles.id, id));
      return row ? rowToDomain(row) : null;
    }
    return mem().items.find((item) => item.id === id) ?? null;
  }

  async getByWorkItemId(actor: GranelesActor, workItemId: string): Promise<GranelRemainderRecord | null> {
    assertAccess(actor);
    return isNeonBacked() ? findActiveByWorkItemNeon(workItemId) : findActiveByWorkItemMem(workItemId);
  }

  async listAudit(actor: GranelesActor, granelId: string): Promise<GranelAuditEntry[]> {
    assertAccess(actor);
    if (isNeonBacked()) {
      const db = getDb();
      const rows = await db
        .select()
        .from(depositoGranelesAudit)
        .where(eq(depositoGranelesAudit.granelId, granelId))
        .orderBy(desc(depositoGranelesAudit.createdAt));
      return rows.map((row) => ({
        id: row.id,
        granelId: row.granelId,
        action: row.action as GranelAuditEntry["action"],
        actorSector: row.actorSector as SectorId,
        actorName: row.actorName,
        reason: row.reason,
        beforeKg: row.beforeKg != null ? asNumber(row.beforeKg) : null,
        afterKg: row.afterKg != null ? asNumber(row.afterKg) : null,
        createdAt: row.createdAt.toISOString(),
      }));
    }
    return mem().audit.filter((entry) => entry.granelId === granelId);
  }

  async createManual(actor: GranelesActor, input: CreateManualGranelInput): Promise<GranelRemainderRecord> {
    assertMutate(actor);
    if (!Number.isFinite(input.kg) || input.kg < 0) {
      throw new OrdersValidationError("Kg inválidos.");
    }
    const now = new Date().toISOString();
    const product = input.product?.trim() ?? "";
    const client = input.client?.trim() ?? "";
    const record: GranelRemainderRecord = {
      id: isNeonBacked() ? crypto.randomUUID() : makeMemId(),
      workItemId: null,
      originSector: "DEPOSITO",
      product,
      client,
      bulkLot: input.bulkLot?.trim() ?? "",
      kgAvailable: input.kg,
      intakeDate: input.intakeDate || now.slice(0, 10),
      reportedBy: actor.displayName,
      observation: input.observation?.trim() ?? "",
      location: input.location?.trim() ?? "",
      status: input.asDraft ? "BORRADOR" : input.kg > 0 ? "DISPONIBLE" : "BORRADOR",
      createdAt: now,
      updatedAt: now,
      annulledAt: null,
      annulledBy: null,
      annulReason: null,
    };

    if (isNeonBacked()) {
      const db = getDb();
      await db.insert(depositoGraneles).values(domainToInsert(record));
    } else {
      mem().items.unshift(record);
    }
    await writeAudit({
      granelId: record.id,
      action: "create",
      actorSector: actor.sector,
      actorName: actor.displayName,
      reason: null,
      beforeKg: null,
      afterKg: record.kgAvailable,
    });
    return record;
  }

  /**
   * Upsert idempotente por workItemId (Envasado → sobrante).
   *
   * - Sin registro activo previo: crea.
   * - Registro activo previo con los MISMOS valores (kg/lote/observación):
   *   reintento genuino (doble click, retry de red) — no toca nada.
   * - Registro activo previo con valores DISTINTOS: corrección (Envasado
   *   reenvía con el kg real, ej. 4.5kg → 3.2kg) — actualiza el registro
   *   existente y deja auditoría, en vez de descartar la corrección en
   *   silencio (el saldo visible en Depósito quedaba desincronizado del
   *   work item ya corregido, sin ningún aviso).
   */
  async upsertFromEnvasado(
    actor: GranelesActor,
    input: UpsertGranelFromEnvasadoInput
  ): Promise<UpsertGranelResult> {
    assertUpsertFromEnvasado(actor);
    if (!input.workItemId.trim()) {
      throw new OrdersValidationError("workItemId es obligatorio.");
    }
    if (!Number.isFinite(input.kg) || input.kg <= 0) {
      throw new OrdersValidationError("Kg de sobrante debe ser mayor a 0.");
    }
    const nextBulkLot = input.bulkLot || "Sin lote";
    const nextObservation = input.observation?.trim() ?? "";

    const existing = isNeonBacked()
      ? await findActiveByWorkItemNeon(input.workItemId)
      : findActiveByWorkItemMem(input.workItemId);

    if (existing) {
      const sameKg = Math.abs(existing.kgAvailable - input.kg) < 0.001;
      const sameLot = existing.bulkLot === nextBulkLot;
      const sameObs = existing.observation === nextObservation;
      if (sameKg && sameLot && sameObs) {
        return { record: existing, created: false, duplicated: true, updated: false };
      }

      const beforeKg = existing.kgAvailable;
      const now = new Date().toISOString();
      const next: GranelRemainderRecord = {
        ...existing,
        bulkLot: nextBulkLot,
        kgAvailable: input.kg,
        observation: nextObservation,
        updatedAt: now,
      };
      if (isNeonBacked()) {
        const db = getDb();
        await db
          .update(depositoGraneles)
          .set({
            bulkLot: next.bulkLot,
            kgAvailable: String(next.kgAvailable),
            observation: next.observation,
            updatedAt: new Date(now),
          })
          .where(eq(depositoGraneles.id, existing.id));
      } else {
        const items = mem().items;
        const idx = items.findIndex((item) => item.id === existing.id);
        if (idx >= 0) items[idx] = next;
      }
      await writeAudit({
        granelId: existing.id,
        action: sameKg ? "update" : "delta",
        actorSector: actor.sector,
        actorName: input.reportedBy,
        reason: "Corrección de sobrante desde Envasado (reenvío con datos distintos).",
        beforeKg,
        afterKg: next.kgAvailable,
      });
      return { record: next, created: false, duplicated: false, updated: true };
    }

    const now = new Date().toISOString();
    const record: GranelRemainderRecord = {
      id: isNeonBacked() ? crypto.randomUUID() : makeMemId(),
      workItemId: input.workItemId,
      originSector: input.originSector,
      product: input.product,
      client: input.client,
      bulkLot: nextBulkLot,
      kgAvailable: input.kg,
      intakeDate: now.slice(0, 10),
      reportedBy: input.reportedBy,
      observation: nextObservation,
      location: "",
      status: "DISPONIBLE",
      createdAt: now,
      updatedAt: now,
      annulledAt: null,
      annulledBy: null,
      annulReason: null,
    };

    try {
      if (isNeonBacked()) {
        const db = getDb();
        await db.insert(depositoGraneles).values(domainToInsert(record));
      } else {
        mem().items.unshift(record);
      }
    } catch (err) {
      // Carrera: dos requests concurrentes para el mismo workItemId — el
      // índice único parcial (deposito_graneles_work_item_active_uidx)
      // rechaza el segundo insert. Devolver el registro real en vez de
      // dejar pasar un 500 genérico al usuario.
      const msg = err instanceof Error ? err.message : String(err);
      if (/unique|duplicate/i.test(msg)) {
        const raced = isNeonBacked()
          ? await findActiveByWorkItemNeon(input.workItemId)
          : findActiveByWorkItemMem(input.workItemId);
        if (raced) return { record: raced, created: false, duplicated: true, updated: false };
      }
      throw err;
    }

    await writeAudit({
      granelId: record.id,
      action: "create",
      actorSector: actor.sector,
      actorName: input.reportedBy,
      reason: null,
      beforeKg: null,
      afterKg: record.kgAvailable,
    });
    return { record, created: true, duplicated: false, updated: false };
  }

  async update(actor: GranelesActor, id: string, input: UpdateGranelInput): Promise<GranelRemainderRecord> {
    assertMutate(actor);
    const current = await this.get(actor, id);
    if (!current) throw new OrdersNotFoundError("Registro no encontrado.");
    if (current.status === "ANULADO") {
      throw new OrdersValidationError("No se puede editar un registro anulado.");
    }

    const beforeKg = current.kgAvailable;
    const now = new Date().toISOString();
    const next: GranelRemainderRecord = {
      ...current,
      ...input.patch,
      updatedAt: now,
    };
    if (next.kgAvailable < 0) {
      throw new OrdersValidationError("Kg no pueden ser negativos.");
    }
    if (next.kgAvailable === 0 && next.status === "DISPONIBLE") {
      next.status = "AGOTADO";
    }

    if (isNeonBacked()) {
      const db = getDb();
      const values = domainToInsert(next);
      await db
        .update(depositoGraneles)
        .set({
          product: values.product,
          client: values.client,
          bulkLot: values.bulkLot,
          kgAvailable: values.kgAvailable,
          intakeDate: values.intakeDate,
          location: values.location,
          observation: values.observation,
          status: values.status,
          updatedAt: values.updatedAt,
        })
        .where(eq(depositoGraneles.id, id));
    } else {
      const items = mem().items;
      const idx = items.findIndex((item) => item.id === id);
      if (idx < 0) throw new OrdersNotFoundError("Registro no encontrado.");
      items[idx] = next;
    }

    await writeAudit({
      granelId: id,
      action: beforeKg !== next.kgAvailable ? "delta" : "update",
      actorSector: actor.sector,
      actorName: actor.displayName,
      reason: normalizeOptionalReason(input.reason) || null,
      beforeKg,
      afterKg: next.kgAvailable,
    });
    return next;
  }

  /**
   * Política Eliminar:
   * - Manual sin workItemId → hard delete si BORRADOR (sin movimientos posteriores).
   * - Originado en Envasado o ya con movimientos → anular con motivo (idempotente).
   */
  async deleteOrAnnul(actor: GranelesActor, id: string, reason?: string): Promise<DeleteOrAnnulResult> {
    assertMutate(actor);
    const current = await this.get(actor, id);
    if (!current) throw new OrdersNotFoundError("Registro no encontrado.");

    const normalizedReason = normalizeOptionalReason(reason);

    // Idempotencia: anular un registro ya anulado no duplica auditoría ni falla.
    if (current.status === "ANULADO") {
      return { action: "anular", record: current };
    }

    const isManualDraft = !current.workItemId && current.status === "BORRADOR";
    if (isManualDraft) {
      if (isNeonBacked()) {
        const db = getDb();
        const result = await db
          .delete(depositoGraneles)
          .where(eq(depositoGraneles.id, id))
          .returning({ id: depositoGraneles.id });
        if (result.length === 0) throw new OrdersNotFoundError("Registro no encontrado.");
      } else {
        const items = mem().items;
        const idx = items.findIndex((item) => item.id === id);
        if (idx < 0) throw new OrdersNotFoundError("Registro no encontrado.");
        items.splice(idx, 1);
      }
      await writeAudit({
        granelId: id,
        action: "delete",
        actorSector: actor.sector,
        actorName: actor.displayName,
        reason: normalizedReason,
        beforeKg: current.kgAvailable,
        afterKg: null,
      });
      return { action: "eliminar", record: null };
    }

    const now = new Date().toISOString();
    const next: GranelRemainderRecord = {
      ...current,
      status: "ANULADO",
      annulledAt: now,
      annulledBy: actor.displayName,
      annulReason: normalizedReason,
      updatedAt: now,
    };

    if (isNeonBacked()) {
      const db = getDb();
      await db
        .update(depositoGraneles)
        .set({
          status: next.status,
          annulledAt: new Date(now),
          annulledBy: next.annulledBy,
          annulReason: next.annulReason,
          updatedAt: new Date(now),
        })
        .where(eq(depositoGraneles.id, id));
    } else {
      const items = mem().items;
      const idx = items.findIndex((item) => item.id === id);
      if (idx < 0) throw new OrdersNotFoundError("Registro no encontrado.");
      items[idx] = next;
    }

    await writeAudit({
      granelId: id,
      action: "annul",
      actorSector: actor.sector,
      actorName: actor.displayName,
      reason: normalizedReason,
      beforeKg: current.kgAvailable,
      afterKg: current.kgAvailable,
    });
    return { action: "anular", record: next };
  }
}

let singleton: GranelesService | null = null;

export function getGranelesService(): GranelesService {
  if (!singleton) singleton = new GranelesService();
  return singleton;
}
