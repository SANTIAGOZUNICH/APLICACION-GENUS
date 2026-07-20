import type { SectorId } from "@/types/operational/sector";
import type { WorkItem } from "@/types/operational/work-item";
import type { LiveSyncEvent, LiveSyncStatus } from "@/lib/live-sync/types";

export async function fetchLiveSyncStatus(): Promise<LiveSyncStatus & { mode?: string }> {
  const response = await fetch("/api/v1/live-sync/status", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("No se pudo obtener estado Live Sync.");
  }
  return response.json() as Promise<LiveSyncStatus & { mode?: string }>;
}

export interface LiveSyncCheckResponse {
  changed: boolean;
  version: string;
  revision?: number;
  checkedAt: string;
  mode?: string;
  workItems?: WorkItem[];
  counts?: {
    total: number;
    hoy: number;
    semana: number;
    pendientes: number;
    bloqueados: number;
  };
  metrics?: Record<string, unknown>;
}

/** Poll liviano Sheet→app. Si changed, trae WorkItems en la misma respuesta. */
export async function fetchLiveSyncCheck(params: {
  sector: SectorId;
  knownVersion?: string | null;
  ownerPerson?: string | null;
  date?: string | null;
  weekStart?: string | null;
  signal?: AbortSignal;
}): Promise<LiveSyncCheckResponse> {
  const search = new URLSearchParams({ sector: params.sector });
  if (params.knownVersion) search.set("knownVersion", params.knownVersion);
  if (params.ownerPerson) search.set("ownerPerson", params.ownerPerson);
  if (params.date) search.set("date", params.date);
  if (params.weekStart) search.set("weekStart", params.weekStart);

  const response = await fetch(`/api/v1/live-sync/check?${search.toString()}`, {
    cache: "no-store",
    signal: params.signal,
  });

  if (response.status === 429) {
    throw new Error("RATE_LIMITED");
  }
  if (!response.ok) {
    throw new Error("No se pudo ejecutar live-sync check.");
  }

  return response.json() as Promise<LiveSyncCheckResponse>;
}

export function connectLiveSyncStream(
  sector: SectorId,
  onEvent: (event: LiveSyncEvent) => void,
  onError?: () => void
): () => void {
  const params = new URLSearchParams({ sector });
  const source = new EventSource(`/api/v1/live-sync/stream?${params.toString()}`);

  source.onmessage = (message) => {
    try {
      const event = JSON.parse(message.data) as LiveSyncEvent;
      onEvent(event);
    } catch {
      // ignore malformed events
    }
  };

  source.onerror = () => {
    onError?.();
  };

  return () => source.close();
}

export async function postSaveProgress(payload: {
  itemId: string;
  sector?: SectorId;
  finishedQty: string;
  observation: string;
  updatedBy?: string;
}): Promise<void> {
  await fetch("/api/v1/live-sync/operations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "save_progress", ...payload }),
  });
}

export async function postCompleteWork(payload: {
  item: WorkItem;
  finishedQty: string;
  observation: string;
  completedBy?: string;
}): Promise<void> {
  await fetch("/api/v1/live-sync/operations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "complete_work", ...payload }),
  });
}

export async function postQualityDecision(payload: {
  itemId: string;
  status: "aprobado" | "rechazado";
  decidedBy?: string;
  observation?: string;
  /** Sector de la sesión — defensa de acción en el pipeline (no auth server completo). */
  actorSectorId?: string;
}): Promise<void> {
  await fetch("/api/v1/live-sync/operations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "quality_decision", ...payload }),
  });
}

/** Segundos transcurridos desde una marca ISO — para indicador "Actualizado hace X s". */
export function secondsSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.floor(ms / 1000);
}

export function formatUpdatedAgo(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 5) return "ahora";
  if (seconds < 60) return `hace ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  return `hace ${Math.floor(minutes / 60)} h`;
}
