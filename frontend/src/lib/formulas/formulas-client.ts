import {
  ACTOR_EMAIL_HEADER,
  ACTOR_SECTOR_HEADER,
} from "@/lib/auth/header-names";
import type { OrdersClientSession } from "@/lib/orders/orders-client";
import type { FormulaAdminEntry } from "@/lib/formulas/formula-bank-service";

function headers(session: OrdersClientSession): HeadersInit {
  return {
    "Content-Type": "application/json",
    [ACTOR_EMAIL_HEADER]: session.email,
    [ACTOR_SECTOR_HEADER]: session.sector,
  };
}

async function parseJson<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T & {
    error?: string;
    code?: string;
    usageRefs?: Array<{ kind: string; id: string; label: string }>;
  };
  if (!res.ok) {
    const err = new Error(body.error ?? `HTTP ${res.status}`) as Error & {
      status?: number;
      code?: string;
      usageRefs?: typeof body.usageRefs;
    };
    err.status = res.status;
    err.code = body.code;
    err.usageRefs = body.usageRefs;
    throw err;
  }
  return body;
}

export async function fetchFormulaAdminEntriesApi(
  session: OrdersClientSession,
  opts?: { q?: string; includeArchived?: boolean; limit?: number }
): Promise<{ entries: FormulaAdminEntry[]; total: number }> {
  const params = new URLSearchParams();
  if (opts?.q) params.set("q", opts.q);
  if (opts?.includeArchived) params.set("includeArchived", "1");
  if (opts?.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  const res = await fetch(`/api/v1/formulas/admin${qs ? `?${qs}` : ""}`, {
    credentials: "include",
    headers: headers(session),
    cache: "no-store",
  });
  return parseJson(res);
}

export async function mutateFormulaAdminApi(
  session: OrdersClientSession,
  input: {
    action: "archive" | "restore" | "delete";
    productId: string;
    reason: string;
    actorSectorId?: string;
  }
): Promise<{ ok: true; entry?: FormulaAdminEntry; deletedProductId?: string }> {
  const res = await fetch("/api/v1/formulas/admin", {
    method: "POST",
    credentials: "include",
    headers: headers(session),
    body: JSON.stringify({
      ...input,
      actorSectorId: input.actorSectorId ?? session.sector,
    }),
  });
  return parseJson(res);
}
