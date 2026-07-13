import "server-only";

import { googleDriveGateway } from "@/lib/adapters/drive/google-drive-gateway";
import { operationsDocumentRepository } from "@/lib/adapters/drive/operations-document-repository";
import type { CriticalSheetKey } from "@/lib/adapters/drive/drive-folder-config";
import { serverCache } from "@/lib/adapters/drive/cache/server-cache";
import { loadOperationalPipeline } from "@/lib/parsers/load-operational-pipeline";
import { operationalEventBus } from "@/lib/live-sync/operational-event-bus";
import { liveSyncStore } from "@/lib/live-sync/live-sync-store";
import { serverOperationalState } from "@/lib/live-sync/server-operational-state";
import type { LiveSyncSnapshot, LiveSyncStatus } from "@/lib/live-sync/types";
import {
  filterWorkItemsForSectorAndPerson,
  filterWorkItemsForSector,
} from "@/lib/operational/work-item-filters";
import { countMiTrabajoSections } from "@/lib/operational/work-item-filters";
import { buildProductionOverview } from "@/lib/operational/build-production-overview";
import { getServerDataMode } from "@/lib/config/data-mode";
import type { SectorId } from "@/types/operational/sector";
import type { WorkItemsResponse } from "@/types/operational/work-item";

const CRITICAL_SHEETS: CriticalSheetKey[] = [
  "semanas_2026",
  "pedidos_2026",
  "asignacion_lotes_2026",
];

const SHEETS_POLL_MS = Number(process.env.GENUS_LIVE_SYNC_POLL_MS ?? "4000");
const SNAPSHOT_MAX_AGE_MS = Number(process.env.GENUS_SNAPSHOT_MAX_AGE_MS ?? "120000");

let backgroundTimer: ReturnType<typeof setInterval> | null = null;

function invalidateSpreadsheetCache(spreadsheetId: string): void {
  serverCache.deleteByPrefix(`sheet:${spreadsheetId}:`);
}

async function detectChangedSheets(): Promise<CriticalSheetKey[]> {
  const changed: CriticalSheetKey[] = [];

  for (const key of CRITICAL_SHEETS) {
    const ref = await operationsDocumentRepository.tryGetCriticalSheetRef(key);
    if (!ref) continue;

    const meta = await googleDriveGateway.getFileMetadata(ref.fileId);
    if (!meta?.modifiedTime) continue;

    const known = liveSyncStore.getSheetModifiedTime(key);
    if (known !== meta.modifiedTime) {
      changed.push(key);
    }
  }

  return changed;
}

async function rebuildSnapshot(reason: string): Promise<LiveSyncSnapshot | null> {
  const existing = liveSyncStore.getSyncInFlight();
  if (existing) return existing;

  const promise = (async () => {
    try {
      const pipeline = await loadOperationalPipeline();

      if (
        pipeline.workItems.length === 0 &&
        !pipeline.sourcesIndexed.semanas_2026
      ) {
        return liveSyncStore.getSnapshot();
      }

      const snapshot: LiveSyncSnapshot = {
        revision: (liveSyncStore.getSnapshot()?.revision ?? 0) + 1,
        updatedAt: new Date().toISOString(),
        sheetsSyncedAt: new Date().toISOString(),
        workItems: pipeline.workItems,
        qualityItems: pipeline.qualityItems,
        warnings: pipeline.warnings,
        sourcesIndexed: pipeline.sourcesIndexed,
      };

      liveSyncStore.setSnapshot(snapshot);

      for (const key of CRITICAL_SHEETS) {
        const ref = await operationsDocumentRepository.tryGetCriticalSheetRef(key);
        if (!ref) continue;
        const meta = await googleDriveGateway.getFileMetadata(ref.fileId);
        if (meta?.modifiedTime) {
          liveSyncStore.setSheetModifiedTime(key, meta.modifiedTime);
        }
      }

      operationalEventBus.publish({
        type: "snapshot.updated",
        revision: snapshot.revision,
        at: snapshot.updatedAt,
        sectors: [
          "ENVASADO_MASIVO",
          "ENVASADO_PREMIUM",
          "ELABORACION",
          "CALIDAD",
          "PRODUCCION",
          "DIRECCION",
        ],
        totalWorkItems: snapshot.workItems.length,
      });

      if (process.env.NODE_ENV !== "production") {
        console.info(`[live-sync] snapshot rebuilt (${reason}) — ${snapshot.workItems.length} items`);
      }

      return snapshot;
    } catch (err) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[live-sync] rebuild failed:", err);
      }
      return liveSyncStore.getSnapshot();
    } finally {
      liveSyncStore.setSyncInFlight(null);
    }
  })();

  liveSyncStore.setSyncInFlight(promise);
  return promise;
}

async function syncIfNeeded(force = false): Promise<void> {
  const current = liveSyncStore.getSnapshot();
  const age = current ? Date.now() - new Date(current.updatedAt).getTime() : Infinity;

  if (!force && current && age < SNAPSHOT_MAX_AGE_MS) {
    const changed = await detectChangedSheets();
    if (changed.length === 0) return;

    for (const key of changed) {
      const ref = await operationsDocumentRepository.tryGetCriticalSheetRef(key);
      if (ref) invalidateSpreadsheetCache(ref.fileId);
    }
  } else if (!force && current) {
    return;
  }

  await rebuildSnapshot(force ? "forced" : "sheet-change");
}

