import "server-only";

import { and, eq, sql } from "drizzle-orm";
import type { getDb } from "@/lib/db/client";
import { workItemCodificadoTransfers } from "@/lib/db/schema";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/** Suma de las entregas ACTIVAS que un trabajo de Envasado hizo a Codificado. 0 si no hizo ninguna. */
export async function sumActiveCodificadoTransfers(tx: Tx, workItemId: string): Promise<number> {
  const [row] = await tx
    .select({ total: sql<number>`coalesce(sum(${workItemCodificadoTransfers.quantity}), 0)` })
    .from(workItemCodificadoTransfers)
    .where(and(eq(workItemCodificadoTransfers.workItemId, workItemId), eq(workItemCodificadoTransfers.status, "ACTIVA")));
  return Number(row?.total ?? 0);
}
