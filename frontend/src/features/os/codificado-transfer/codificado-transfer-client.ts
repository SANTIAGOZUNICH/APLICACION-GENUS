import { ACTOR_EMAIL_HEADER, ACTOR_SECTOR_HEADER } from "@/lib/auth/header-names";
import type { CodificadoTransferView } from "@/lib/planning/codificado-transfer-service";

export type { CodificadoTransferView };
export type TransferSession = { email?: string | null; sector?: string | null };

const bare = (id: string) => (id.startsWith("native:") ? id.slice("native:".length) : id);
const headers = (s: TransferSession): HeadersInit => ({ "Content-Type": "application/json", ...(s.email ? { [ACTOR_EMAIL_HEADER]: s.email } : {}), ...(s.sector ? { [ACTOR_SECTOR_HEADER]: s.sector } : {}) });

async function call<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error((json as { error?: string }).error ?? "No se pudo completar la operación.");
  return json;
}

export async function fetchTransferView(session: TransferSession, workItemId: string): Promise<CodificadoTransferView> {
  const res = await fetch(`/api/v1/work-items/${encodeURIComponent(bare(workItemId))}/codificado`, { credentials: "include", cache: "no-store", headers: headers(session) });
  return (await call<{ view: CodificadoTransferView }>(res)).view;
}

export async function postTransfer(session: TransferSession, workItemId: string, body: { quantity: number; finishedQty?: number | null; observation?: string | null; packingGroups?: Array<{ cajas: number; unidadesPorCaja: number }> | null; idempotencyKey: string }) {
  const res = await fetch(`/api/v1/work-items/${encodeURIComponent(bare(workItemId))}/codificado`, { method: "POST", credentials: "include", headers: headers(session), body: JSON.stringify({ action: "transfer", ...body }) });
  return call<{ ok: true; replayed: boolean; complete: boolean; view: CodificadoTransferView }>(res);
}

export async function postCodedProgress(session: TransferSession, workItemId: string, codedUnits: number) {
  const res = await fetch(`/api/v1/work-items/${encodeURIComponent(bare(workItemId))}/codificado`, { method: "POST", credentials: "include", headers: headers(session), body: JSON.stringify({ action: "progress", codedUnits }) });
  return (await call<{ view: CodificadoTransferView }>(res)).view;
}

export const fmtQty = (n: number | null | undefined) => (n == null ? "—" : new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(n));
