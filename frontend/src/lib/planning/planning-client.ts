import {
  ACTOR_EMAIL_HEADER,
  ACTOR_SECTOR_HEADER,
} from "@/lib/planning/actor";
import type {
  CreateWorkItemInput,
  PatchWorkItemInput,
  PlanningWeekRecord,
  PlanningWorkItemRecord,
} from "@/lib/planning/types";

function actorHeaders(email: string, sector: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    [ACTOR_EMAIL_HEADER]: email,
    [ACTOR_SECTOR_HEADER]: sector,
  };
}

async function parseJson(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `HTTP ${res.status}`) as Error & {
      status?: number;
      code?: string;
      current?: unknown;
    };
    err.status = res.status;
    err.code = body.code;
    err.current = body.current;
    throw err;
  }
  return body;
}

export async function createPlanningWeek(
  actor: { email: string; sector: string },
  input: { weekStart: string; label?: string }
): Promise<PlanningWeekRecord> {
  const res = await fetch("/api/v1/planning/weeks", {
    method: "POST",
    headers: actorHeaders(actor.email, actor.sector),
    body: JSON.stringify(input),
  });
  const data = await parseJson(res);
  return data.week;
}

export async function listPlanningWeeks(
  actor: { email: string; sector: string },
  weekStart?: string
): Promise<PlanningWeekRecord[]> {
  const qs = weekStart ? `?weekStart=${encodeURIComponent(weekStart)}` : "";
  const res = await fetch(`/api/v1/planning/weeks${qs}`, {
    headers: actorHeaders(actor.email, actor.sector),
  });
  const data = await parseJson(res);
  return data.weeks ?? [];
}

export async function getPlanningWeek(
  actor: { email: string; sector: string },
  id: string
): Promise<{ week: PlanningWeekRecord; items: PlanningWorkItemRecord[] }> {
  const res = await fetch(`/api/v1/planning/weeks/${id}`, {
    headers: actorHeaders(actor.email, actor.sector),
  });
  return parseJson(res);
}

export async function createPlanningItem(
  actor: { email: string; sector: string },
  weekId: string,
  input: CreateWorkItemInput
): Promise<PlanningWorkItemRecord> {
  const res = await fetch(`/api/v1/planning/weeks/${weekId}/items`, {
    method: "POST",
    headers: actorHeaders(actor.email, actor.sector),
    body: JSON.stringify(input),
  });
  const data = await parseJson(res);
  return data.item;
}

export async function patchPlanningItem(
  actor: { email: string; sector: string },
  itemId: string,
  input: PatchWorkItemInput
): Promise<PlanningWorkItemRecord> {
  const res = await fetch(`/api/v1/planning/items/${itemId}`, {
    method: "PATCH",
    headers: actorHeaders(actor.email, actor.sector),
    body: JSON.stringify(input),
  });
  const data = await parseJson(res);
  return data.item;
}

export async function deletePlanningItem(
  actor: { email: string; sector: string },
  itemId: string
): Promise<void> {
  const res = await fetch(`/api/v1/planning/items/${itemId}`, {
    method: "DELETE",
    headers: actorHeaders(actor.email, actor.sector),
  });
  await parseJson(res);
}

export async function publishPlanningWeek(
  actor: { email: string; sector: string },
  weekId: string
): Promise<{ week: PlanningWeekRecord; items: PlanningWorkItemRecord[] }> {
  const res = await fetch(`/api/v1/planning/weeks/${weekId}/publish`, {
    method: "POST",
    headers: actorHeaders(actor.email, actor.sector),
  });
  return parseJson(res);
}