function applyOperationalOverlay(snapshot: LiveSyncSnapshot): LiveSyncSnapshot {
  return {
    ...snapshot,
    workItems: serverOperationalState.applyToWorkItems(snapshot.workItems),
    qualityItems: serverOperationalState.mergeCompletions(
      serverOperationalState.applyToQualityItems(snapshot.qualityItems)
    ),
  };
}

export class LiveSyncEngine {
  constructor() {
    this.ensureBackgroundSync();
  }

  private ensureBackgroundSync(): void {
    if (backgroundTimer || typeof setInterval === "undefined") return;
    if (process.env.GENUS_LIVE_SYNC_DISABLED === "true") return;

    backgroundTimer = setInterval(() => {
      void syncIfNeeded(false);
    }, SHEETS_POLL_MS);

    if (typeof backgroundTimer === "object" && "unref" in backgroundTimer) {
      backgroundTimer.unref();
    }
  }

  /** Lectura caliente — nunca bloquea en Drive crawl completo. */
  async getSnapshot(): Promise<LiveSyncSnapshot | null> {
    const cached = liveSyncStore.getSnapshot();
    if (cached) {
      void operationsDocumentRepository.ensureOperationalReady();
      void syncIfNeeded(false);
      return applyOperationalOverlay(cached);
    }

    await operationsDocumentRepository.ensureOperationalReady();
    void rebuildSnapshot("cold-start");
    return null;
  }

  async warmSnapshot(): Promise<LiveSyncSnapshot | null> {
    await operationsDocumentRepository.ensureOperationalReady();
    const cached = liveSyncStore.getSnapshot();
    if (cached) return applyOperationalOverlay(cached);
    return rebuildSnapshot("warm");
  }

  async listForSector(
    sector: SectorId,
    ownerPerson?: string | null
  ): Promise<WorkItemsResponse> {
    let snapshot = await this.getSnapshot();

    if (!snapshot) {
      snapshot = await this.warmSnapshot();
    }

    if (!snapshot) {
      return {
        sector,
        ownerPerson: ownerPerson ?? null,
        source: "drive",
        scannedAt: new Date().toISOString(),
        workItems: [],
        qualityItems: [],
        counts: { total: 0, hoy: 0, semana: 0, pendientes: 0, bloqueados: 0 },
        message: "Inicializando Live Sync — reintentá en unos segundos.",
        warnings: [],
      };
    }

    const filtered = filterWorkItemsForSectorAndPerson(
      snapshot.workItems,
      sector,
      ownerPerson
    );
    const calidadItems = sector === "CALIDAD" ? snapshot.qualityItems : [];
    const overlay = serverOperationalState.snapshot();
    const workItemsWithOverlay = serverOperationalState.applyToWorkItems(filtered);
    const backgroundSyncing = operationsDocumentRepository.isBackgroundIndexInFlight();
    const snapshotAgeMs = Date.now() - new Date(snapshot.updatedAt).getTime();
    const snapshotStale = snapshotAgeMs > SNAPSHOT_MAX_AGE_MS;

    return {
      sector,
      ownerPerson: ownerPerson ?? null,
      source: "drive",
      scannedAt: snapshot.sheetsSyncedAt ?? snapshot.updatedAt,
      workItems: workItemsWithOverlay,
      qualityItems: calidadItems,
      counts: countMiTrabajoSections(workItemsWithOverlay),
      warnings: snapshot.warnings.slice(0, 10),
      operationalOverlay: {
        revision: overlay.revision,
        progress: overlay.progress,
        decisions: overlay.decisions,
        completions: overlay.completions,
      },
      message:
        backgroundSyncing || snapshotStale
          ? "Sincronizando — mostrando último snapshot disponible."
          : filtered.length > 0
            ? sector === "PRODUCCION"
              ? `${filtered.length} WorkItem(s) agregados (Live Sync).`
              : `${filtered.length} WorkItem(s) para ${sector}${ownerPerson ? ` · ${ownerPerson}` : ""}.`
            : sector === "PRODUCCION"
              ? "Sin operación agregada — verificar SEMANAS indexado."
              : `Sin trabajos para ${sector}${ownerPerson ? ` · ${ownerPerson}` : ""}.`,
    };
  }

  getStatus(): LiveSyncStatus {
    const snapshot = liveSyncStore.getSnapshot();
    return {
      revision: snapshot?.revision ?? 0,
      updatedAt: snapshot?.updatedAt ?? new Date(0).toISOString(),
      sheetsSyncedAt: snapshot?.sheetsSyncedAt ?? null,
      subscribers: operationalEventBus.subscriberCount,
      snapshotReady: liveSyncStore.isReady(),
      workItemCount: snapshot?.workItems.length ?? 0,
      backgroundSyncing: operationsDocumentRepository.isBackgroundIndexInFlight(),
    };
  }

  async forceRefresh(): Promise<LiveSyncSnapshot | null> {
    for (const key of CRITICAL_SHEETS) {
      const ref = await operationsDocumentRepository.tryGetCriticalSheetRef(key);
      if (ref) invalidateSpreadsheetCache(ref.fileId);
    }
    return rebuildSnapshot("manual");
  }
}

export const liveSyncEngine = new LiveSyncEngine();

if (getServerDataMode() === "real") {
  void liveSyncEngine.warmSnapshot();
}

export function getProductionOverviewFromSnapshot() {
  const snapshot = liveSyncStore.getSnapshot();
  if (!snapshot) return null;
  const items = filterWorkItemsForSector(snapshot.workItems, "PRODUCCION");
  const overview = buildProductionOverview(items);
  overview.warnings = snapshot.warnings.slice(0, 10);
  return overview;
}
