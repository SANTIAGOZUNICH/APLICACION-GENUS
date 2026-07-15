import {
  ACTOR_EMAIL_HEADER,
  ACTOR_SECTOR_HEADER,
} from "@/lib/planning/actor";
import { getClientPlanningSource } from "@/lib/planning/planning-source";

function actorHeaders(email: string, sector: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    [ACTOR_EMAIL_HEADER]: email,
    [ACTOR_SECTOR_HEADER]: sector,
  };
}

async function postNativeOperation(
  body: Record<string, unknown>,
  actor: { email: string; sector: string }
) {
  const res = await fetch("/api/v1/operations/progress", {
    method: "POST",
    headers: actorHeaders(actor.email, actor.sector),
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

export function isNativeOperationsClient(): boolean {
  return getClientPlanningSource() === "native";
}

export async function postNativeSaveProgress(
  actor: { email: string; sector: string },
  payload: { itemId: string; finishedQty: string; observation: string }
) {
  return postNativeOperation({ action: "save_progress", ...payload }, actor);
}

export async function postNativeCompleteWork(
  actor: { email: string; sector: string },
  payload: { itemId: string; finishedQty: string; observation: string }
) {
  return postNativeOperation({ action: "complete_work", ...payload }, actor);
}

export async function postNativeQualityDecision(
  actor: { email: string; sector: string },
  payload: {
    itemId: string;
    status: "aprobado" | "rechazado";
    observation?: string;
  }
) {
  return postNativeOperation({ action: "quality_decision", ...payload }, actor);
}
