import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { isFeatureMemoryAllowed } from "@/lib/db/feature-schema";
import { workViewArchives } from "@/lib/db/schema";
import {
  assertWorkViewArchiveWritesEnabled,
  isWorkViewArchiveSchemaReady,
  WorkViewArchiveSchemaPendingError,
} from "@/lib/db/work-view-archive-schema";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";
import {
  isWorkViewArchiveSector,
  type WorkViewArchiveActor,
  type WorkViewArchiveRecord,
  type WorkViewArchiveSector,
} from "./types";

type MemoryStore = {
  rows: WorkViewArchiveRecord[];
};

const g = globalThis as unknown as { __genusWorkViewArchiveMem?: MemoryStore };

function mem(): MemoryStore {
  if (!g.__genusWorkViewArchiveMem) {
    g.__genusWorkViewArchiveMem = { rows: [] };
  }
  return g.__genusWorkViewArchiveMem;
}

export function resetWorkViewArchiveMemoryForTests(): void {
  g.__genusWorkViewArchiveMem = { rows: [] };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function assertSectorAccess(
  actor: WorkViewArchiveActor,
  sector: WorkViewArchiveSector
): void {
  if (actor.sector !== sector) {
    throw new OrdersForbiddenError(
      "Solo podés archivar/restaurar ítems de tu sector operativo."
    );
  }
}

function rowFromDb(r: {
  id: string;
  sector: string;
  workItemId: string;
  actorEmail: string;
  archivedAt: Date;
}): WorkViewArchiveRecord {
  if (!isWorkViewArchiveSector(r.sector)) {
    throw new Error(`Sector inválido en work_view_archives: ${r.sector}`);
  }
  return {
    id: r.id,
    sector: r.sector,
    workItemId: r.workItemId,
    actorEmail: r.actorEmail,
    archivedAt: r.archivedAt.toISOString(),
  };
}

async function useDb(): Promise<boolean> {
  if (isFeatureMemoryAllowed()) return false;
  if (!isDatabaseConfigured()) return false;
  return isWorkViewArchiveSchemaReady();
}

export class WorkViewArchiveService {
  async list(
    actor: WorkViewArchiveActor,
    sector: WorkViewArchiveSector
  ): Promise<WorkViewArchiveRecord[]> {
    assertSectorAccess(actor, sector);
    const email = normalizeEmail(actor.email);

    if (await useDb()) {
      try {
        const db = getDb();
        const rows = await db
          .select()
          .from(workViewArchives)
          .where(
            and(
              eq(workViewArchives.sector, sector),
              eq(workViewArchives.actorEmail, email)
            )
          );
        return rows.map(rowFromDb);
      } catch {
        if (!isFeatureMemoryAllowed()) return [];
      }
    }

    if (!isFeatureMemoryAllowed() && isDatabaseConfigured()) {
      // Schema pendiente: lecturas vacías (sin memoria silenciosa en runtime no-test).
      return [];
    }

    return mem().rows.filter((r) => r.sector === sector && r.actorEmail === email);
  }

  async listWorkItemIds(
    actor: WorkViewArchiveActor,
    sector: WorkViewArchiveSector
  ): Promise<string[]> {
    const rows = await this.list(actor, sector);
    return rows.map((r) => r.workItemId);
  }

  async archive(
    actor: WorkViewArchiveActor,
    sector: WorkViewArchiveSector,
    workItemId: string
  ): Promise<WorkViewArchiveRecord> {
    assertSectorAccess(actor, sector);
    const id = workItemId.trim();
    if (!id) throw new OrdersValidationError("workItemId requerido.");
    const email = normalizeEmail(actor.email);

    await assertWorkViewArchiveWritesEnabled();

    if (await useDb()) {
      const db = getDb();
      const existing = await db
        .select()
        .from(workViewArchives)
        .where(
          and(
            eq(workViewArchives.sector, sector),
            eq(workViewArchives.workItemId, id),
            eq(workViewArchives.actorEmail, email)
          )
        )
        .limit(1);
      if (existing[0]) return rowFromDb(existing[0]);

      const inserted = await db
        .insert(workViewArchives)
        .values({
          sector,
          workItemId: id,
          actorEmail: email,
        })
        .returning();
      if (!inserted[0]) throw new Error("No se pudo archivar de la vista.");
      return rowFromDb(inserted[0]);
    }

    if (!isFeatureMemoryAllowed()) {
      throw new WorkViewArchiveSchemaPendingError();
    }

    const store = mem();
    const found = store.rows.find(
      (r) => r.sector === sector && r.workItemId === id && r.actorEmail === email
    );
    if (found) return { ...found };

    const record: WorkViewArchiveRecord = {
      id: randomUUID(),
      sector,
      workItemId: id,
      actorEmail: email,
      archivedAt: new Date().toISOString(),
    };
    store.rows.push(record);
    return { ...record };
  }

  async restore(
    actor: WorkViewArchiveActor,
    sector: WorkViewArchiveSector,
    workItemId: string
  ): Promise<{ restored: boolean }> {
    assertSectorAccess(actor, sector);
    const id = workItemId.trim();
    if (!id) throw new OrdersValidationError("workItemId requerido.");
    const email = normalizeEmail(actor.email);

    await assertWorkViewArchiveWritesEnabled();

    if (await useDb()) {
      const db = getDb();
      const deleted = await db
        .delete(workViewArchives)
        .where(
          and(
            eq(workViewArchives.sector, sector),
            eq(workViewArchives.workItemId, id),
            eq(workViewArchives.actorEmail, email)
          )
        )
        .returning({ id: workViewArchives.id });
      return { restored: deleted.length > 0 };
    }

    if (!isFeatureMemoryAllowed()) {
      throw new WorkViewArchiveSchemaPendingError();
    }

    const store = mem();
    const before = store.rows.length;
    store.rows = store.rows.filter(
      (r) => !(r.sector === sector && r.workItemId === id && r.actorEmail === email)
    );
    return { restored: store.rows.length < before };
  }
}

let singleton: WorkViewArchiveService | null = null;

export function getWorkViewArchiveService(): WorkViewArchiveService {
  if (!singleton) singleton = new WorkViewArchiveService();
  return singleton;
}
