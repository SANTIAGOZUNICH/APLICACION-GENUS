import "server-only";

import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import { getDb, type GenusDb } from "@/lib/db/client";
import {
  operationalEvents,
  planningWeeks,
  workItems,
  type PlanningWeekRow,
  type WorkItemRow,
} from "@/lib/db/schema";
import { addDaysIso } from "@/lib/operational/operational-calendar";
import type { PlanningRepository } from "@/lib/planning/repository";
import type {
  CreateWeekInput,
  CreateWorkItemInput,
  OperationalEventRecord,
  PlanningActor,
  PlanningWeekRecord,
  PlanningWorkItemRecord,
} from "@/lib/planning/types";
import {
  PlanningConflictError,
  PlanningNotFoundError,
  PlanningValidationError,
} from "@/lib/planning/types";
import { validateCreateWorkItem } from "@/lib/planning/validators";

function mapWeek(row: PlanningWeekRow): PlanningWeekRecord {
  return {
    id: row.id,
    weekStart: String(row.weekStart),
    label: row.label,
    status: row.status,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    createdBy: row.createdBy,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapItem(row: WorkItemRow): PlanningWorkItemRecord {
  return {
    id: row.id,
    planningWeekId: row.planningWeekId,
    plannedDate: String(row.plannedDate),
    client: row.client,
    product: row.product,
    plannedQuantity: row.plannedQuantity,
    unit: row.unit,
    sector: row.sector,
    line: row.line,
    branchOwner: row.branchOwner,
    priority: row.priority,
    notes: row.notes,
    status: row.status,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    createdBy: row.createdBy,
    source: row.source,
    originRef: row.originRef,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class DrizzlePlanningRepository implements PlanningRepository {
  constructor(private readonly db: GenusDb = getDb()) {}

  async createWeek(
    input: CreateWeekInput,
    actor: PlanningActor
  ): Promise<PlanningWeekRecord> {
    try {
      const [row] = await this.db
        .insert(planningWeeks)
        .values({
          weekStart: input.weekStart,
          label: input.label?.trim() || `Semana ${input.weekStart}`,
          status: "DRAFT",
          createdBy: actor.email,
        })
        .returning();
      return mapWeek(row);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/unique|duplicate|planning_weeks_week_start/i.test(message)) {
        throw new PlanningValidationError(
          `Ya existe una semana para ${input.weekStart}.`
        );
      }
      if (/week_start_monday|check/i.test(message)) {
        throw new PlanningValidationError(
          `weekStart debe ser lunes (recibido ${input.weekStart}).`
        );
      }
      throw err;
    }
  }

  async getWeekById(id: string): Promise<PlanningWeekRecord | null> {
    const [row] = await this.db
      .select()
      .from(planningWeeks)
      .where(eq(planningWeeks.id, id))
      .limit(1);
    return row ? mapWeek(row) : null;
  }

  async getWeekByStart(weekStart: string): Promise<PlanningWeekRecord | null> {
    const [row] = await this.db
      .select()
      .from(planningWeeks)
      .where(eq(planningWeeks.weekStart, weekStart))
      .limit(1);
    return row ? mapWeek(row) : null;
  }

  async listWeeks(weekStart?: string | null): Promise<PlanningWeekRecord[]> {
    const rows = weekStart
      ? await this.db
          .select()
          .from(planningWeeks)
          .where(eq(planningWeeks.weekStart, weekStart))
          .orderBy(desc(planningWeeks.weekStart))
      : await this.db
          .select()
          .from(planningWeeks)
          .orderBy(desc(planningWeeks.weekStart));
    return rows.map(mapWeek);
  }

  async listItems(weekId: string): Promise<PlanningWorkItemRecord[]> {
    const rows = await this.db
      .select()
      .from(workItems)
      .where(eq(workItems.planningWeekId, weekId))
      .orderBy(asc(workItems.plannedDate), asc(workItems.product));
    return rows.map(mapItem);
  }

  async listPublishedItems(filters: {
    sector?: string | null;
    ownerPerson?: string | null;
    date?: string | null;
    weekStart?: string | null;
  }): Promise<PlanningWorkItemRecord[]> {
    const conditions = [
      eq(workItems.status, "PUBLICADO"),
      eq(planningWeeks.status, "PUBLISHED"),
    ];

    if (
      filters.sector &&
      filters.sector !== "PRODUCCION" &&
      filters.sector !== "DIRECCION" &&
      filters.sector !== "CALIDAD" &&
      filters.sector !== "DEPOSITO"
    ) {
      conditions.push(
        eq(
          workItems.sector,
          filters.sector as "ELABORACION" | "ENVASADO_MASIVO" | "ENVASADO_PREMIUM"
        )
      );
    }
    if (filters.ownerPerson) {
      conditions.push(eq(workItems.branchOwner, filters.ownerPerson));
    }
    if (filters.date) {
      conditions.push(eq(workItems.plannedDate, filters.date));
    }
    if (filters.weekStart) {
      conditions.push(eq(planningWeeks.weekStart, filters.weekStart));
      conditions.push(gte(workItems.plannedDate, filters.weekStart));
      conditions.push(lt(workItems.plannedDate, addDaysIso(filters.weekStart, 5)));
    }

    const rows = await this.db
      .select({ item: workItems })
      .from(workItems)
      .innerJoin(planningWeeks, eq(workItems.planningWeekId, planningWeeks.id))
      .where(and(...conditions))
      .orderBy(asc(workItems.plannedDate), asc(workItems.product));

    return rows.map((r) => mapItem(r.item));
  }

  async createItem(
    week: PlanningWeekRecord,
    input: CreateWorkItemInput & { line: string | null; branchOwner: string | null },
    actor: PlanningActor
  ): Promise<PlanningWorkItemRecord> {
    const [row] = await this.db
      .insert(workItems)
      .values({
        planningWeekId: week.id,
        plannedDate: input.plannedDate,
        client: input.client,
        product: input.product,
        plannedQuantity: input.plannedQuantity,
        unit: input.unit ?? "KG",
        sector: input.sector,
        line: input.line,
        branchOwner: input.branchOwner,
        priority: input.priority ?? "NORMAL",
        notes: input.notes ?? null,
        status: week.status === "PUBLISHED" ? "PUBLICADO" : "BORRADOR",
        publishedAt: week.status === "PUBLISHED" ? new Date() : null,
        createdBy: actor.email,
        source: "native",
      })
      .returning();
    return mapItem(row);
  }

  async getItem(id: string): Promise<PlanningWorkItemRecord | null> {
    const [row] = await this.db
      .select()
      .from(workItems)
      .where(eq(workItems.id, id))
      .limit(1);
    return row ? mapItem(row) : null;
  }

  async updateItemOptimistic(
    id: string,
    expectedVersion: number,
    patch: Partial<PlanningWorkItemRecord>
  ): Promise<PlanningWorkItemRecord | null> {
    const setValues: Record<string, unknown> = {
      version: sql`${workItems.version} + 1`,
      updatedAt: new Date(),
    };
    if (patch.plannedDate !== undefined) setValues.plannedDate = patch.plannedDate;
    if (patch.client !== undefined) setValues.client = patch.client;
    if (patch.product !== undefined) setValues.product = patch.product;
    if (patch.plannedQuantity !== undefined) {
      setValues.plannedQuantity = patch.plannedQuantity;
    }
    if (patch.unit !== undefined) setValues.unit = patch.unit;
    if (patch.sector !== undefined) setValues.sector = patch.sector;
    if (patch.line !== undefined) setValues.line = patch.line;
    if (patch.branchOwner !== undefined) setValues.branchOwner = patch.branchOwner;
    if (patch.priority !== undefined) setValues.priority = patch.priority;
    if (patch.notes !== undefined) setValues.notes = patch.notes;

    const [updated] = await this.db
      .update(workItems)
      .set(setValues)
      .where(and(eq(workItems.id, id), eq(workItems.version, expectedVersion)))
      .returning();

    if (updated) return mapItem(updated);

    const current = await this.getItem(id);
    if (!current) return null;
    throw new PlanningConflictError(
      "El trabajo fue modificado por otro usuario.",
      current
    );
  }

  async deleteItem(id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(workItems)
      .where(eq(workItems.id, id))
      .returning({ id: workItems.id });
    return deleted.length > 0;
  }

  async publishWeekTransactional(
    weekId: string,
    actor: PlanningActor
  ): Promise<{ week: PlanningWeekRecord; items: PlanningWorkItemRecord[] }> {
    return this.db.transaction(async (tx) => {
      const [week] = await tx
        .select()
        .from(planningWeeks)
        .where(eq(planningWeeks.id, weekId))
        .limit(1);
      if (!week) throw new PlanningNotFoundError("Semana no encontrada.");
      if (week.status !== "DRAFT") {
        throw new PlanningValidationError(
          "Solo se puede publicar una semana en DRAFT."
        );
      }

      const items = await tx
        .select()
        .from(workItems)
        .where(eq(workItems.planningWeekId, weekId));
      if (items.length === 0) {
        throw new PlanningValidationError(
          "La semana no tiene trabajos para publicar."
        );
      }

      const weekMapped = mapWeek(week);
      for (const item of items) {
        validateCreateWorkItem(mapItem(item), weekMapped.weekStart);
      }

      const ts = new Date();
      const [publishedWeek] = await tx
        .update(planningWeeks)
        .set({
          status: "PUBLISHED",
          publishedAt: ts,
          version: sql`${planningWeeks.version} + 1`,
          updatedAt: ts,
        })
        .where(and(eq(planningWeeks.id, weekId), eq(planningWeeks.status, "DRAFT")))
        .returning();

      if (!publishedWeek) {
        throw new PlanningConflictError(
          "La semana cambió durante la publicación.",
          weekMapped
        );
      }

      const publishedItems = await tx
        .update(workItems)
        .set({
          status: "PUBLICADO",
          publishedAt: ts,
          version: sql`${workItems.version} + 1`,
          updatedAt: ts,
        })
        .where(eq(workItems.planningWeekId, weekId))
        .returning();

      await tx.insert(operationalEvents).values({
        workItemId: null,
        planningWeekId: weekId,
        type: "WEEK_PUBLISHED",
        fromStatus: "DRAFT",
        toStatus: "PUBLISHED",
        actorEmail: actor.email,
        actorSector: actor.sector,
        note: `Publicados ${publishedItems.length} trabajos`,
      });

      return {
        week: mapWeek(publishedWeek),
        items: publishedItems.map(mapItem),
      };
    });
  }

  async appendEvent(
    event: Omit<OperationalEventRecord, "id" | "createdAt">
  ): Promise<OperationalEventRecord> {
    const [row] = await this.db
      .insert(operationalEvents)
      .values({
        workItemId: event.workItemId,
        planningWeekId: event.planningWeekId,
        type: event.type,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        actorEmail: event.actorEmail,
        actorSector: event.actorSector,
        note: event.note,
      })
      .returning();
    return {
      id: row.id,
      workItemId: row.workItemId,
      planningWeekId: row.planningWeekId,
      type: row.type,
      fromStatus: row.fromStatus,
      toStatus: row.toStatus,
      actorEmail: row.actorEmail,
      actorSector: row.actorSector,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
