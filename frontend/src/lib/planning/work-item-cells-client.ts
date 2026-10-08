import { ACTOR_EMAIL_HEADER, ACTOR_SECTOR_HEADER } from "@/lib/auth/header-names";
import type { OrdersClientSession } from "@/lib/orders/orders-client";
import type { WorkItemCellChange, WorkItemCellResult } from "./work-item-cell-edit";

/** PATCH por celda: resultado por celda en el orden enviado. Solo lanza ante errores de red inesperados. */
export async function patchWorkItemCellsApi(
  session: OrdersClientSession,
  changes: WorkItemCellChange[]
): Promise<{ ok: boolean; results: WorkItemCellResult[]; error?: string }> {
  let res: Response;
  try {
    res = await fetch("/api/v1/work-items/cells", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json", [ACTOR_EMAIL_HEADER]: session.email, [ACTOR_SECTOR_HEADER]: session.sector },
      body: JSON.stringify({ actorSectorId: session.sector, changes }),
    });
  } catch {
    const message = "Sin conexión con el servidor. Reintentá.";
    return { ok: false, error: message, results: changes.map((_, index) => ({ index, ok: false as const, code: "ERROR" as const, message })) };
  }
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; results?: WorkItemCellResult[]; error?: string };
  return {
    ok: Boolean(res.ok && body.ok),
    error: body.error,
    results: body.results ?? changes.map((_, index) => ({ index, ok: false as const, code: "ERROR" as const, message: body.error ?? "No se pudo guardar." })),
  };
}
