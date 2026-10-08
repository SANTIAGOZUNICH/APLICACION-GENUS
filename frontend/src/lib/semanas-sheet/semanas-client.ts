import { ACTOR_EMAIL_HEADER, ACTOR_SECTOR_HEADER } from "@/lib/auth/header-names";
import type { OrdersClientSession } from "@/lib/orders/orders-client";
import type { CalendarWeek } from "./calendar-model";
import type { FlatTable } from "./flat-model";
import type { SemanasTabKey } from "./semanas-tabs";

function headers(session: OrdersClientSession): HeadersInit {
  return { "Content-Type": "application/json", [ACTOR_EMAIL_HEADER]: session.email, [ACTOR_SECTOR_HEADER]: session.sector };
}

export interface SemanasViewResponse {
  spreadsheetId: string;
  tabKey: SemanasTabKey;
  tab: string;
  label: string;
  kind: "CALENDAR" | "FLAT";
  writable: boolean;
  canEdit: boolean;
  weeks?: CalendarWeek[];
  /** Ancho (px) de Lun..Vie en la Sheet original. */
  dayWidths?: number[];
  table?: FlatTable;
  readAt: string;
  /** "Hoy" que usa el servidor para decidir períodos cerrados. */
  today?: string;
  locksKnown?: boolean;
  reasonRequiredBefore?: string;
}

export async function fetchSemanasView(session: OrdersClientSession, tab: SemanasTabKey): Promise<SemanasViewResponse> {
  const res = await fetch(`/api/v1/semanas/grid?tab=${tab}`, { credentials: "include", headers: headers(session) });
  const body = (await res.json().catch(() => ({}))) as SemanasViewResponse & { error?: string };
  if (!res.ok) throw new Error(body.error ?? "No se pudo leer SEMANAS 2026.");
  return body;
}

export interface SemanasEditPayload {
  tabKey: SemanasTabKey;
  a1: string;
  expectedValue: string;
  value: string;
  reason?: string;
}
export interface SemanasEditResultDto {
  ok: boolean;
  code?: string;
  message?: string;
}

/** Resultado por celda, en el mismo orden que `edits`. Lanza solo ante errores de red. */
export async function patchSemanasCells(
  session: OrdersClientSession,
  edits: SemanasEditPayload[]
): Promise<{ ok: boolean; results: SemanasEditResultDto[]; error?: string }> {
  let res: Response;
  try {
    res = await fetch("/api/v1/semanas/cells", { method: "PATCH", credentials: "include", headers: headers(session), body: JSON.stringify({ edits }) });
  } catch {
    return { ok: false, results: edits.map(() => ({ ok: false, message: "Sin conexión con el servidor." })), error: "Sin conexión con el servidor." };
  }
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; results?: SemanasEditResultDto[]; error?: string };
  return {
    ok: Boolean(res.ok && body.ok),
    results: body.results ?? edits.map(() => ({ ok: false, message: body.error ?? "No se pudo guardar." })),
    error: body.error,
  };
}
