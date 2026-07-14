import type { PlanningRepository } from "@/lib/planning/repository";
import type {
  CreateWeekInput,
  CreateWorkItemInput,
  PatchWorkItemInput,
  PlanningActor,
  PlanningWeekRecord,
  PlanningWorkItemRecord,
} from "@/lib/planning/types";
import {
  PlanningForbiddenError,
  PlanningNotFoundError,
  PlanningValidationError,
} from "@/lib/planning/types";
import {
  assertWeekStartMonday,
  validateCreateWorkItem,
  validatePatchWorkItem,
} from "@/lib/planning/validators";

export class PlanningService {
  constructor(private readonly repo: PlanningRepository) {}

  async createWeek(input: CreateWeekInput, actor: PlanningActor) {
    const weekStart = assertWeekStartMonday(input.weekStart);
    return this.repo.createWeek({ ...input, weekStart }, actor);
  }

  async listWeeks(weekStart?: string | null) {
    if (weekStart) assertWeekStartMonday(weekStart);
    return this.repo.listWeeks(weekStart);
  }

  async getWeek(id: string) {
    const week = await this.repo.getWeekById(id);
    if (!week) throw new PlanningNotFoundError("Semana no encontrada.");
    const items = await this.repo.listItems(id);
    return { week, items };
  }

  async createItem(
    weekId: string,
    input: CreateWorkItemInput,
    actor: PlanningActor
  ) {
    const week = await this.repo.getWeekById(weekId);
    if (!week) throw new PlanningNotFoundError("Semana no encontrada.");
    if (week.status !== "DRAFT") {
      throw new PlanningForbiddenError(
        "Solo se pueden agregar trabajos a una semana en borrador."
      );
    }
    const validated = validateCreateWorkItem(input, week.weekStart);
    const item = await this.repo.createItem(week, validated, actor);
    await this.repo.appendEvent({
      workItemId: item.id,
      planningWeekId: week.id,
      type: "ITEM_CREATED",
      fromStatus: null,
      toStatus: item.status,
      actorEmail: actor.email,
      actorSector: actor.sector,
      note: null,
    });
    return item;
  }

  async patchItem(
    itemId: string,
    patch: PatchWorkItemInput,
    actor: PlanningActor
  ): Promise<PlanningWorkItemRecord> {
    const item = await this.repo.getItem(itemId);
    if (!item) throw new PlanningNotFoundError("Trabajo no encontrado.");
    const week = await this.repo.getWeekById(item.planningWeekId);
    if (!week) throw new PlanningNotFoundError("Semana no encontrada.");

    if (week.status === "DRAFT") {
      const validated = validatePatchWorkItem(patch, week.weekStart, item);
      const updated = await this.repo.updateItemOptimistic(itemId, patch.version, {
        plannedDate: validated.plannedDate ?? item.plannedDate,
        client: validated.client ?? item.client,
        product: validated.product ?? item.product,
        plannedQuantity: validated.plannedQuantity ?? item.plannedQuantity,
        unit: validated.unit ?? item.unit,
        sector: validated.sector ?? item.sector,
        line: validated.line !== undefined ? validated.line : item.line,
        branchOwner:
          validated.branchOwner !== undefined
            ? validated.branchOwner
            : item.branchOwner,
        priority: validated.priority ?? item.priority,
        notes: validated.notes !== undefined ? validated.notes : item.notes,
      });
      if (!updated) throw new PlanningNotFoundError("Trabajo no encontrado.");
      await this.repo.appendEvent({
        workItemId: item.id,
        planningWeekId: week.id,
        type: "ITEM_UPDATED",
        fromStatus: item.status,
        toStatus: updated.status,
        actorEmail: actor.email,
        actorSector: actor.sector,
        note: null,
      });
      return updated;
    }

    // PUBLISHED: sin overwrite silencioso; solo reprogramación con evento.
    const validated = validatePatchWorkItem(patch, week.weekStart, item);
    const updated = await this.repo.updateItemOptimistic(itemId, patch.version, {
      plannedDate: validated.plannedDate ?? item.plannedDate,
      client: validated.client ?? item.client,
      product: validated.product ?? item.product,
      plannedQuantity: validated.plannedQuantity ?? item.plannedQuantity,
      unit: validated.unit ?? item.unit,
      sector: validated.sector ?? item.sector,
      line: validated.line !== undefined ? validated.line : item.line,
      branchOwner:
        validated.branchOwner !== undefined
          ? validated.branchOwner
          : item.branchOwner,
      priority: validated.priority ?? item.priority,
      notes: validated.notes !== undefined ? validated.notes : item.notes,
    });
    if (!updated) throw new PlanningNotFoundError("Trabajo no encontrado.");

    await this.repo.appendEvent({
      workItemId: item.id,
      planningWeekId: week.id,
      type: "ITEM_RESCHEDULED",
      fromStatus: item.status,
      toStatus: updated.status,
      actorEmail: actor.email,
      actorSector: actor.sector,
      note: `Reprogramado ${item.plannedDate}→${updated.plannedDate} / ${item.sector}→${updated.sector}`,
    });
    return updated;
  }

  async deleteItem(itemId: string, actor: PlanningActor) {
    const item = await this.repo.getItem(itemId);
    if (!item) throw new PlanningNotFoundError("Trabajo no encontrado.");
    const week = await this.repo.getWeekById(item.planningWeekId);
    if (!week) throw new PlanningNotFoundError("Semana no encontrada.");
    if (week.status !== "DRAFT") {
      throw new PlanningForbiddenError(
        "No se puede eliminar un trabajo después de publicar la semana."
      );
    }
    await this.repo.deleteItem(itemId);
    await this.repo.appendEvent({
      workItemId: null,
      planningWeekId: week.id,
      type: "ITEM_DELETED",
      fromStatus: item.status,
      toStatus: null,
      actorEmail: actor.email,
      actorSector: actor.sector,
      note: `Eliminado ${item.product} (${item.id})`,
    });
    return { ok: true as const };
  }

  publishWeek(weekId: string, actor: PlanningActor) {
    return this.repo.publishWeekTransactional(weekId, actor);
  }

  listPublishedItems(filters: {
    sector?: string | null;
    ownerPerson?: string | null;
    date?: string | null;
    weekStart?: string | null;
  }) {
    return this.repo.listPublishedItems(filters);
  }
}

export function createPlanningService(repo: PlanningRepository) {
  return new PlanningService(repo);
}

export type { PlanningWeekRecord, PlanningWorkItemRecord };
