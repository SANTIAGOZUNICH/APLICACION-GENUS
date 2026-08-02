import "server-only";

import { createHash } from "node:crypto";
import { and, inArray, notInArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { osNotifications, workItems } from "@/lib/db/schema";
import { normalizeSearchKey } from "@/lib/formulas/types";
import { liveSyncEngine } from "@/lib/live-sync/live-sync-engine";
import { weekStartMonday } from "@/lib/operational/operational-calendar";
import { workItemOverlapsWeek } from "@/lib/operational/work-item-date-range";
import type { OrdersActor } from "@/lib/orders/types";

type EnvasadoSector = "ENVASADO_MASIVO" | "ENVASADO_PREMIUM";

export type ApprovalSnapshot = {
  itemId: string;
  product?: string | null;
  client?: string | null;
  plannedDate?: string | null;
  plannedDateTo?: string | null;
  lote?: string | null;
  quantity?: string | null;
  relatedWorkItemId?: string | null;
};

type Candidate = {
  id: string;
  sector: EnvasadoSector;
  client: string;
  product: string;
  plannedDate: string;
  plannedDateTo: string | null;
  status: string;
  weekStart?: string | null;
  weekId?: string | null;
};

export type ApprovalEnvasadoFinder = (
  snapshot: Required<Pick<ApprovalSnapshot, "product" | "client" | "plannedDate">>
) => Promise<Candidate[]>;

const TERMINAL_STATUSES = new Set(["CANCELADO", "ANULADO", "TERMINADO"]);

const STAGE_LABEL: Record<"CALIDAD" | "PRODUCCION", string> = {
  CALIDAD: "Calidad",
  PRODUCCION: "Producción",
};

export function deterministicApprovalNotificationId(key: string): string {
  const hex = createHash("sha256").update(key).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${(Number.parseInt(hex[16], 16) & 0x3 | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function filterApprovalEnvasadoMatches(
  snapshot: Required<Pick<ApprovalSnapshot, "product" | "client" | "plannedDate">>,
  rows: Candidate[]
): Candidate[] {
  const week = weekStartMonday(snapshot.plannedDate);
  const client = normalizeSearchKey(snapshot.client);
  const product = normalizeSearchKey(snapshot.product);
  return rows.filter(
    (row) =>
      normalizeSearchKey(row.client) === client &&
      normalizeSearchKey(row.product) === product &&
      !TERMINAL_STATUSES.has(row.status.toUpperCase()) &&
      workItemOverlapsWeek(row, week)
  );
}

function buildApprovalMessage(
  snapshot: ApprovalSnapshot,
  stage: "CALIDAD" | "PRODUCCION",
  actorName?: string | null
): string {
  const parts = [
    `${snapshot.product} de ${snapshot.client} fue aprobado por ${STAGE_LABEL[stage]} y está listo para continuar.`,
  ];
  const details: string[] = [];
  if (snapshot.lote?.trim()) details.push(`Lote ${snapshot.lote.trim()}`);
  if (snapshot.quantity?.trim()) details.push(`Cantidad ${snapshot.quantity.trim()}`);
  if (snapshot.plannedDate?.trim()) details.push(`Fecha ${snapshot.plannedDate.trim()}`);
  if (actorName?.trim()) details.push(`Aprobó ${actorName.trim()}`);
  if (details.length) parts.push(details.join(" · "));
  return parts.join(" ");
}

async function findLiveSyncCandidates(): Promise<Candidate[]> {
  try {
    const snapshot = await liveSyncEngine.getSnapshot();
    return (snapshot?.workItems ?? [])
      .filter(
        (item) =>
          (item.sector === "ENVASADO_MASIVO" || item.sector === "ENVASADO_PREMIUM") &&
          Boolean(item.client?.trim()) &&
          Boolean(item.product?.trim()) &&
          Boolean(item.plannedDate?.trim())
      )
      .map((item) => ({
        id: item.id,
        sector: item.sector as EnvasadoSector,
        client: item.client!.trim(),
        product: item.product!.trim(),
        plannedDate: item.plannedDate!.trim(),
        plannedDateTo: item.plannedDateTo?.trim() || null,
        status: item.status,
        weekStart: item.weekStart,
        weekId: item.weekId,
      }));
  } catch (error) {
    console.warn("[approval-envasado] live-sync snapshot unavailable", error);
    return [];
  }
}

async function findNeonCandidates(): Promise<Candidate[]> {
  try {
    const rows = await getDb()
      .select({
        id: workItems.id,
        sector: workItems.sector,
        client: workItems.client,
        product: workItems.product,
        plannedDate: workItems.plannedDate,
        plannedDateTo: workItems.plannedDateTo,
        status: workItems.status,
      })
      .from(workItems)
      .where(
        and(
          inArray(workItems.sector, ["ENVASADO_MASIVO", "ENVASADO_PREMIUM"]),
          notInArray(workItems.status, ["CANCELADO"])
        )
      );
    return rows as Candidate[];
  } catch (error) {
    console.warn("[approval-envasado] neon work_items unavailable", error);
    return [];
  }
}

async function findOperationalEnvasadoCandidates(): Promise<Candidate[]> {
  const [live, neon] = await Promise.all([findLiveSyncCandidates(), findNeonCandidates()]);
  const byId = new Map<string, Candidate>();
  for (const row of [...live, ...neon]) byId.set(row.id, row);
  return [...byId.values()];
}

async function resolvePlannedDate(snapshot: ApprovalSnapshot): Promise<string | null> {
  const direct = snapshot.plannedDate?.trim() || snapshot.plannedDateTo?.trim() || null;
  if (direct) return direct;
  const relatedId = snapshot.relatedWorkItemId?.trim();
  if (!relatedId) return null;
  try {
    const snap = await liveSyncEngine.getSnapshot();
    const related = snap?.workItems.find((item) => item.id === relatedId);
    return (
      related?.plannedDate?.trim() ||
      related?.deliveryDate?.trim() ||
      related?.weekStart?.trim() ||
      null
    );
  } catch {
    return null;
  }
}

/** Best-effort post-approval side effect; never changes the quality decision outcome. */
export async function notifyEnvasadoForApproval(
  actor: Pick<OrdersActor, "email" | "sector" | "displayName">,
  snapshot: ApprovalSnapshot,
  approvalStage: "CALIDAD" | "PRODUCCION",
  finder: ApprovalEnvasadoFinder = findOperationalEnvasadoCandidates
): Promise<{ notified: EnvasadoSector[]; reason?: "NO_ENVASADO_MATCH" | "MISSING_APPROVAL_DATA" }> {
  const plannedDate = await resolvePlannedDate(snapshot);
  if (!snapshot.client?.trim() || !snapshot.product?.trim() || !plannedDate) {
    console.info("[approval-envasado] NO_ENVASADO_MATCH", {
      itemId: snapshot.itemId,
      reason: "MISSING_APPROVAL_DATA",
      actor: actor.email,
    });
    return { notified: [], reason: "MISSING_APPROVAL_DATA" };
  }

  try {
    const required = {
      client: snapshot.client,
      product: snapshot.product,
      plannedDate,
    };
    const matches = filterApprovalEnvasadoMatches(required, await finder(required));
    const sectors = [...new Set(matches.map((item) => item.sector))];
    if (!sectors.length) {
      console.info("[approval-envasado] NO_ENVASADO_MATCH", {
        itemId: snapshot.itemId,
        actor: actor.email,
      });
      return { notified: [], reason: "NO_ENVASADO_MATCH" };
    }

    await Promise.all(
      sectors.map(async (sector) => {
        const workItem = matches.find((item) => item.sector === sector)!;
        const id = deterministicApprovalNotificationId(
          `approval:${snapshot.itemId}:${sector}:${approvalStage}`
        );
        await getDb()
          .insert(osNotifications)
          .values({
            id,
            kind: "produccion_aprobada_envasado",
            title: "Producción aprobada",
            message: buildApprovalMessage(
              { ...snapshot, plannedDate },
              approvalStage,
              actor.displayName
            ),
            sectors: [sector],
            href: `/mi-trabajo?workItemId=${encodeURIComponent(workItem.id)}`,
            readBy: [],
            dismissedBy: [],
            deletedBy: [],
          })
          .onConflictDoNothing();
      })
    );
    return { notified: sectors };
  } catch (error) {
    console.error("[approval-envasado] notification failed", {
      itemId: snapshot.itemId,
      error,
    });
    return { notified: [] };
  }
}
