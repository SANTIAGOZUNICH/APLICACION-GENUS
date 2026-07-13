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
