import "server-only";

import { and, asc, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
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

function mapItem(row: WorkItemRow | Record<string, unknown>): PlanningWorkItemRecord {
  const r = row as WorkItemRow;
  return {
    id: r.id,
    planningWeekId: r.planningWeekId,
    plannedDate: String(r.plannedDate),
    plannedDateTo: r.plannedDateTo ? String(r.plannedDateTo) : null,
    client: r.client,
    product: r.product,
    plannedQuantity: r.plannedQuantity,
    unit: r.unit,
    sector: r.sector,
    line: r.line,
    branchOwner: r.branchOwner,
    priority: r.priority,
    notes: r.notes,
    packagingLote: r.packagingLote ?? null,
    packagingVto: r.packagingVto ?? null,
    packagingTotalUnits:
      r.packagingTotalUnits == null ? null : Number(r.packagingTotalUnits),
    packingGroups: r.packingGroups ?? null,
    orderId: r.orderId ?? null,
    orderNumber: r.orderNumber ?? null,
    deliveryDate: r.deliveryDate ? String(r.deliveryDate) : null,
    status: r.status,
    publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
    createdBy: r.createdBy,
    source: r.source,
    originRef: r.originRef,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    viaCodificado: Boolean(r.viaCodificado),
    sentToCodificadoAt: r.sentToCodificadoAt
      ? r.sentToCodificadoAt.toISOString()
      : null,
    sentToCodificadoBy: r.sentToCodificadoBy ?? null,
    codificadoOriginSector: r.codificadoOriginSector ?? null,
    deliveredFromCodificadoAt: r.deliveredFromCodificadoAt
      ? r.deliveredFromCodificadoAt.toISOString()
      : null,
    deliveredFromCodificadoBy: r.deliveredFromCodificadoBy ?? null,
    codificadoObservation: r.codificadoObservation ?? null,
    bulkRemainderKg:
      r.bulkRemainderKg == null ? null : Number(r.bulkRemainderKg),
    bulkRemainderObservation: r.bulkRemainderObservation ?? null,
    bulkRemainderId: r.bulkRemainderId ?? null,
    homeLine: r.homeLine ?? null,
    homeBranchOwner: r.homeBranchOwner ?? null,
    codificadoRevision: Number(r.codificadoRevision ?? 0),
    codificadoCancelledAt: r.codificadoCancelledAt
      ? r.codificadoCancelledAt.toISOString()
      : null,
    productionPedidoId: r.productionPedidoId ?? null,
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
    sectors?: string[] | null;
    ownerPerson?: string | null;
    date?: string | null;
    weekStart?: string | null;
    limit?: number | null;
  }): Promise<PlanningWorkItemRecord[]> {
    const conditions = [
      eq(workItems.status, "PUBLICADO"),
      eq(planningWeeks.status, "PUBLISHED"),
    ];

    const floorSectors = (filters.sectors ?? []).filter(
      (s) =>
        s === "ELABORACION" ||
        s === "ENVASADO_MASIVO" ||
        s === "ENVASADO_PREMIUM" ||
        s === "CODIFICADO"
    );
    // Floor planning sectors include CODIFICADO (additive enum after 0019).
    // Envasado también ve trabajos enviados a Codificado (mismo ID, origin_sector).
    if (floorSectors.length > 0) {
      conditions.push(
        inArray(
          workItems.sector,
          floorSectors as Array<
            "ELABORACION" | "ENVASADO_MASIVO" | "ENVASADO_PREMIUM" | "CODIFICADO"
          >
        )
      );
    } else if (filters.sector === "ELABORACION") {
      conditions.push(eq(workItems.sector, "ELABORACION"));
    } else if (
      filters.sector === "ENVASADO_MASIVO" ||
      filters.sector === "ENVASADO_PREMIUM"
    ) {
      conditions.push(
        or(
          eq(workItems.sector, filters.sector),
          and(
            eq(workItems.codificadoOriginSector, filters.sector),
            eq(workItems.viaCodificado, true)
          )
        )!
      );
    } else if (filters.sector === "CODIFICADO") {
      // Directos (Producción) + enviados desde Envasado (sector actual CODIFICADO).
      // Incluye entregados a Calidad (status proyectado); excluye cancelados (vuelven a Envasado).
      conditions.push(
        and(
          eq(workItems.sector, "CODIFICADO"),
          sql`${workItems.codificadoCancelledAt} IS NULL`
        )!
      );
    }
    if (filters.ownerPerson) {
      conditions.push(eq(workItems.branchOwner, filters.ownerPerson));
    }
    if (filters.date) {
      // Cubrir rango planned_date … coalesce(planned_date_to, planned_date)
      conditions.push(
        sql`(${workItems.plannedDate} <= ${filters.date} AND coalesce(${workItems.plannedDateTo}, ${workItems.plannedDate}) >= ${filters.date})`
      );
    }
    if (filters.weekStart) {
      conditions.push(eq(planningWeeks.weekStart, filters.weekStart));
      const weekEnd = addDaysIso(filters.weekStart, 4);
      conditions.push(
        sql`(${workItems.plannedDate} <= ${weekEnd} AND coalesce(${workItems.plannedDateTo}, ${workItems.plannedDate}) >= ${filters.weekStart})`
      );
    }

    const limit =
      typeof filters.limit === "number" && filters.limit > 0
        ? Math.min(Math.floor(filters.limit), 500)
        : 500;

    const rows = await this.db
      .select({
        id: workItems.id,
        planningWeekId: workItems.planningWeekId,
        plannedDate: workItems.plannedDate,
        plannedDateTo: workItems.plannedDateTo,
        client: workItems.client,
        product: workItems.product,
        plannedQuantity: workItems.plannedQuantity,
        unit: workItems.unit,
        sector: workItems.sector,
        line: workItems.line,
        branchOwner: workItems.branchOwner,
        priority: workItems.priority,
        notes: workItems.notes,
        packagingLote: workItems.packagingLote,
        packagingVto: workItems.packagingVto,
        packagingTotalUnits: workItems.packagingTotalUnits,
        packingGroups: workItems.packingGroups,
        orderId: workItems.orderId,
        orderNumber: workItems.orderNumber,
        deliveryDate: workItems.deliveryDate,
        status: workItems.status,
        publishedAt: workItems.publishedAt,
        createdBy: workItems.createdBy,
        source: workItems.source,
        originRef: workItems.originRef,
        version: workItems.version,
        createdAt: workItems.createdAt,
        updatedAt: workItems.updatedAt,
        viaCodificado: workItems.viaCodificado,
        sentToCodificadoAt: workItems.sentToCodificadoAt,
        sentToCodificadoBy: workItems.sentToCodificadoBy,
        codificadoOriginSector: workItems.codificadoOriginSector,
        deliveredFromCodificadoAt: workItems.deliveredFromCodificadoAt,
        deliveredFromCodificadoBy: workItems.deliveredFromCodificadoBy,
        codificadoObservation: workItems.codificadoObservation,
        bulkRemainderKg: workItems.bulkRemainderKg,
        bulkRemainderObservation: workItems.bulkRemainderObservation,
        bulkRemainderId: workItems.bulkRemainderId,
        homeLine: workItems.homeLine,
        homeBranchOwner: workItems.homeBranchOwner,
        codificadoRevision: workItems.codificadoRevision,
        codificadoCancelledAt: workItems.codificadoCancelledAt,
        codificadoCancelledBy: workItems.codificadoCancelledBy,
        codificadoCancelReason: workItems.codificadoCancelReason,
        productionPedidoId: workItems.productionPedidoId,
      })
      .from(workItems)
      .innerJoin(planningWeeks, eq(workItems.planningWeekId, planningWeeks.id))
      .where(and(...conditions))
      .orderBy(asc(workItems.plannedDate), asc(workItems.product))
      .limit(limit);

    return rows.map((row) => mapItem(row));
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
        plannedDateTo: input.plannedDateTo ?? null,
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
        originRef: input.originRef ?? null,
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
