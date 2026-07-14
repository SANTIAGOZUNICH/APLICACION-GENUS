import type {
  CreateWeekInput,
  CreateWorkItemInput,
  OperationalEventRecord,
  PatchWorkItemInput,
  PlanningActor,
  PlanningWeekRecord,
  PlanningWorkItemRecord,
} from "@/lib/planning/types";

export interface PlanningRepository {
  createWeek(
    input: CreateWeekInput,
    actor: PlanningActor
  ): Promise<PlanningWeekRecord>;

  getWeekById(id: string): Promise<PlanningWeekRecord | null>;

  getWeekByStart(weekStart: string): Promise<PlanningWeekRecord | null>;

  listWeeks(weekStart?: string | null): Promise<PlanningWeekRecord[]>;

  listItems(weekId: string): Promise<PlanningWorkItemRecord[]>;

  listPublishedItems(filters: {
    sector?: string | null;
    ownerPerson?: string | null;
    date?: string | null;
    weekStart?: string | null;
  }): Promise<PlanningWorkItemRecord[]>;

  createItem(
    week: PlanningWeekRecord,
    input: CreateWorkItemInput & { line: string | null; branchOwner: string | null },
    actor: PlanningActor
  ): Promise<PlanningWorkItemRecord>;

  getItem(id: string): Promise<PlanningWorkItemRecord | null>;

  updateItemOptimistic(
    id: string,
    expectedVersion: number,
    patch: Partial<PlanningWorkItemRecord>
  ): Promise<PlanningWorkItemRecord | null>;

  deleteItem(id: string): Promise<boolean>;

  /** Publicación atómica: semana + items + evento. */
  publishWeekTransactional(
    weekId: string,
    actor: PlanningActor
  ): Promise<{ week: PlanningWeekRecord; items: PlanningWorkItemRecord[] }>;

  appendEvent(
    event: Omit<OperationalEventRecord, "id" | "createdAt">
  ): Promise<OperationalEventRecord>;
}
