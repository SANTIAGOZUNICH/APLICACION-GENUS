import { randomUUID } from "node:crypto";
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

function nowIso(): string {
  return new Date().toISOString();
}

/** Repositorio en memoria — tests de reglas/concurrencia/publicación. */
export class MemoryPlanningRepository implements PlanningRepository {
  weeks = new Map<string, PlanningWeekRecord>();
  items = new Map<string, PlanningWorkItemRecord>();
  events: OperationalEventRecord[] = [];
  /** Si true, publish falla a mitad de camino para probar rollback. */
  failPublishHalfway = false;

  async createWeek(
    input: CreateWeekInput,
    actor: PlanningActor
  ): Promise<PlanningWeekRecord> {
    const existing = [...this.weeks.values()].find(
      (w) => w.weekStart === input.weekStart
    );
    if (existing) {
      throw new PlanningValidationError(
        `Ya existe una semana para ${input.weekStart}.`
      );
    }
    const ts = nowIso();
    const week: PlanningWeekRecord = {
      id: randomUUID(),
      weekStart: input.weekStart,
      label: input.label?.trim() || `Semana ${input.weekStart}`,
      status: "DRAFT",
      publishedAt: null,
      createdBy: actor.email,
      version: 1,
      createdAt: ts,
      updatedAt: ts,
    };
    this.weeks.set(week.id, week);
    return { ...week };
  }

  async getWeekById(id: string): Promise<PlanningWeekRecord | null> {
    const w = this.weeks.get(id);
    return w ? { ...w } : null;
  }

  async getWeekByStart(weekStart: string): Promise<PlanningWeekRecord | null> {
    const w = [...this.weeks.values()].find((x) => x.weekStart === weekStart);
    return w ? { ...w } : null;
  }

  async listWeeks(weekStart?: string | null): Promise<PlanningWeekRecord[]> {
    let list = [...this.weeks.values()];
    if (weekStart) list = list.filter((w) => w.weekStart === weekStart);
    return list.sort((a, b) => b.weekStart.localeCompare(a.weekStart)).map((w) => ({ ...w }));
  }

  async listItems(weekId: string): Promise<PlanningWorkItemRecord[]> {
    return [...this.items.values()]
      .filter((i) => i.planningWeekId === weekId)
      .sort((a, b) => a.plannedDate.localeCompare(b.plannedDate) || a.product.localeCompare(b.product))
      .map((i) => ({ ...i }));
  }

  async listPublishedItems(filters: {
    sector?: string | null;
    ownerPerson?: string | null;
    date?: string | null;
    weekStart?: string | null;
  }): Promise<PlanningWorkItemRecord[]> {
    const publishedWeekIds = new Set(
      [...this.weeks.values()].filter((w) => w.status === "PUBLISHED").map((w) => w.id)
    );
    let list = [...this.items.values()].filter(
      (i) => i.status === "PUBLICADO" && publishedWeekIds.has(i.planningWeekId)
    );
    if (filters.sector && filters.sector !== "PRODUCCION" && filters.sector !== "DIRECCION") {
      list = list.filter((i) => i.sector === filters.sector);
    }
    if (filters.ownerPerson) {
      list = list.filter((i) => i.branchOwner === filters.ownerPerson);
    }
    if (filters.date) {
      list = list.filter((i) => i.plannedDate === filters.date);
    }
    if (filters.weekStart) {
      const week = [...this.weeks.values()].find(
        (w) => w.weekStart === filters.weekStart
      );
      if (!week) return [];
      list = list.filter((i) => i.planningWeekId === week.id);
    }
    return list.map((i) => ({ ...i }));
  }

  async createItem(
    week: PlanningWeekRecord,
    input: CreateWorkItemInput & { line: string | null; branchOwner: string | null },
    actor: PlanningActor
  ): Promise<PlanningWorkItemRecord> {
    const ts = nowIso();
    const item: PlanningWorkItemRecord = {
      id: randomUUID(),
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
      publishedAt: week.status === "PUBLISHED" ? ts : null,
      createdBy: actor.email,
      source: "native",
      originRef: null,
      version: 1,
      createdAt: ts,
      updatedAt: ts,
    };
    this.items.set(item.id, item);
    return { ...item };
  }

  async getItem(id: string): Promise<PlanningWorkItemRecord | null> {
    const i = this.items.get(id);
    return i ? { ...i } : null;
  }

  async updateItemOptimistic(
    id: string,
    expectedVersion: number,
    patch: Partial<PlanningWorkItemRecord>
  ): Promise<PlanningWorkItemRecord | null> {
    const current = this.items.get(id);
    if (!current) return null;
    if (current.version !== expectedVersion) {
      throw new PlanningConflictError(
        "El trabajo fue modificado por otro usuario.",
        { ...current }
      );
    }
    const next: PlanningWorkItemRecord = {
      ...current,
      ...patch,
      id: current.id,
      planningWeekId: current.planningWeekId,
      version: current.version + 1,
      updatedAt: nowIso(),
    };
    this.items.set(id, next);
    return { ...next };
  }

  async deleteItem(id: string): Promise<boolean> {
    return this.items.delete(id);
  }

  async publishWeekTransactional(
    weekId: string,
    actor: PlanningActor
  ): Promise<{ week: PlanningWeekRecord; items: PlanningWorkItemRecord[] }> {
    const week = this.weeks.get(weekId);
    if (!week) throw new PlanningNotFoundError("Semana no encontrada.");
    if (week.status !== "DRAFT") {
      throw new PlanningValidationError("Solo se puede publicar una semana en DRAFT.");
    }

    const snapshotWeeks = new Map(this.weeks);
    const snapshotItems = new Map(this.items);
    const snapshotEvents = [...this.events];

    try {
      const items = [...this.items.values()].filter((i) => i.planningWeekId === weekId);
      if (items.length === 0) {
        throw new PlanningValidationError("La semana no tiene trabajos para publicar.");
      }

      for (const item of items) {
        validateCreateWorkItem(item, week.weekStart);
      }

      if (this.failPublishHalfway) {
        throw new Error("Simulated publish failure");
      }

      const ts = nowIso();
      const publishedWeek: PlanningWeekRecord = {
        ...week,
        status: "PUBLISHED",
        publishedAt: ts,
        version: week.version + 1,
        updatedAt: ts,
      };
      this.weeks.set(weekId, publishedWeek);

      const publishedItems: PlanningWorkItemRecord[] = [];
      for (const item of items) {
        const next: PlanningWorkItemRecord = {
          ...item,
          status: "PUBLICADO",
          publishedAt: ts,
          version: item.version + 1,
          updatedAt: ts,
        };
        this.items.set(item.id, next);
        publishedItems.push({ ...next });
      }

      await this.appendEvent({
        workItemId: null,
        planningWeekId: weekId,
        type: "WEEK_PUBLISHED",
        fromStatus: "DRAFT",
        toStatus: "PUBLISHED",
        actorEmail: actor.email,
        actorSector: actor.sector,
        note: `Publicados ${publishedItems.length} trabajos`,
      });

      return { week: { ...publishedWeek }, items: publishedItems };
    } catch (err) {
      this.weeks = snapshotWeeks;
      this.items = snapshotItems;
      this.events = snapshotEvents;
      throw err;
    }
  }

  async appendEvent(
    event: Omit<OperationalEventRecord, "id" | "createdAt">
  ): Promise<OperationalEventRecord> {
    const row: OperationalEventRecord = {
      ...event,
      id: randomUUID(),
      createdAt: nowIso(),
    };
    this.events.push(row);
    return { ...row };
  }
}
